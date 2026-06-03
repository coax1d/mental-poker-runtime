/**
 * Chain interaction via polkadot-api (PAPI).
 *
 * SETUP REQUIRED: Before using, generate PAPI descriptors:
 *   1. Start the node:  cd mental-poker-runtime && ./target/release/mental-poker-node --dev
 *   2. Generate types:  cd client && npx papi add -w ws://127.0.0.1:9944 mpr
 *
 * This creates .papi/descriptors/ with typed chain definitions.
 */

import {
  createClient,
  type PolkadotSigner,
  type PolkadotClient,
  Binary,
} from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { mpr } from "@polkadot-api/descriptors";

type Api = ReturnType<PolkadotClient["getTypedApi"]>;
export type TypedApi = Api;

export interface ChainConnection {
  client: PolkadotClient;
  api: Api;
}

/** Connect to the Substrate node. */
export async function connect(
  wsUrl: string = "ws://127.0.0.1:9944",
): Promise<ChainConnection> {
  const provider = getWsProvider(wsUrl);
  const client = createClient(provider);
  const api = client.getTypedApi(mpr);
  return { client, api };
}

/** Disconnect from the node. */
export function disconnect(conn: ChainConnection): void {
  conn.client.destroy();
}

// --- Extrinsic Helpers ---

export async function createGame(
  api: Api,
  signer: PolkadotSigner,
  deckSize: number,
  numPlayers: number,
): Promise<number> {
  const result = await (api as any).tx.MentalPoker.create_game({
    deck_size: deckSize,
    num_players: numPlayers,
  }).signAndSubmit(signer);

  // Extract game_id from GameCreated event
  for (const event of result.events) {
    if (
      event.type === "MentalPoker" &&
      event.value.type === "GameCreated"
    ) {
      return event.value.value.game_id;
    }
  }
  // Fallback: read GameCounter - 1
  const counter = await (api as any).query.MentalPoker.GameCounter.getValue();
  return counter - 1;
}

export async function registerPlayer(
  api: Api,
  signer: PolkadotSigner,
  gameId: number,
  playerHelloBytes: Uint8Array,
): Promise<void> {
  await (api as any).tx.MentalPoker.register_player({
    game_id: gameId,
    player_hello_bytes: Binary.fromBytes(playerHelloBytes),
  }).signAndSubmit(signer);
}

export async function submitMaskedDeck(
  api: Api,
  signer: PolkadotSigner,
  gameId: number,
  maskedDeckBytes: Uint8Array,
): Promise<void> {
  await (api as any).tx.MentalPoker.submit_masked_deck({
    game_id: gameId,
    masked_deck_bytes: Binary.fromBytes(maskedDeckBytes),
  }).signAndSubmit(signer);
}

export async function submitShuffle(
  api: Api,
  signer: PolkadotSigner,
  gameId: number,
  shuffleMsgBytes: Uint8Array,
): Promise<void> {
  await (api as any).tx.MentalPoker.submit_shuffle({
    game_id: gameId,
    shuffle_msg_bytes: Binary.fromBytes(shuffleMsgBytes),
  }).signAndSubmit(signer);
}

export async function submitReveal(
  api: Api,
  signer: PolkadotSigner,
  gameId: number,
  cardIndex: number,
  revealMsgBytes: Uint8Array,
): Promise<void> {
  await (api as any).tx.MentalPoker.submit_reveal({
    game_id: gameId,
    card_index: cardIndex,
    reveal_msg_bytes: Binary.fromBytes(revealMsgBytes),
  }).signAndSubmit(signer);
}

// --- Storage Queries ---

export async function readCurrentDeck(
  api: Api,
  gameId: number,
): Promise<Uint8Array> {
  const raw: Binary = await (api as any).query.MentalPoker.CurrentDeck.getValue(gameId);
  return raw.asBytes();
}

export async function readAggregateKeyData(
  api: Api,
  gameId: number,
): Promise<Uint8Array> {
  const raw: Binary = await (api as any).query.MentalPoker.AggregateKeyData.getValue(gameId);
  return raw.asBytes();
}

export interface GameInfo {
  phase: string;
  deck_size: number;
  num_players: number;
  registered_count: number;
}

