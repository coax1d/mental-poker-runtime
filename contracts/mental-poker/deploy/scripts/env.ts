import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEPLOY_DIR = resolve(__dirname, "..");
export const CONTRACT_DIR = resolve(DEPLOY_DIR, "..");
export const CONTRACT_PVM = resolve(CONTRACT_DIR, "contract.polkavm");
export const DEPLOYMENT_JSON = resolve(DEPLOY_DIR, "deployment.json");
export const ENV_FILE = resolve(DEPLOY_DIR, ".env");

// The "official" wss://testnet-passet-hub.polkadot.io endpoint is dead.
// IBP serves the same chain (Paseo Asset Hub, which now hosts pallet-revive
// for Polkadot Hub TestNet) and proved fastest in probing.
// Override via PASSET_HUB_WS in .env if you need a different endpoint.
export const DEFAULT_WS = "wss://sys.ibp.network/asset-hub-paseo";

export function wsUrl(): string {
  return process.env.PASSET_HUB_WS ?? DEFAULT_WS;
}

export function requireMnemonic(): string {
  const m = process.env.PASSET_HUB_MNEMONIC;
  if (!m || m.trim() === "") {
    throw new Error(
      "PASSET_HUB_MNEMONIC missing. Run `npm run gen-account` first " +
        "(or populate .env from .env.example).",
    );
  }
  return m.trim();
}

export function requireAddress(): string {
  const a = process.env.PASSET_HUB_ADDRESS;
  if (!a || a.trim() === "") {
    throw new Error("PASSET_HUB_ADDRESS missing. Run `npm run gen-account` first.");
  }
  return a.trim();
}

export function readContractCode(): Uint8Array {
  if (!existsSync(CONTRACT_PVM)) {
    throw new Error(
      `contract.polkavm not found at ${CONTRACT_PVM}. Run \`make\` in ${CONTRACT_DIR}.`,
    );
  }
  return new Uint8Array(readFileSync(CONTRACT_PVM));
}

export interface Deployment {
  contractAddress: string; // H160 hex or SS58 — depends on pallet-revive version
  codeHash: string;
  deployedAt: string;
  network: string;
  deployer: string;
}

export function saveDeployment(d: Deployment): void {
  writeFileSync(DEPLOYMENT_JSON, JSON.stringify(d, null, 2) + "\n");
}

export function loadDeployment(): Deployment {
  if (!existsSync(DEPLOYMENT_JSON)) {
    throw new Error(`deployment.json not found at ${DEPLOYMENT_JSON}. Run \`npm run deploy\` first.`);
  }
  return JSON.parse(readFileSync(DEPLOYMENT_JSON, "utf-8"));
}

/** Append or update a key=value line in .env. */
export function writeEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (existsSync(ENV_FILE)) {
    lines = readFileSync(ENV_FILE, "utf-8").split("\n");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && match[1] in updates) {
      out.push(`${match[1]}=${updates[match[1]]}`);
      seen.add(match[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(ENV_FILE, out.join("\n"));
}
