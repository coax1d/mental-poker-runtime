/**
 * Wrapper for `papi add passet -w <url>` that:
 *  - reads PASSET_HUB_WS from .env (via dotenv)
 *  - falls back through a list of known-good Paseo Asset Hub endpoints
 *    if the preferred one is down
 *
 * Run via `npm run papi:add`.
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";

const FALLBACK_ENDPOINTS = [
  "wss://sys.ibp.network/asset-hub-paseo",
  "wss://asset-hub-paseo.dotters.network",
  "wss://asset-hub-paseo-rpc.n.dwellir.com",
];

const candidates: string[] = [];
const overrideUrl = process.env.PASSET_HUB_WS?.trim();
if (overrideUrl) candidates.push(overrideUrl);
for (const url of FALLBACK_ENDPOINTS) {
  if (!candidates.includes(url)) candidates.push(url);
}

const PER_URL_TIMEOUT_MS = 30_000;

for (const url of candidates) {
  console.log(`Trying ${url} (up to ${PER_URL_TIMEOUT_MS / 1000}s)...`);
  const result = spawnSync("npx", ["papi", "add", "passet", "-w", url], {
    stdio: "inherit",
    timeout: PER_URL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (result.status === 0) {
    console.log(`\n✓ Metadata loaded from ${url}`);
    process.exit(0);
  }
  if (result.signal) {
    console.warn(`  timed out after ${PER_URL_TIMEOUT_MS / 1000}s`);
  } else {
    console.warn(`  failed`);
  }
  console.warn(`  trying next endpoint`);
}

console.error("\nAll Paseo Asset Hub endpoints failed.");
console.error(
  "Set PASSET_HUB_WS in .env to a custom WS URL and re-run, " +
    "or check that your network can reach one of:",
);
for (const url of FALLBACK_ENDPOINTS) console.error(`  - ${url}`);
process.exit(1);
