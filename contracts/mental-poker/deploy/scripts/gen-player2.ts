/**
 * Generate a second sr25519 account (player 2) for testing the full game flow.
 *
 *   npx tsx scripts/gen-player2.ts
 *
 * Saves mnemonic to .env as PLAYER2_MNEMONIC. Prints the SS58 address
 * so you can fund it from the faucet.
 */
import { generateMnemonic } from "@polkadot-labs/hdkd-helpers";
import { accountFromMnemonic } from "./signer.js";
import { writeEnv, ENV_FILE } from "./env.js";

const mnemonic = generateMnemonic();
const account = accountFromMnemonic(mnemonic);

writeEnv({
  PLAYER2_MNEMONIC: `"${mnemonic}"`,
  PLAYER2_ADDRESS: account.address,
});

console.log("");
console.log("=== Player 2 account ===");
console.log(`  SS58 address: ${account.address}`);
console.log(`  Mnemonic written to: ${ENV_FILE}`);
console.log("");
console.log("Next steps:");
console.log("  1. Fund this address at https://faucet.polkadot.io");
console.log("     → select 'Paseo Asset Hub'");
console.log("  2. Then run: npx tsx scripts/map-player2.ts");
console.log("  3. Then run the full test flow");
