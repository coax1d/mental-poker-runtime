/**
 * WASM wrapper for mental-poker cryptographic operations.
 *
 * All functions accept/return Uint8Array (serialized with arkworks CanonicalSerialize).
 * This matches the pallet's BoundedVec<u8> storage format — bytes go straight to chain.
 */

import init, {
  generate_player,
  extract_hello,
  extract_keypair,
  zero_mask_deck,
  shuffle_deck,
  prove_reveal_token,
  unmask_card,
  get_masked_card,
  get_shuffled_deck,
  deck_card_count,
  max_deck_size,
} from "./wasm/pkg/cards_play";

let initialized = false;

export async function initCrypto(): Promise<void> {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

// Re-export WASM functions with typed wrappers

export interface PlayerData {
  /** Combined player data (hello + keypair), keep in memory */
  combined: Uint8Array;
  /** Serialized PlayerHello for on-chain registration */
  helloBytes: Uint8Array;
  /** Serialized PlayerKeypair, keep secret */
  keypairBytes: Uint8Array;
}

/** Generate a player's crypto keypair. `accountId` is the raw 32-byte sr25519 public key. */
export function generatePlayer(accountId: Uint8Array): PlayerData {
  const combined = generate_player(accountId);
  const helloBytes = extract_hello(combined);
  const keypairBytes = extract_keypair(combined);
  return { combined, helloBytes, keypairBytes };
}

/** Create zero-masked deck for `count` cards. Returns serialized Vec<MaskedCard>. */
export function zeroMaskDeck(count: number): Uint8Array {
  return zero_mask_deck(count);
}

/**
 * Shuffle the deck. Takes serialized AggregatedPublicKeys + Vec<MaskedCard>.
 * Returns serialized ShuffleMessage (deck + ZK proof).
 */
export function shuffleDeck(
  aggKeyBytes: Uint8Array,
  deckBytes: Uint8Array,
): Uint8Array {
  return shuffle_deck(aggKeyBytes, deckBytes);
}

/**
 * Generate a reveal token for a masked card.
 * Returns serialized RevealMessage — submit on-chain or keep locally.
 */
export function proveRevealToken(
  keypairBytes: Uint8Array,
  cardBytes: Uint8Array,
): Uint8Array {
  return prove_reveal_token(keypairBytes, cardBytes);
}

/**
 * Pack individual serialized RevealMessages into a serialized Vec<RevealMessage>.
 * Arkworks Vec serialization = u64 LE length + concatenated elements.
 */
export function packRevealMessages(messages: Uint8Array[]): Uint8Array {
  const count = messages.length;
  const totalPayload = messages.reduce((sum, m) => sum + m.length, 0);
  const result = new Uint8Array(8 + totalPayload);
  // u64 LE length prefix
  const view = new DataView(result.buffer);
  view.setBigUint64(0, BigInt(count), true);
  let offset = 8;
  for (const msg of messages) {
    result.set(msg, offset);
    offset += msg.length;
  }
  return result;
}

/**
 * Unmask a card given all N reveal messages.
 * Returns the deck position (index into the 200-card deck).
 */
export function unmaskCard(
  revealMsgsBytes: Uint8Array,
  cardBytes: Uint8Array,
): number {
  return unmask_card(revealMsgsBytes, cardBytes);
}

/** Extract a single masked card from a serialized deck by index. */
export function getMaskedCard(
  deckBytes: Uint8Array,
  index: number,
): Uint8Array {
  return get_masked_card(deckBytes, index);
}

/** Extract the deck from a serialized ShuffleMessage. */
export function getShuffledDeck(shuffleMsgBytes: Uint8Array): Uint8Array {
  return get_shuffled_deck(shuffleMsgBytes);
}

/** Number of cards in a serialized deck. */
export function getDeckCardCount(deckBytes: Uint8Array): number {
  return deck_card_count(deckBytes);
}

/** Maximum supported deck size (200 for secp256k1). */
export function getMaxDeckSize(): number {
  return max_deck_size();
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
