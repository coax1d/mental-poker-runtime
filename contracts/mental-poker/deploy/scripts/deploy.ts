/**
 * Deploy the verify-spike PolkaVM contract to Passet Hub.
 *
 *   npm run deploy
 *
 * Reads contract.polkavm from ../, signs with PASSET_HUB_MNEMONIC, and
 * submits Revive.instantiate_with_code as one atomic call. Saves the
 * contract address to deployment.json.
 *
 * Constructor input is empty (the hello-world `deploy()` export takes no args).
 */
import { Binary } from "polkadot-api";
import { randomBytes } from "node:crypto";
import {
  readContractCode,
  requireMnemonic,
  saveDeployment,
  wsUrl,
  type Deployment,
} from "./env.js";
import { accountFromMnemonic } from "./signer.js";
import { connect } from "./client.js";

const code = readContractCode();
console.log(`Loaded contract.polkavm (${code.length} bytes)`);

const account = accountFromMnemonic(requireMnemonic());
console.log(`Deployer: ${account.address}`);
console.log(`Endpoint: ${wsUrl()}`);

const { client, api } = await connect();

// pallet-revive works with EVM-style H160 addresses. Our SS58 account must be
// mapped before it can instantiate contracts. `map_account` is idempotent-ish:
// it errors with `AccountAlreadyMapped` if already done, which we swallow.
console.log("Ensuring account is mapped...");
try {
  const mapResult = await api.tx.Revive.map_account().signAndSubmit(account.signer);
  if (mapResult.ok) {
    console.log("Account mapped.");
  } else {
    // Check if the failure is "already mapped" — that's fine.
    const failed = mapResult.events?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.type === "System" && e.value?.type === "ExtrinsicFailed",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (failed as any)?.value?.value?.dispatch_error;
    if (err?.type === "Module" && err.value?.type === "Revive"
        && err.value?.value?.type === "AccountAlreadyMapped") {
      console.log("Account already mapped.");
    } else {
      console.error("map_account failed:", JSON.stringify(err, (_k, v) =>
        typeof v === "bigint" ? v.toString() + "n" : v, 2));
      await client.destroy();
      process.exit(1);
    }
  }
} catch (e) {
  console.warn(`map_account threw: ${e}`);
}

// Random 32-byte salt so re-runs don't collide on the deterministic address.
const salt = new Uint8Array(randomBytes(32));

// Step 1: dry-run via ReviveApi.instantiate to discover actual weight needed.
console.log("Dry-running via ReviveApi.instantiate...");
let refTime = 500_000_000_000n;   // generous fallback
let proofSize = 5_000_000n;
let storageDeposit = 10_000_000_000_000n; // 10 PAS fallback

try {
  const dryRun = await api.apis.ReviveApi.instantiate(
    account.address,    // origin
    0n,                 // value
    undefined,          // gas_limit (None = use block limit)
    undefined,          // storage_deposit_limit (None = use balance)
    Binary.fromBytes(code),
    Binary.fromBytes(new Uint8Array()), // data (constructor input)
    Binary.fromBytes(salt),
  );
  console.log("Dry-run result:", JSON.stringify(dryRun, (_k, v) =>
    typeof v === "bigint" ? v.toString() + "n" : v, 2));

  // Extract gas_required and storage_deposit from the dry-run result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dr = dryRun as any;
  if (dr?.gas_required) {
    refTime = BigInt(dr.gas_required.ref_time);
    proofSize = BigInt(dr.gas_required.proof_size);
    console.log(`Gas required: ref_time=${refTime}, proof_size=${proofSize}`);
  }
  if (dr?.storage_deposit?.value?.value != null) {
    storageDeposit = BigInt(dr.storage_deposit.value.value);
    console.log(`Storage deposit: ${storageDeposit}`);
  } else if (dr?.storage_deposit?.value != null && typeof dr.storage_deposit.value === "bigint") {
    storageDeposit = dr.storage_deposit.value;
    console.log(`Storage deposit: ${storageDeposit}`);
  }
} catch (e) {
  console.warn(`Dry-run failed, using fallback weights: ${e}`);
}

// Add 20% headroom to gas
const headroom = (n: bigint) => n + n / 5n;

const instantiateArgs = {
  value: 0n,
  weight_limit: { ref_time: headroom(refTime), proof_size: headroom(proofSize) },
  storage_deposit_limit: storageDeposit,
  code: Binary.fromBytes(code),
  data: Binary.fromBytes(new Uint8Array()),
  salt: Binary.fromBytes(salt),
};

console.log("Submitting instantiate_with_code...");
const tx = api.tx.Revive.instantiate_with_code(instantiateArgs);
const result = await tx.signAndSubmit(account.signer);

console.log("");
console.log("=== Submission result ===");
console.log(`block: ${result.block?.hash ?? "?"}`);
console.log(`ok: ${result.ok}`);
console.log(`events: ${result.events?.length ?? 0}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asHex = (v: any): string => {
  if (typeof v === "string") return v;
  if (v?.asHex) return v.asHex();
  if (v?.asBytes) return "0x" + Buffer.from(v.asBytes()).toString("hex");
  if (v instanceof Uint8Array) return "0x" + Buffer.from(v).toString("hex");
  return JSON.stringify(v);
};

let contractAddress: string | undefined;
let codeHash: string | undefined;
for (const event of result.events ?? []) {
  if (event.type === "Revive") {
    console.log(`  Revive.${event.value?.type}`);
    if (event.value?.type === "Instantiated") {
      contractAddress = asHex(event.value.value?.contract);
      console.log(`    contract: ${contractAddress}`);
      console.log(`    deployer: ${asHex(event.value.value?.deployer)}`);
    }
    if (event.value?.type === "CodeStored") {
      codeHash = asHex(event.value.value?.code_hash);
      console.log(`    code_hash: ${codeHash}`);
    }
  } else if (event.type === "System" && event.value?.type === "ExtrinsicFailed") {
    console.error(`ExtrinsicFailed:`, JSON.stringify(event.value.value, (_k, v) =>
      typeof v === "bigint" ? v.toString() + "n" : v, 2));
  }
}

if (!result.ok) {
  console.error("Deployment failed.");
  await client.destroy();
  process.exit(1);
}

if (!contractAddress) {
  console.warn(
    "No Revive.Instantiated event found — dumping all events for inspection:",
  );
  console.warn(JSON.stringify(result.events, null, 2));
  await client.destroy();
  process.exit(2);
}

const deployment: Deployment = {
  contractAddress,
  codeHash: codeHash ?? "(unknown)",
  deployedAt: new Date().toISOString(),
  network: wsUrl(),
  deployer: account.address,
};

saveDeployment(deployment);
console.log("");
console.log("=== Deployed ===");
console.log(`address:   ${deployment.contractAddress}`);
console.log(`code hash: ${deployment.codeHash}`);
console.log(`saved to:  deployment.json`);

await client.destroy();
