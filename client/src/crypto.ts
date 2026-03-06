/**
 * WASM wrapper for mental-poker cryptographic operations.
 *
 * Uses opaque WASM types — no manual byte wrangling needed.
 * Call `to_bytes()` only when submitting data on-chain,
 * and `from_bytes()` when reading data from chain storage.
 */

import init, {
  generate_player,
  zero_mask_deck,
  max_deck_size,
  PlayerData,
  PlayerHello,
  PlayerKeypair,
  MaskedDeck,
  MaskedCard,
  AggregatedKeys,
  ShuffleMessage,
  RevealMessage,
  Reveals,
} from "./wasm/pkg/cards_play";

// Re-export WASM types for convenience
export type {
  PlayerData,
  PlayerHello,
  PlayerKeypair,
  MaskedDeck,
  MaskedCard,
  AggregatedKeys,
  ShuffleMessage,
  RevealMessage,
  Reveals,
};

let initialized = false;

export async function initCrypto(): Promise<void> {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

/** Generate a player's crypto keypair. `accountId` is the raw 32-byte sr25519 public key. */
export function generatePlayer(accountId: Uint8Array): PlayerData {
  return generate_player(accountId);
}

/** Create zero-masked deck for `count` cards. */
export function zeroMaskDeck(count: number): MaskedDeck {
  return zero_mask_deck(count);
}

/** Maximum supported deck size (200 for secp256k1). */
export function getMaxDeckSize(): number {
  return max_deck_size();
}

/** Deserialize a MaskedDeck from on-chain CurrentDeck storage. */
export function deckFromBytes(bytes: Uint8Array): MaskedDeck {
  return MaskedDeck.from_bytes(bytes);
}

/** Deserialize AggregatedKeys from on-chain AggregateKeyData storage. */
export function aggKeysFromBytes(bytes: Uint8Array): AggregatedKeys {
  return AggregatedKeys.from_bytes(bytes);
}

/** Deserialize a RevealMessage from on-chain storage. */
export function revealFromBytes(bytes: Uint8Array): RevealMessage {
  return RevealMessage.from_bytes(bytes);
}

/** Create a new reveal collector. */
export function newReveals(): Reveals {
  return new Reveals();
}

export type CardType = "ek" | "defuse" | "safe";

/**
 * Map a deck position to a card type for simplified Exploding Kittens.
 *
 * Layout: [N-1 EK] [N+2 Defuse] [rest Safe]
 */
export function cardType(position: number, numPlayers: number): CardType {
  const numEk = numPlayers - 1;
  const numDefuse = numPlayers + 2;
  if (position < numEk) return "ek";
  if (position < numEk + numDefuse) return "defuse";
  return "safe";
}
