/**
 * Generate a fresh sr25519 account for deploying to Passet Hub.
 *
 *   npm run gen-account
 *
 * Writes the mnemonic to `.env` (gitignored) and prints the SS58 address
 * so you can fund it from https://faucet.polkadot.io
 * (select "Passet Hub: smart contracts").
 */
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { accountFromMnemonic } from "./signer.js";
import { writeEnv, ENV_FILE } from "./env.js";

const mnemonic = generateMnemonic();
const account = accountFromMnemonic(mnemonic);

writeEnv({
  PASSET_HUB_MNEMONIC: `"${mnemonic}"`,
  PASSET_HUB_ADDRESS: account.address,
});

console.log("");
console.log("=== New Passet Hub account ===");
console.log("");
console.log(`  SS58 address:  ${account.address}`);
console.log("");
console.log(`  Mnemonic written to: ${ENV_FILE}`);
console.log("  (gitignored — do not share)");
console.log("");
console.log("Next steps:");
console.log("  1. Fund this address at https://faucet.polkadot.io");
console.log("     → select \"Passet Hub: smart contracts\"");
console.log("  2. Once funded, run: npm run deploy");
console.log("");
