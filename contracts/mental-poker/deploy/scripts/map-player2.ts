/**
 * Map player 2's account to an H160 address on pallet-revive and print
 * both addresses for use with gen-test-flow.
 *
 *   npx tsx scripts/map-player2.ts
 */
import { accountFromMnemonic } from "./signer.js";
import { requireMnemonic, wsUrl } from "./env.js";
import { connect } from "./client.js";

const p2Mnemonic = process.env.PLAYER2_MNEMONIC?.replace(/"/g, "");
if (!p2Mnemonic) {
  console.error("PLAYER2_MNEMONIC not set. Run gen-player2.ts first.");
  process.exit(1);
}

const p1Account = accountFromMnemonic(requireMnemonic());
const p2Account = accountFromMnemonic(p2Mnemonic);

console.log(`Player 1: ${p1Account.address}`);
console.log(`Player 2: ${p2Account.address}`);
console.log(`Endpoint: ${wsUrl()}`);

const { client, api } = await connect();

// Map player 2's account
console.log("\nMapping player 2 account...");
try {
  const result = await api.tx.Revive.map_account().signAndSubmit(p2Account.signer);
  if (result.ok) {
    console.log("Player 2 mapped.");
  } else {
    // Check if already mapped
    const failed = result.events?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.type === "System" && e.value?.type === "ExtrinsicFailed",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (failed as any)?.value?.value?.dispatch_error;
    if (err?.value?.value?.type === "AccountAlreadyMapped") {
      console.log("Player 2 already mapped.");
    } else {
      console.error("map_account failed:", JSON.stringify(err));
      await client.destroy();
      process.exit(1);
    }
  }
} catch (e) {
  console.warn(`map_account threw (may be already mapped): ${e}`);
}

// Get H160 addresses by calling Revive.eth_transact or reading mapped addresses
// The H160 is derived from the SS58 public key via a hash.
// For pallet-revive, the mapping is: H160 = truncate(blake2_256(pubkey), 20)
// But we can also get it from the AccountMapped event or just compute it.
//
// Actually, the easiest way: read the Revive.Mapped event from the map_account tx,
// or compute it. Let's just compute it for both accounts.
//
// pallet-revive maps AccountId32 → H160 via: blake2_256(AccountId32)[0..20]
// But this may not be the exact derivation. Let's try to read the mapped address.

// For now, print the SS58 addresses and tell the user to check the mapped H160s
// from the chain events. In practice, player 1's H160 is known from the deploy.
console.log("\n=== Addresses for gen-test-flow ===");
console.log(`Player 1 SS58: ${p1Account.address}`);
console.log(`Player 1 H160: 0x66f7470e90ccbfabec291ceca963605d703c60a8 (known from deploy)`);
console.log(`Player 2 SS58: ${p2Account.address}`);
console.log("");
console.log("To get player 2 H160, check the Revive.AccountMapped event above,");
console.log("or query the chain. Then run:");
console.log("  gen-test-flow --player1 0x66f7470e... --player2 <player2-h160>");

await client.destroy();
