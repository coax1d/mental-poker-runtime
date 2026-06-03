/**
 * Test the mental-poker contract full 2-player flow.
 *
 * Usage:
 *   npx tsx scripts/test-flow.ts /path/to/test-flow.json [--full]
 *
 * Without --full: runs single-account subset (create, register p1, query).
 * With --full: runs the complete flow using both player accounts:
 *   create_game → register_player1 → register_player2 → submit_agreed_deck
 *   → reveal_card0_player1 → reveal_card0_player2
 *
 * Requires PLAYER2_MNEMONIC in .env for --full mode.
 */
import { readFileSync } from "node:fs";
import { Binary, FixedSizeBinary } from "polkadot-api";
import type { PolkadotSigner } from "polkadot-api";
import { loadDeployment, requireMnemonic, wsUrl } from "./env.js";
import { accountFromMnemonic } from "./signer.js";
import { connect } from "./client.js";

const jsonPath = process.argv[2];
const fullMode = process.argv.includes("--full");

if (!jsonPath) {
  console.error("usage: npx tsx scripts/test-flow.ts /path/to/test-flow.json [--full]");
  process.exit(2);
}

const payloads = JSON.parse(readFileSync(jsonPath, "utf-8"));
const deployment = loadDeployment();
const p1 = accountFromMnemonic(requireMnemonic());

let p2: { address: string; signer: PolkadotSigner } | null = null;
if (fullMode) {
  const p2Mnemonic = process.env.PLAYER2_MNEMONIC?.replace(/"/g, "");
  if (!p2Mnemonic) {
    console.error("PLAYER2_MNEMONIC not set in .env. Run gen-player2.ts first.");
    process.exit(1);
  }
  p2 = accountFromMnemonic(p2Mnemonic);
}

const { client, api } = await connect();

console.log(`Contract: ${deployment.contractAddress}`);
console.log(`Endpoint: ${wsUrl()}`);
console.log(`Player 1: ${p1.address}`);
if (p2) console.log(`Player 2: ${p2.address}`);
console.log(`Mode:     ${fullMode ? "FULL (2-player)" : "single-account"}`);
console.log("");

const destHex = deployment.contractAddress.startsWith("0x")
  ? deployment.contractAddress.slice(2)
  : deployment.contractAddress;
const destBytes = new Uint8Array(
  destHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stringifyBig = (v: any) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() + "n" : x), 2);

async function submitCall(
  name: string,
  hexPayload: string,
  signer: PolkadotSigner,
  refTimeLimit = 500_000_000_000n,
): Promise<boolean> {
  const clean = hexPayload.startsWith("0x") ? hexPayload.slice(2) : hexPayload;
  const input = new Uint8Array(
    clean.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)),
  );

  console.log(
    `--- ${name} (${input.length} bytes, selector=0x${input[0]?.toString(16).padStart(2, "0")}) ---`,
  );

  const callArgs = {
    dest: FixedSizeBinary.fromBytes(destBytes),
    value: 0n,
    weight_limit: { ref_time: refTimeLimit, proof_size: 5_000_000n },
    storage_deposit_limit: 10_000_000_000_000n,
    data: Binary.fromBytes(input),
  };

  try {
    const result = await api.tx.Revive.call(callArgs).signAndSubmit(signer);

    for (const event of result.events ?? []) {
      if (event.type === "System" && event.value?.type === "ExtrinsicSuccess") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = (event.value.value as any)?.dispatch_info?.weight;
        console.log(`  OK (ref_time=${w?.ref_time}, proof_size=${w?.proof_size})`);
      } else if (event.type === "System" && event.value?.type === "ExtrinsicFailed") {
        console.log(`  FAILED: ${stringifyBig(event.value.value)}`);
      }
    }

    if (!result.ok) {
      console.log(`  Result: FAILED (contract reverted or trapped)`);
      return false;
    }
    console.log(`  Result: SUCCESS`);
    return true;
  } catch (e) {
    console.log(`  Error: ${e}`);
    return false;
  }
}

// Build the step list based on mode
// [name, payload, signer, refTimeLimit?]
type Step = [string, string, PolkadotSigner, bigint?];

const GAS_DEFAULT = 500_000_000_000n;
const GAS_HIGH = 1_200_000_000_000n;  // for multi-sig verification + deck deser

const steps: Step[] = fullMode
  ? [
      ["create_game", payloads.create_game, p1.signer],
      ["query_game", payloads.query_game, p1.signer],
      ["register_player1", payloads.register_player1, p1.signer],
      ["register_player2", payloads.register_player2, p2!.signer],
      ["query_game (all registered)", payloads.query_game, p1.signer],
      ["submit_agreed_deck", payloads.submit_agreed_deck, p1.signer, GAS_HIGH],
      ["query_game (playing)", payloads.query_game, p1.signer],
      ["reveal_card0_player1", payloads.reveal_card0_player1, p1.signer],
      ["reveal_card0_player2", payloads.reveal_card0_player2, p2!.signer],
      ["query_game (after reveals)", payloads.query_game, p1.signer],
    ]
  : [
      ["create_game", payloads.create_game, p1.signer],
      ["query_game", payloads.query_game, p1.signer],
      ["register_player1", payloads.register_player1, p1.signer],
      ["query_game (after register)", payloads.query_game, p1.signer],
    ];

console.log(`=== Running ${steps.length} steps ===\n`);

let allOk = true;
for (const [name, payload, signer, gasLimit] of steps) {
  const ok = await submitCall(name, payload, signer, gasLimit ?? GAS_DEFAULT);
  if (!ok) {
    allOk = false;
    console.log(`\nStopping — ${name} failed.`);
    break;
  }
  console.log("");
}

if (allOk) {
  console.log(`=== All ${steps.length} steps passed ===`);
}

await client.destroy();
