/**
 * GameHarness: orchestrates a full Exploding Kittens game
 * against the mental-poker contract on Paseo Asset Hub.
 *
 * Controls all players locally (simulation mode).
 * Shuffles happen off-chain; the chain verifies registration,
 * deck agreement signatures, and reveal proofs.
 */

import type { ChainConnection } from "./chain";
import * as chain from "./chain";
import * as crypto from "./crypto";
import type {
  PlayerKeypair,
  MaskedCards,
  AggregatedPublicKeys,
} from "./crypto";
import type { PolkadotSigner } from "polkadot-api";
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

export interface PlayerAccount {
  name: string;
  signer: PolkadotSigner;
  /** The 20-byte H160 address (mapped via Revive.map_account). */
  h160: Uint8Array;
}

export interface HarnessConfig {
  conn: ChainConnection;
  accounts: PlayerAccount[];
  deckSize: number;
  /** Delay between steps in ms (0 for instant) */
  stepDelay: number;
  /** Callback on every state change */
  onUpdate: (state: GameState) => void;
}

interface PlayerInfo {
  account: PlayerAccount;
  keypair: PlayerKeypair;
  helloBytes: Uint8Array;
}

export class GameHarness {
  private conn: ChainConnection;
  private accounts: PlayerAccount[];
  private deckSize: number;
  private stepDelay: number;
  private onUpdate: (state: GameState) => void;

  private players: PlayerInfo[] = [];
  private state: GameState;
  private currentDeck!: MaskedCards;
  private aggKeys!: AggregatedPublicKeys;
  private stopped = false;

  constructor(config: HarnessConfig) {
    this.conn = config.conn;
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
      await this.phaseOffChainShuffle();
      if (this.stopped) return;
      await this.phaseSubmitDeck();
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
      // Bind the hello to the player's H160 address
      const { keypair, helloBytes } = crypto.generatePlayer(account.h160);
      this.players.push({ account, keypair, helloBytes });
    }

    this.log("setup", `Creating game (${this.deckSize} cards, ${this.accounts.length} players)...`);
    await chain.createGame(
      this.conn,
      this.accounts[0].signer,
      this.deckSize,
      this.accounts.length,
    );
    this.log("setup", "Game created.");
    await this.delay();
  }

  // --- Phase: Registration ---

  private async phaseRegister(): Promise<void> {
    this.updatePhase("registering");
    for (const player of this.players) {
      if (this.stopped) return;
      this.log("registering", `Registering ${player.account.name}...`);
      await chain.registerPlayer(
        this.conn,
        player.account.signer,
        player.helloBytes,
      );
      this.log("registering", `${player.account.name} registered.`);
      await this.delay();
    }
    this.log("registering", "All players registered.");
  }

  // --- Phase: Off-Chain Shuffle ---

  private async phaseOffChainShuffle(): Promise<void> {
    this.updatePhase("shuffling");
    this.log("shuffling", "Building aggregate public keys...");

    // Build APK from player hellos (client-side, same as what the pallet did)
    this.aggKeys = crypto.aggKeysFromHellos(
      this.players.map((p) => ({
        helloBytes: p.helloBytes,
        nameBytes: p.account.h160,
      })),
    );

    // Create initial zero-masked deck
    this.log("shuffling", "Creating zero-masked deck...");
    this.currentDeck = crypto.zeroMaskDeck(this.deckSize);

    // Each player shuffles (off-chain, no chain interaction)
    for (let i = 0; i < this.players.length; i++) {
      if (this.stopped) return;
      const player = this.players[i];
      this.log("shuffling", `${player.account.name} shuffling (off-chain)...`);
      const shuffleMsgBytes = this.aggKeys.shuffle_and_remask(
        player.keypair,
        this.currentDeck,
      );
      // Verify the shuffle and extract the new deck
      this.currentDeck = crypto.verifyAndExtractDeck(
        this.aggKeys, i, this.currentDeck, shuffleMsgBytes,
      );
      this.log("shuffling", `${player.account.name} shuffle verified.`);
      await this.delay();
    }

    this.log("shuffling", "All shuffles complete. Deck ready for agreement.");
  }

  // --- Phase: Submit Agreed Deck ---

  private async phaseSubmitDeck(): Promise<void> {
    this.updatePhase("masking"); // reuse "masking" phase for UI
    this.log("masking", "Signing deck agreement...");

    const deckBytes = this.currentDeck.serialize();

    // Each player signs the deck (ZKProofKeyOwnership bound to deck bytes)
    const signatures: Uint8Array[] = [];
    for (const player of this.players) {
      // prove_player(deck_bytes) produces a PlayerHello where the ownership_proof
      // is bound to deck_bytes. The sig is bytes [33..] (skip the 33-byte pk).
      const hello = player.keypair.prove_player(deckBytes);
      const sig = hello.slice(33);
      signatures.push(sig);
    }

    this.log("masking", "Submitting agreed deck to chain...");
    await chain.submitAgreedDeck(
      this.conn,
      this.players[0].account.signer,
      deckBytes,
      signatures,
    );
    this.log("masking", "Deck agreement verified and stored on chain.");
    await this.delay();
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
      const drawnType = crypto.cardType(position, this.state.numPlayers);

      this.state = processDrawnCard(this.state, playerIdx, position);
      this.emitUpdate();
      await this.delay();

      // No reshuffles in v1 — if EK is defused, the EK goes to discard
      // (processDrawnCard already handles this)

      if (isGameOver(this.state)) break;
      this.state = nextTurn(this.state);
      this.emitUpdate();
      await this.delay();
    }

    // Final state
    if (!this.stopped) {
      this.state = nextTurn(this.state);
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
    const cardBytes = this.currentDeck.get_card(cardIndex);
    const reveals = this.aggKeys.accumulate_reveals(cardBytes);

    for (let p = 0; p < this.players.length; p++) {
      const revealMsgBytes = reveals.prove_reveal(this.players[p].keypair);

      if (p !== recipientIdx) {
        // Submit to chain (other players' reveal tokens)
        await chain.submitReveal(
          this.conn,
          this.players[p].account.signer,
          cardIndex,
          revealMsgBytes,
        );
      }
      // Collect all messages locally (including recipient's)
      reveals.add_reveal(revealMsgBytes);
    }

    return reveals.completed_position();
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
