/**
 * PlayerAgent: controller for a single player in multiplayer mode.
 *
 * Each browser tab runs one PlayerAgent. The agent polls chain state to
 * know when it's time to act, and drives its player through the protocol.
 *
 * The chain is the sole coordination layer — no signaling server.
 */

import type { TypedApi } from "./chain";
import * as chain from "./chain";
import * as crypto from "./crypto";
import type {
  PlayerData,
  PlayerKeypair,
  MaskedDeck,
  AggregatedKeys,
} from "./crypto";
import type { DevAccount } from "./accounts";
import {
  type GameState,
  type LogEntry,
  type GamePhase,
  createInitialState,
  dealCard,
  dealHiddenCard,
  processDrawnCard,
  processHiddenDraw,
  nextTurn,
  isGameOver,
} from "./game";

const CARDS_PER_HAND = 5;

export interface AgentConfig {
  api: TypedApi;
  account: DevAccount;
  onUpdate: (state: GameState) => void;
}

export class PlayerAgent {
  private api: TypedApi;
  private account: DevAccount;
  private onUpdate: (state: GameState) => void;

  private playerData!: PlayerData;
  private keypair!: PlayerKeypair;
  private myIndex = -1;
  private playerAddresses: string[] = [];

  private gameId = -1;
  private numPlayers = 0;
  private deckSize = 0;
  private state!: GameState;
  private currentDeck!: MaskedDeck;
  private aggKeys!: AggregatedKeys;
  private signal = { stopped: false };

  constructor(config: AgentConfig) {
    this.api = config.api;
    this.account = config.account;
    this.onUpdate = config.onUpdate;
  }

  stop(): void {
    this.signal.stopped = true;
  }

  /** Create a new game and run through the protocol. */
  async createGame(deckSize: number, numPlayers: number): Promise<number> {
    this.deckSize = deckSize;
    this.numPlayers = numPlayers;
    this.state = createInitialState(numPlayers, deckSize, []);

    await this.initCrypto();

    this.log("setup", `Creating game (${deckSize} cards, ${numPlayers} players)...`);
    this.gameId = await chain.createGame(this.api, this.account.signer, deckSize, numPlayers);
    this.log("setup", `Game #${this.gameId} created.`);

    // Register ourselves
    this.updatePhase("registering");
    this.log("registering", `Registering ${this.account.name}...`);
    const helloBytes = this.playerData.hello().to_bytes();
    await chain.registerPlayer(this.api, this.account.signer, this.gameId, helloBytes);
    this.log("registering", `${this.account.name} registered. Waiting for other players...`);

    // Continue protocol in background
    this.runProtocol();

    return this.gameId;
  }

  /** Join an existing game and run through the protocol. */
  async joinGame(gameId: number): Promise<void> {
    this.gameId = gameId;

    const info = await chain.readGameInfo(this.api, gameId);
    if (!info) throw new Error(`Game #${gameId} not found`);
    this.deckSize = info.deck_size;
    this.numPlayers = info.num_players;
    this.state = createInitialState(this.numPlayers, this.deckSize, []);

    await this.initCrypto();

    // Register
    this.updatePhase("registering");
    this.log("registering", `Registering ${this.account.name}...`);
    const helloBytes = this.playerData.hello().to_bytes();
    await chain.registerPlayer(this.api, this.account.signer, this.gameId, helloBytes);
    this.log("registering", `${this.account.name} registered. Waiting for other players...`);

    // Continue protocol in background
    this.runProtocol();
  }

  // --- Protocol flow ---

  private async runProtocol(): Promise<void> {
    try {
      await this.waitForRegistration();
      if (this.signal.stopped) return;

      await this.phaseMask();
      if (this.signal.stopped) return;

      await this.phaseShuffle();
      if (this.signal.stopped) return;

      await this.phaseDeal();
      if (this.signal.stopped) return;

      await this.phasePlay();
    } catch (err) {
      if (this.signal.stopped) return;
      this.log("info", `Error: ${err}`);
    }
  }

