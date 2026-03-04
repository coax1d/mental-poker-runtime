/**
 * GameHarness: orchestrates a full Exploding Kittens game
 * against the mental-poker Substrate node.
 *
 * Controls all players locally (simulation mode).
 * Each crypto/chain operation updates the game state via a callback.
 */

import type { TypedApi } from "./chain";
import * as chain from "./chain";
import * as crypto from "./crypto";
import type { PlayerData } from "./crypto";
import type { DevAccount } from "./accounts";
import {
  type GameState,
  type LogEntry,
  createInitialState,
  dealCard,
  processDrawnCard,
  nextTurn,
  isGameOver,
} from "./game";

const CARDS_PER_HAND = 5;

export interface HarnessConfig {
  api: TypedApi;
  accounts: DevAccount[];
  deckSize: number;
  /** Delay between steps in ms (0 for instant) */
  stepDelay: number;
  /** Callback on every state change */
  onUpdate: (state: GameState) => void;
}

interface PlayerInfo {
  account: DevAccount;
  crypto: PlayerData;
}

export class GameHarness {
  private api: TypedApi;
  private accounts: DevAccount[];
  private deckSize: number;
  private stepDelay: number;
  private onUpdate: (state: GameState) => void;

  private players: PlayerInfo[] = [];
  private gameId = 0;
  private state: GameState;
  private currentDeck: Uint8Array = new Uint8Array();
  private aggKeyBytes: Uint8Array = new Uint8Array();
  private stopped = false;

  constructor(config: HarnessConfig) {
    this.api = config.api;
    this.accounts = config.accounts;
    this.deckSize = config.deckSize;
    this.stepDelay = config.stepDelay;
    this.onUpdate = config.onUpdate;
    this.state = createInitialState(
      config.accounts.length,
      config.deckSize,
      config.accounts.map((a) => a.name),
    );
  }

  /** Stop the game loop. */
  stop(): void {
    this.stopped = true;
  }

  /** Run the full game from start to finish. */
  async runGame(): Promise<void> {
    try {
      await this.phaseSetup();
      if (this.stopped) return;
      await this.phaseRegister();
      if (this.stopped) return;
      await this.phaseMask();
      if (this.stopped) return;
      await this.phaseShuffle();
      if (this.stopped) return;
      await this.phaseDeal();
      if (this.stopped) return;
      await this.phasePlay();
    } catch (err) {
      this.log("info", `Error: ${err}`);
    }
  }

  // --- Phase: Setup ---

  private async phaseSetup(): Promise<void> {
    this.updatePhase("setup");
    this.log("setup", "Initializing crypto...");
    await crypto.initCrypto();

    this.log("setup", "Generating player keys...");
    for (const account of this.accounts) {
      const playerCrypto = crypto.generatePlayer(account.publicKey);
      this.players.push({ account, crypto: playerCrypto });
    }

    this.log("setup", `Creating game (${this.deckSize} cards, ${this.accounts.length} players)...`);
    this.gameId = await chain.createGame(
      this.api,
      this.accounts[0].signer,
      this.deckSize,
      this.accounts.length,
    );
    this.log("setup", `Game #${this.gameId} created.`);
    await this.delay();
  }

  // --- Phase: Registration ---

  private async phaseRegister(): Promise<void> {
    this.updatePhase("registering");
    for (const player of this.players) {
      if (this.stopped) return;
      this.log("registering", `Registering ${player.account.name}...`);
      await chain.registerPlayer(
        this.api,
        player.account.signer,
        this.gameId,
        player.crypto.helloBytes,
      );
      this.log("registering", `${player.account.name} registered.`);
      await this.delay();
    }
    this.log("registering", "All players registered. Keys aggregated.");
  }

  // --- Phase: Masking ---

  private async phaseMask(): Promise<void> {
    this.updatePhase("masking");
    this.log("masking", "Creating zero-masked deck...");
    const maskedDeck = crypto.zeroMaskDeck(this.deckSize);

    this.log("masking", "Submitting masked deck to chain...");
    await chain.submitMaskedDeck(
      this.api,
      this.players[0].account.signer,
      this.gameId,
      maskedDeck,
    );
    this.currentDeck = maskedDeck;
    this.log("masking", "Deck masked and submitted.");
    await this.delay();
  }

  // --- Phase: Shuffle ---

