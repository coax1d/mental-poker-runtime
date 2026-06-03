/**
 * Player account derivation for the mental-poker contract on Paseo Asset Hub.
 *
 * Accounts come from a browser extension (Talisman / SubWallet / polkadot-js).
 * The dapp never sees plaintext mnemonics.
 *
 * Each SS58 account maps to a pallet-revive H160 via keccak256(pubkey)[12..32].
 */

import { getSs58AddressInfo } from "polkadot-api";
import type { InjectedPolkadotAccount } from "./wallet";
import type { PlayerAccount } from "./harness";

/**
 * Wrap an injected (extension) account into a PlayerAccount for the harness.
 * Each tx will prompt the extension for signature.
 */
export async function accountFromInjected(
  name: string,
  injected: InjectedPolkadotAccount,
): Promise<PlayerAccount> {
  const info = getSs58AddressInfo(injected.address);
  if (!info.isValid) {
    throw new Error(`Invalid SS58 address from extension: ${injected.address}`);
  }
  const h160 = await computeH160(info.publicKey);
  return { name, signer: injected.polkadotSigner, h160 };
}

/** pallet-revive H160 derivation: keccak256(AccountId32)[12..32]. */
async function computeH160(pubkey: Uint8Array): Promise<Uint8Array> {
  const { keccak_256 } = await import("@noble/hashes/sha3");
  const hash = keccak_256(pubkey);
  return new Uint8Array(hash.slice(12, 32));
}

/** Parse a hex H160 string into 20 bytes. */
export function h160FromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/** Format 20 bytes as a 0x-prefixed lowercase hex string. */
export function h160ToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
