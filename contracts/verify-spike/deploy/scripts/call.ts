/**
 * Call the deployed verify-spike contract on Passet Hub via dry-run.
 *
 *   npm run call
 *
 * Reads deployment.json, dry-runs Revive.call against the contract address,
 * decodes the 32-byte return as a Solidity uint32, and prints it.
 *
 * Expected return: 0xCAFEBABE.
 *
 * Uses dry-run rather than a signed extrinsic because the hello-world
 * contract doesn't mutate state — we just want to read the return value.
 */
import { Binary } from "polkadot-api";
import { loadDeployment, requireMnemonic, wsUrl } from "./env.js";
import { accountFromMnemonic } from "./signer.js";
import { connect } from "./client.js";

const deployment = loadDeployment();
console.log(`Calling ${deployment.contractAddress} on ${wsUrl()}`);

const account = accountFromMnemonic(requireMnemonic());
const { client, api } = await connect();

const callArgs = {
  dest: deployment.contractAddress,
  value: 0n,
  gas_limit: { ref_time: 100_000_000_000n, proof_size: 1_000_000n },
  storage_deposit_limit: undefined,
  data: Binary.fromBytes(new Uint8Array()),
};

console.log("Dry-running Revive.call ...");

let runtimeResult: unknown;
try {
  // pallet-revive exposes a runtime API for dry-run that returns the
  // contract's actual return data. PAPI surfaces it as `apis.ReviveApi.call`.
  runtimeResult = await api.apis.ReviveApi.call(
    account.address,
    deployment.contractAddress,
    0n, // value
    undefined, // gas_limit (None = use block gas limit)
    undefined, // storage_deposit_limit
    Binary.fromBytes(new Uint8Array()),
  );
} catch (e) {
  console.error(`apis.ReviveApi.call failed: ${e}`);
  console.error(
    "Falling back to inspecting the dispatchable's getEstimatedFees output...",
  );
  try {
    const fees = await api.tx.Revive.call(callArgs).getEstimatedFees(
      account.address,
    );
    console.log(`Estimated fees: ${fees}`);
  } catch (e2) {
    console.error(`getEstimatedFees also failed: ${e2}`);
  }
  await client.destroy();
  process.exit(1);
}

console.log("");
console.log("=== Dry-run result ===");
console.log(JSON.stringify(runtimeResult, replacer, 2));

// Try to extract return data and decode it.
// The exact shape depends on pallet-revive version; we probe a few paths.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const r = runtimeResult as any;
const returnData: Binary | undefined =
  r?.result?.value?.data ??
  r?.result?.Ok?.data ??
  r?.value?.data ??
  r?.data;

if (!returnData) {
  console.warn("Could not find return data in dry-run result; inspect output above.");
  await client.destroy();
  process.exit(2);
}

const bytes = returnData instanceof Binary ? returnData.asBytes() : returnData;
console.log(`Return data: ${Buffer.from(bytes).toString("hex")} (${bytes.length} bytes)`);

if (bytes.length === 32) {
  // Solidity uint32 is the last 4 bytes (big-endian) of the 32-byte slot.
  const value = new DataView(bytes.buffer, bytes.byteOffset + 28, 4).getUint32(
    0,
    false,
  );
  console.log(`Decoded uint32: 0x${value.toString(16).toUpperCase()}`);
  if (value === 0xCAFEBABE) {
    console.log("✓ Matches expected 0xCAFEBABE");
  } else {
    console.error(`✗ Expected 0xCAFEBABE, got 0x${value.toString(16)}`);
    await client.destroy();
    process.exit(3);
  }
}

await client.destroy();

// JSON.stringify replacer for bigints + Binary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function replacer(_key: string, value: any) {
  if (typeof value === "bigint") return value.toString() + "n";
  if (value instanceof Binary) return value.asHex();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return value;
}