export async function readGameInfo(
  api: Api,
  gameId: number,
): Promise<GameInfo | undefined> {
  const raw = await (api as any).query.MentalPoker.Games.getValue(gameId);
  if (!raw) return undefined;
  // PAPI represents SCALE enums as { type: "VariantName" }
  const phase = typeof raw.phase === "string" ? raw.phase : raw.phase?.type ?? String(raw.phase);
  return {
    phase,
    deck_size: raw.deck_size,
    num_players: raw.num_players,
    registered_count: raw.registered_count,
  };
}

export async function readShuffleIndex(
  api: Api,
  gameId: number,
): Promise<number> {
  return (api as any).query.MentalPoker.ShuffleIndex.getValue(gameId);
}

/** Read the ordered list of player SS58 addresses for a game. */
export async function readPlayerOrder(
  api: Api,
  gameId: number,
): Promise<string[]> {
  const raw = await (api as any).query.MentalPoker.PlayerOrder.getValue(gameId);
  if (!raw) return [];
  // PAPI returns AccountIds as SS58String
  return (raw as any[]).map((v: any) => String(v));
}

/** Read a single reveal token from storage. */
export async function readRevealToken(
  api: Api,
  gameId: number,
  cardIndex: number,
  player: string,
): Promise<Uint8Array | undefined> {
  const raw = await (api as any).query.MentalPoker.RevealTokens.getValue(
    gameId,
    cardIndex,
    player,
  );
  if (!raw) return undefined;
  return (raw as Binary).asBytes();
}

/** Read the reveal count for a (game, card). */
export async function readRevealCount(
  api: Api,
  gameId: number,
  cardIndex: number,
): Promise<number> {
  return (api as any).query.MentalPoker.RevealCount.getValue(gameId, cardIndex);
}

export async function initiateReshuffle(
  api: Api,
  signer: PolkadotSigner,
  gameId: number,
  fromCardIndex: number,
  reshuffleDeckBytes: Uint8Array,
): Promise<void> {
  await (api as any).tx.MentalPoker.initiate_reshuffle({
    game_id: gameId,
    from_card_index: fromCardIndex,
    reshuffle_deck_bytes: Binary.fromBytes(reshuffleDeckBytes),
  }).signAndSubmit(signer);
}

export async function readReshuffleDeck(
  api: Api,
  gameId: number,
): Promise<Uint8Array | undefined> {
  const raw = await (api as any).query.MentalPoker.ReshuffleDeck.getValue(gameId);
  if (!raw) return undefined;
  return (raw as Binary).asBytes();
}

export async function readReshuffleFromIndex(
  api: Api,
  gameId: number,
): Promise<number | undefined> {
  return (api as any).query.MentalPoker.ReshuffleFromIndex.getValue(gameId);
}

// --- Polling Helpers ---

export type GamePhaseOnChain = "Registration" | "Masking" | "Shuffling" | "Playing" | "Reshuffling" | "Complete";

/**
 * Poll until the on-chain game phase matches the expected value.
 * Returns the game info once the condition is met.
 */
export async function waitForPhase(
  api: Api,
  gameId: number,
  phase: GamePhaseOnChain,
  signal?: { stopped: boolean },
  intervalMs = 1000,
): Promise<{ phase: string; deck_size: number; num_players: number; registered_count: number }> {
  while (true) {
    if (signal?.stopped) throw new Error("Stopped");
    const info = await readGameInfo(api, gameId);
    if (info && info.phase === phase) return info;
    await sleep(intervalMs);
  }
}

/**
 * Poll until the shuffle index reaches the target value.
 */
export async function waitForShuffleIndex(
  api: Api,
  gameId: number,
  target: number,
  signal?: { stopped: boolean },
  intervalMs = 1000,
): Promise<void> {
  while (true) {
    if (signal?.stopped) throw new Error("Stopped");
    const idx = await readShuffleIndex(api, gameId);
    if (idx >= target) return;
    await sleep(intervalMs);
  }
}

/**
 * Poll until the reveal count for a card reaches the target.
 */
export async function waitForRevealCount(
  api: Api,
  gameId: number,
  cardIndex: number,
  target: number,
  signal?: { stopped: boolean },
  intervalMs = 500,
): Promise<void> {
  while (true) {
    if (signal?.stopped) throw new Error("Stopped");
    const count = await readRevealCount(api, gameId, cardIndex);
    if (count >= target) return;
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
