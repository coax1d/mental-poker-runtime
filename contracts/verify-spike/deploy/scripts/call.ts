/**
 * Call the deployed verify-spike contract on Passet Hub.
 *
 *   npm run call
 *
 * Submits a `Revive.call` extrinsic against the deployed contract and checks
 * that it ran successfully. The hello-world contract's return value (0xCAFEBABE)
 * isn't surfaced through events, but successful execution proves the binary
 * was accepted and the `call` export ran without trapping.
 *
 * For an actual read of the return value we'd need the `ReviveApi.call`
 * runtime API, which isn't exposed in the Passet Hub PAPI descriptors.
 * We can wire that up later via a raw `state_call` RPC if needed.
 */
import { Binary, FixedSizeBinary } from "polkadot-api";
import { loadDeployment, requireMnemonic, wsUrl } from "./env.js";
import { accountFromMnemonic } from "./signer.js";
import { connect } from "./client.js";

const deployment = loadDeployment();
console.log(`Calling ${deployment.contractAddress} on ${wsUrl()}`);

const account = accountFromMnemonic(requireMnemonic());
const { client, api } = await connect();

// Convert the 0x-prefixed 20-byte address into a FixedSizeBinary<20>.
const destHex = deployment.contractAddress.startsWith("0x")
  ? deployment.contractAddress.slice(2)
  : deployment.contractAddress;
const destBytes = new Uint8Array(
  destHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
);
if (destBytes.length !== 20) {
  console.error(`expected 20-byte contract address, got ${destBytes.length}`);
  await client.destroy();
  process.exit(1);
}

const callArgs = {
  dest: FixedSizeBinary.fromBytes(destBytes),
  value: 0n,
  weight_limit: { ref_time: 500_000_000_000n, proof_size: 5_000_000n },
  storage_deposit_limit: 10_000_000_000_000n,
  data: Binary.fromBytes(new Uint8Array()),
};

console.log("Submitting Revive.call ...");
const result = await api.tx.Revive.call(callArgs).signAndSubmit(account.signer);

console.log("");
console.log("=== Submission result ===");
console.log(`block: ${result.block?.hash ?? "?"}`);
console.log(`ok: ${result.ok}`);
console.log(`events: ${result.events?.length ?? 0}`);

for (const event of result.events ?? []) {
  if (event.type === "Revive") {
    console.log(`  Revive.${event.value?.type}`);
  } else if (event.type === "System" && event.value?.type === "ExtrinsicFailed") {
    console.error(`ExtrinsicFailed:`, JSON.stringify(event.value.value, (_k, v) =>
      typeof v === "bigint" ? v.toString() + "n" : v, 2));
  } else if (event.type === "System" && event.value?.type === "ExtrinsicSuccess") {
    console.log(`  System.ExtrinsicSuccess`);
  }
}

if (!result.ok) {
  console.error("Call failed.");
  await client.destroy();
  process.exit(1);
}

console.log("");
console.log("✓ Contract call succeeded — the deployed binary is executable.");
console.log("  (0xCAFEBABE return value not surfaced via extrinsic events;");
console.log("   will verify via state_call ReviveApi_call in a follow-up.)");

await client.destroy();
