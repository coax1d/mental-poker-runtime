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

// Random 32-byte salt so re-runs don't collide on the deterministic address.
const salt = new Uint8Array(randomBytes(32));

const instantiateArgs = {
  value: 0n,
  // Pass `undefined` for gas_limit/storage_deposit_limit and let the runtime
  // pick. If the chain rejects this, we'll switch to dry-run-then-submit.
  gas_limit: { ref_time: 0n, proof_size: 0n },
  storage_deposit_limit: undefined,
  code: Binary.fromBytes(code),
  data: Binary.fromBytes(new Uint8Array()),
  salt: Binary.fromBytes(salt),
};

let dryRunResult: unknown;
try {
  console.log("Dry-running instantiate_with_code...");
  dryRunResult = await api.tx.Revive.instantiate_with_code(
    instantiateArgs,
  ).getEstimatedFees(account.address);
  console.log(`Estimated fees: ${dryRunResult}`);
} catch (e) {
  console.warn(`getEstimatedFees failed: ${e}`);
}

console.log("Submitting instantiate_with_code...");
const tx = api.tx.Revive.instantiate_with_code(instantiateArgs);
const result = await tx.signAndSubmit(account.signer);

console.log("");
console.log("=== Submission result ===");
console.log(`block: ${result.block?.hash ?? "?"}`);
console.log(`ok: ${result.ok}`);
console.log(`events: ${result.events?.length ?? 0}`);

let contractAddress: string | undefined;
let codeHash: string | undefined;
for (const event of result.events ?? []) {
  if (event.type === "Revive") {
    console.log(`  Revive.${event.value?.type}:`, event.value?.value);
    if (event.value?.type === "Instantiated") {
      contractAddress =
        event.value.value?.contract ??
        event.value.value?.deployer ??
        JSON.stringify(event.value.value);
    }
    if (event.value?.type === "CodeStored") {
      codeHash =
        event.value.value?.code_hash ??
        JSON.stringify(event.value.value);
    }
  } else if (event.type === "System" && event.value?.type === "ExtrinsicFailed") {
    console.error(`ExtrinsicFailed:`, event.value.value);
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
