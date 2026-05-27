/**
 * Account management for the mental-poker contract on Paseo Asset Hub.
 *
 * Derives sr25519 accounts from mnemonics and computes their H160
 * (pallet-revive mapped) addresses.
 */

import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";
import type { PlayerAccount } from "./harness";

/**
 * Derive a PlayerAccount from a mnemonic phrase.
 * Computes the H160 via keccak256(pubkey)[12..32] — the pallet-revive mapping.
 */
export async function accountFromMnemonic(
  name: string,
  mnemonic: string,
): Promise<PlayerAccount> {
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keypair = derive(""); // root derivation

  const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);

  // Compute H160: keccak256(AccountId32)[12..32]
  // Use the subtle crypto API (available in browsers and Node 18+)
  const h160 = await computeH160(keypair.publicKey);

  return { name, signer, h160 };
}

/**
 * Compute H160 from a 32-byte public key using keccak256.
 * pallet-revive derivation: H160 = keccak256(pubkey)[12..32]
 */
async function computeH160(pubkey: Uint8Array): Promise<Uint8Array> {
  // keccak256 is not in WebCrypto API, so we use a JS implementation.
  // Import from the wasm pkg's dependency chain or use a minimal impl.
  // For now, use the keccak256 from @noble/hashes if available, or
  // fall back to a manual implementation.
  try {
    // @noble/hashes is a transitive dependency of polkadot-api
    const { keccak_256 } = await import("@noble/hashes/sha3");
    const hash = keccak_256(pubkey);
    return new Uint8Array(hash.slice(12, 32));
  } catch {
    // Fallback: if @noble/hashes not available, try the global keccak
    throw new Error(
      "keccak256 not available. Install @noble/hashes or ensure polkadot-api is installed.",
    );
  }
}

/**
 * Compute H160 from an already-known hex address string.
 */
export function h160FromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(
    clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
}
