/**
 * WASM wrapper for mental-poker cryptographic operations.
 *
 * Uses a bytes-oriented API from the `cards-play` WASM crate.
 * All serialized values are `Uint8Array` compatible with arkworks
 * `CanonicalSerialize` / `CanonicalDeserialize`.
 */

import init, {
  PlayerKeypair,
  MaskedCards,
  AggregatedPublicKeys,
  AccumulateReveals,
  zero_mask_deck_n,
  verify_player,
} from "./wasm/pkg/cards_play";

// Re-export WASM types for convenience
export type {
  MaskedCards,
  AggregatedPublicKeys,
  AccumulateReveals,
};
export { PlayerKeypair };

let initialized = false;

export async function initCrypto(): Promise<void> {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

/** Result of generating a player: keypair (secret) + hello bytes (to submit on-chain). */
export interface PlayerGenerated {
  keypair: PlayerKeypair;
  helloBytes: Uint8Array;
}

/** Generate a player's crypto keypair. `accountId` is the raw 32-byte sr25519 public key. */
export function generatePlayer(accountId: Uint8Array): PlayerGenerated {
  const keypair = new PlayerKeypair();
  const helloBytes = keypair.prove_player(accountId);
  return { keypair, helloBytes };
}

/** Create zero-masked deck for `count` cards. */
export function zeroMaskDeck(count: number): MaskedCards {
  return zero_mask_deck_n(count);
}

/** Deserialize a MaskedCards from on-chain CurrentDeck storage. */
export function deckFromBytes(bytes: Uint8Array): MaskedCards {
  return MaskedCards.deserialize(bytes);
}

/** Deserialize AggregatedPublicKeys from on-chain AggregateKeyData storage. */
export function aggKeysFromBytes(bytes: Uint8Array): AggregatedPublicKeys {
  return AggregatedPublicKeys.deserialize(bytes);
}

/** Verify a player hello message and return their public key bytes. */
export function verifyPlayer(
  helloBytes: Uint8Array,
  accountId: Uint8Array,
): Uint8Array {
  return verify_player(helloBytes, accountId);
}

/**
 * Build a sub-deck from a range of cards in the deck, optionally appending an extra card.
 * Used for mid-game reshuffles (e.g., re-inserting a defused EK into the remaining pile).
 *
 * Constructs the arkworks `Vec<MaskedCard>` serialization format:
 * little-endian u64 length prefix + concatenated compressed card bytes.
 */
export function buildSubDeck(
  deck: MaskedCards,
  fromIndex: number,
  toIndex: number,
  extraCardBytes?: Uint8Array,
): MaskedCards {
  const cards: Uint8Array[] = [];
  for (let i = fromIndex; i < toIndex; i++) {
    cards.push(new Uint8Array(deck.get_card(i)));
  }
  if (extraCardBytes) {
    cards.push(new Uint8Array(extraCardBytes));
  }
  if (cards.length === 0) {
    throw new Error("Cannot build empty sub-deck");
  }
  const cardSize = cards[0].length;
  const buf = new Uint8Array(8 + cards.length * cardSize);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(cards.length), true);
  for (let i = 0; i < cards.length; i++) {
    buf.set(cards[i], 8 + i * cardSize);
  }
  return deckFromBytes(buf);
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
