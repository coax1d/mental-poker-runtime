/**
 * Get the H160 addresses for both players.
 * Queries Revive storage for the address mapping.
 */
import { accountFromMnemonic } from "./signer.js";
import { requireMnemonic, wsUrl } from "./env.js";
import { connect } from "./client.js";
import { Binary, FixedSizeBinary } from "polkadot-api";
import { loadDeployment } from "./env.js";

const p2Mnemonic = process.env.PLAYER2_MNEMONIC?.replace(/"/g, "");
if (!p2Mnemonic) {
  console.error("PLAYER2_MNEMONIC not set.");
  process.exit(1);
}

const p1 = accountFromMnemonic(requireMnemonic());
const p2 = accountFromMnemonic(p2Mnemonic);
const { client, api } = await connect();
const deployment = loadDeployment();

// Call query_game (selector 0x10) from player 2 to discover their H160
// from the extrinsic events (the caller is embedded in the weight info).
// Actually simpler: just do a trivial Revive.call from p2 and read the events.

const destHex = deployment.contractAddress.startsWith("0x")
  ? deployment.contractAddress.slice(2)
  : deployment.contractAddress;
const destBytes = new Uint8Array(
  destHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)),
);

// Call query_game from player 2
console.log("Calling query_game from player 2 to discover H160...");
const result = await api.tx.Revive.call({
  dest: FixedSizeBinary.fromBytes(destBytes),
  value: 0n,
  weight_limit: { ref_time: 500_000_000_000n, proof_size: 5_000_000n },
  storage_deposit_limit: 10_000_000_000_000n,
  data: Binary.fromBytes(new Uint8Array([0x10])), // query_game selector
}).signAndSubmit(p2.signer);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asHex = (v: any): string => {
  if (typeof v === "string") return v;
  if (v?.asHex) return v.asHex();
  if (v?.asBytes) return "0x" + Buffer.from(v.asBytes()).toString("hex");
  if (v instanceof Uint8Array) return "0x" + Buffer.from(v).toString("hex");
  return String(v);
};

for (const event of result.events ?? []) {
  if (event.type === "Revive" && event.value?.type === "Called") {
    console.log("Revive.Called event:");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = event.value.value as any;
    if (val) {
      for (const [k, v] of Object.entries(val)) {
        console.log(`  ${k}: ${asHex(v)}`);
      }
    }
  }
}

// Also try querying the address mapping storage
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = await (api as any).query.Revive.AddressSuffix.getValue(p2.address);
  if (mapped) {
    console.log("\nRevive.AddressSuffix for player 2:", asHex(mapped));
  }
} catch {
  // Storage query name might differ
}

try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = await (api as any).query.Revive.AccountCodes.getValue(p2.address);
  if (mapped) {
    console.log("\nRevive.AccountCodes for player 2:", asHex(mapped));
  }
} catch {
  // ignore
}

console.log("\nPlayer 1 SS58:", p1.address);
console.log("Player 1 H160: 0x66f7470e90ccbfabec291ceca963605d703c60a8");
console.log("Player 2 SS58:", p2.address);
console.log("Player 2 call ok:", result.ok);

await client.destroy();