  private async phaseShuffle(): Promise<void> {
    this.updatePhase("shuffling");

    // Read aggregate key data from chain
    this.aggKeyBytes = await chain.readAggregateKeyData(this.api, this.gameId);

    for (const player of this.players) {
      if (this.stopped) return;
      this.log("shuffling", `${player.account.name} shuffling (generating ZK proof)...`);

      // Read current deck from chain
      this.currentDeck = await chain.readCurrentDeck(this.api, this.gameId);

      const shuffleMsg = crypto.shuffleDeck(this.aggKeyBytes, this.currentDeck);

      this.log("shuffling", `${player.account.name} submitting shuffle proof...`);
      await chain.submitShuffle(
        this.api,
        player.account.signer,
        this.gameId,
        shuffleMsg,
      );
      this.log("shuffling", `${player.account.name} shuffle verified.`);
      await this.delay();
    }

    // Read final shuffled deck
    this.currentDeck = await chain.readCurrentDeck(this.api, this.gameId);
    this.log("shuffling", "All shuffles complete. Deck is ready.");
  }

  // --- Phase: Deal ---

  private async phaseDeal(): Promise<void> {
    this.updatePhase("dealing");
    this.log("dealing", `Dealing ${CARDS_PER_HAND} cards to each player...`);

    for (let card = 0; card < CARDS_PER_HAND; card++) {
      for (let p = 0; p < this.players.length; p++) {
        if (this.stopped) return;
        const cardIndex = this.state.drawIndex;
        const position = await this.privateReveal(cardIndex, p);
        this.state = dealCard(this.state, p, position);
        this.emitUpdate();
        await this.delay();
      }
    }
    this.log("dealing", "Dealing complete.");
  }

  // --- Phase: Play ---

  private async phasePlay(): Promise<void> {
    this.updatePhase("playing");
    this.log("playing", "Game begins!");

    while (!isGameOver(this.state) && !this.stopped) {
      const playerIdx = this.state.currentPlayer;
      const player = this.state.players[playerIdx];
      this.log("playing", `${player.name}'s turn — drawing a card...`);

      const cardIndex = this.state.drawIndex;
      const position = await this.privateReveal(cardIndex, playerIdx);
      this.state = processDrawnCard(this.state, playerIdx, position);
      this.emitUpdate();
      await this.delay();

      if (isGameOver(this.state)) break;
      this.state = nextTurn(this.state);
      this.emitUpdate();
      await this.delay();
    }

    // Final state
    if (!this.stopped) {
      this.state = nextTurn(this.state); // sets winner if game over
      this.updatePhase("finished");
    }
  }

  // --- Private reveal protocol ---

  /**
   * Reveal card at `cardIndex` privately to `recipientIdx`.
   *
   * - All N-1 other players submit reveal tokens on-chain.
   * - Recipient generates their token locally (not submitted).
   * - Recipient unmasks using all N tokens.
   *
   * Returns the deck position of the revealed card.
   */
  private async privateReveal(
    cardIndex: number,
    recipientIdx: number,
  ): Promise<number> {
    const cardBytes = crypto.getMaskedCard(this.currentDeck, cardIndex);
    const revealMessages: Uint8Array[] = [];

    // All players generate reveal tokens
    for (let p = 0; p < this.players.length; p++) {
      const revealMsg = crypto.proveRevealToken(
        this.players[p].crypto.keypairBytes,
        cardBytes,
      );

      if (p !== recipientIdx) {
        // Submit to chain (other players)
        await chain.submitReveal(
          this.api,
          this.players[p].account.signer,
          this.gameId,
          cardIndex,
          revealMsg,
        );
      }
      // Collect all messages (including recipient's local one)
      revealMessages.push(revealMsg);
    }

    // Recipient unmasks
    const packedReveals = crypto.packRevealMessages(revealMessages);
    return crypto.unmaskCard(packedReveals, cardBytes);
  }

  // --- Helpers ---

  private updatePhase(phase: GameState["phase"]): void {
    this.state = { ...this.state, phase };
    this.emitUpdate();
  }

  private log(phase: LogEntry["phase"], message: string): void {
    this.state = {
      ...this.state,
      log: [...this.state.log, { phase, message }],
    };
    this.emitUpdate();
  }

  private emitUpdate(): void {
    this.onUpdate({ ...this.state });
  }

  private delay(): Promise<void> {
    if (this.stepDelay <= 0) return Promise.resolve();
    return new Promise((r) => setTimeout(r, this.stepDelay));
  }
}
