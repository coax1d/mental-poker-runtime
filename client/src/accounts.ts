/**
 * Dev account keyring for Substrate --dev node.
 *
 * Uses sr25519 key derivation from the standard dev phrase.
 */

import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";

const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);

export const DEV_ACCOUNT_NAMES = ["Alice", "Bob", "Charlie", "Dave", "Eve"];

export interface DevAccount {
  name: string;
  publicKey: Uint8Array;
  signer: PolkadotSigner;
}

const cache = new Map<string, DevAccount>();

/** Get a dev account by name (Alice, Bob, etc.). */
export function getDevAccount(name: string): DevAccount {
  const cached = cache.get(name);
  if (cached) return cached;

  const keypair = derive(`//${name}`);
  const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
  const account: DevAccount = {
    name,
    publicKey: keypair.publicKey,
    signer,
  };
  cache.set(name, account);
  return account;
}

/** Get N dev accounts for a game. */
export function getDevAccounts(count: number): DevAccount[] {
  if (count > DEV_ACCOUNT_NAMES.length) {
    throw new Error(`Only ${DEV_ACCOUNT_NAMES.length} dev accounts available`);
  }
  return DEV_ACCOUNT_NAMES.slice(0, count).map(getDevAccount);
}
