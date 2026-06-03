/**
 * Browser-extension wallet integration via polkadot-api/pjs-signer.
 *
 * Supports Talisman, SubWallet, polkadot-js extension — any extension that
 * implements the polkadot-js injected-web3 interface.
 *
 * Users import their test mnemonic into the extension once; the dapp never
 * sees plaintext keys. Each transaction prompts the extension to sign.
 */

import {
  connectInjectedExtension,
  getInjectedExtensions,
  type InjectedExtension,
  type InjectedPolkadotAccount,
} from "polkadot-api/pjs-signer";

const DAPP_NAME = "Exploding Kittens (Mental Poker)";

export type { InjectedExtension, InjectedPolkadotAccount };

/** Names of injected extensions detected in the page (e.g. "talisman", "subwallet-js", "polkadot-js"). */
export function listExtensions(): string[] {
  return getInjectedExtensions();
}

/** Prompt the user to grant the dapp access; returns an extension handle. */
export async function connectExtension(name: string): Promise<InjectedExtension> {
  return connectInjectedExtension(name, DAPP_NAME);
}

/** Snapshot of accounts visible to the dapp. */
export function listAccounts(ext: InjectedExtension): InjectedPolkadotAccount[] {
  return ext.getAccounts();
}
