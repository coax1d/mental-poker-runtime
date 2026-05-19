import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Address,
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";

export interface Account {
  publicKey: Uint8Array;
  address: string;
  signer: PolkadotSigner;
}

/** Derive an sr25519 account from a BIP39 mnemonic. */
export function accountFromMnemonic(
  mnemonic: string,
  ss58Prefix = 0,
): Account {
  const entropy = mnemonicToEntropy(mnemonic);
  const miniSecret = entropyToMiniSecret(entropy);
  const derive = sr25519CreateDerive(miniSecret);
  const keypair = derive(""); // root derivation
  const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
  return {
    publicKey: keypair.publicKey,
    address: ss58Address(keypair.publicKey, ss58Prefix),
    signer,
  };
}