  private async initCrypto(): Promise<void> {
    this.updatePhase("setup");
    this.log("setup", "Initializing crypto...");
    await crypto.initCrypto();

    this.log("setup", `Generating keys for ${this.account.name}...`);
    this.playerData = crypto.generatePlayer(this.account.publicKey);
    this.keypair = this.playerData.keypair();
  }

  // --- Wait for all players to register ---

  private async waitForRegistration(): Promise<void> {
    this.log("registering", "Waiting for all players to register...");

    // Poll until the game phase advances past Registration (keys aggregated)
    await chain.waitForPhase(this.api, this.gameId, "Masking", this.signal);

    // Read player order and determine our index
    this.playerAddresses = await chain.readPlayerOrder(this.api, this.gameId);
    this.myIndex = this.playerAddresses.findIndex(
      (addr) => addr === this.account.ss58Address,
    );

    if (this.myIndex === -1) {
      throw new Error("Our account was not found in player order");
    }

    // Rebuild state with player labels
    const names = this.playerAddresses.map((_, i) =>
      i === this.myIndex ? `${this.account.name} (you)` : `Player ${i + 1}`,
    );
    this.state = createInitialState(this.numPlayers, this.deckSize, names);

    this.log("registering", "All players registered. Keys aggregated.");
  }

  // --- Masking ---

  private async phaseMask(): Promise<void> {
    this.updatePhase("masking");

    if (this.myIndex === 0) {
      this.log("masking", "Creating zero-masked deck...");
      this.currentDeck = crypto.zeroMaskDeck(this.deckSize);

      this.log("masking", "Submitting masked deck to chain...");
      await chain.submitMaskedDeck(
        this.api,
        this.account.signer,
        this.gameId,
        this.currentDeck.to_bytes(),
      );
      this.log("masking", "Deck masked and submitted.");
    } else {
      this.log("masking", "Waiting for Player 1 to submit masked deck...");
    }

    // Wait for game to enter Shuffling phase
    await chain.waitForPhase(this.api, this.gameId, "Shuffling", this.signal);
    this.log("masking", "Deck masked.");
  }

  // --- Shuffling ---

  private async phaseShuffle(): Promise<void> {
    this.updatePhase("shuffling");

    // Read aggregate keys
    const aggKeyRaw = await chain.readAggregateKeyData(this.api, this.gameId);
    this.aggKeys = crypto.aggKeysFromBytes(aggKeyRaw);

    // Wait for our turn, then shuffle
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.signal.stopped) return;

