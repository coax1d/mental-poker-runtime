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

export async function readGameInfo(
  api: Api,
  gameId: number,
): Promise<{ phase: string; deck_size: number; num_players: number; registered_count: number } | undefined> {
  return (api as any).query.MentalPoker.Games.getValue(gameId);
}

export async function readShuffleIndex(
  api: Api,
  gameId: number,
): Promise<number> {
  return (api as any).query.MentalPoker.ShuffleIndex.getValue(gameId);
}