      if (i === this.myIndex) {
        // Wait until it's our turn
        await chain.waitForShuffleIndex(this.api, this.gameId, i, this.signal);

        this.log("shuffling", `${this.account.name} shuffling (generating ZK proof)...`);

        const deckRaw = await chain.readCurrentDeck(this.api, this.gameId);
        this.currentDeck = crypto.deckFromBytes(deckRaw);

        const shuffleMsg = this.aggKeys.shuffle(this.currentDeck);

        this.log("shuffling", `${this.account.name} submitting shuffle proof...`);
        await chain.submitShuffle(
          this.api,
          this.account.signer,
          this.gameId,
          shuffleMsg.to_bytes(),
        );
        this.log("shuffling", `${this.account.name} shuffle verified.`);
      } else {
        this.log("shuffling", `Waiting for Player ${i + 1} to shuffle...`);
        await chain.waitForShuffleIndex(this.api, this.gameId, i + 1, this.signal);
        this.log("shuffling", `Player ${i + 1} shuffle verified.`);
      }
    }

    // Read the final shuffled deck
    const finalDeckRaw = await chain.readCurrentDeck(this.api, this.gameId);
    this.currentDeck = crypto.deckFromBytes(finalDeckRaw);
    this.log("shuffling", "All shuffles complete. Deck is ready.");
  }

  // --- Dealing ---

  private async phaseDeal(): Promise<void> {
    this.updatePhase("dealing");
    this.log("dealing", `Dealing ${CARDS_PER_HAND} cards to each player...`);

    for (let card = 0; card < CARDS_PER_HAND; card++) {
      for (let p = 0; p < this.numPlayers; p++) {
        if (this.signal.stopped) return;
        const cardIndex = this.state.drawIndex;

        if (p === this.myIndex) {
          // We are the recipient — reveal to ourselves
          const position = await this.revealToSelf(cardIndex);
          this.state = dealCard(this.state, p, position);
        } else {
          // Someone else's card — submit our reveal, then wait
          await this.revealForOther(cardIndex);
          this.state = dealHiddenCard(this.state, p);
        }
        this.emitUpdate();
      }
    }
    this.log("dealing", "Dealing complete.");
  }

  // --- Playing ---

  private async phasePlay(): Promise<void> {
    this.updatePhase("playing");
    this.log("playing", "Game begins!");

    while (!isGameOver(this.state) && !this.signal.stopped) {
      const playerIdx = this.state.currentPlayer;
      const player = this.state.players[playerIdx];
      const cardIndex = this.state.drawIndex;

      if (playerIdx === this.myIndex) {
        this.log("playing", "Your turn — drawing a card...");
        const position = await this.revealToSelf(cardIndex);
        this.state = processDrawnCard(this.state, playerIdx, position);
      } else {
        this.log("playing", `${player.name}'s turn — drawing a card...`);
        await this.revealForOther(cardIndex);
        // We don't know what they drew — mark as hidden
        // TODO: detect if they died (requires checking if they act next turn)
        this.state = processHiddenDraw(this.state, playerIdx, false);
      }
      this.emitUpdate();

      if (isGameOver(this.state)) break;
      this.state = nextTurn(this.state);
      this.emitUpdate();
    }

    if (!this.signal.stopped) {
      this.state = nextTurn(this.state);
      this.updatePhase("finished");
    }
  }

  // --- Reveal protocol ---

  /**
   * Reveal a card where we are the recipient.
   * 1. Submit our reveal token
   * 2. Wait for all N players to submit (including us)
   * 3. Read all tokens from storage
   * 4. Unmask locally
   */
  private async revealToSelf(cardIndex: number): Promise<number> {
    const card = this.currentDeck.get_card(cardIndex);

    // Submit our reveal token
    const myRevealMsg = card.prove_reveal(this.keypair);
    await chain.submitReveal(
      this.api,
      this.account.signer,
      this.gameId,
      cardIndex,
      myRevealMsg.to_bytes(),
    );

    // Wait for all N reveal tokens
    await chain.waitForRevealCount(
      this.api,
      this.gameId,
      cardIndex,
      this.numPlayers,
      this.signal,
    );

    // Read all tokens and unmask
    const reveals = crypto.newReveals();
    reveals.add(myRevealMsg);

    for (let p = 0; p < this.playerAddresses.length; p++) {
      if (p === this.myIndex) continue;
      const tokenBytes = await chain.readRevealToken(
        this.api,
        this.gameId,
        cardIndex,
        this.playerAddresses[p],
      );
      if (!tokenBytes) throw new Error(`Missing reveal token from player ${p}`);
      reveals.add(crypto.revealFromBytes(tokenBytes));
    }

    return reveals.unmask(card);
  }

  /**
   * Submit our reveal token for a card being revealed to someone else,
   * then wait for all reveals to complete.
   */
  private async revealForOther(cardIndex: number): Promise<void> {
    const card = this.currentDeck.get_card(cardIndex);
    const revealMsg = card.prove_reveal(this.keypair);

    await chain.submitReveal(
      this.api,
      this.account.signer,
      this.gameId,
      cardIndex,
      revealMsg.to_bytes(),
    );

    // Wait for all players to submit their reveals before moving on
    await chain.waitForRevealCount(
      this.api,
      this.gameId,
      cardIndex,
      this.numPlayers,
      this.signal,
    );
  }

  // --- Helpers ---

  private updatePhase(phase: GamePhase): void {
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
}

