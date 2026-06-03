import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { wsUrl } from "./env.js";

/** Connect to Passet Hub. Returns the typed API + the underlying client. */
export async function connect() {
  // Lazily import descriptors so this module can be loaded before
  // `npm run papi:add` has been executed (the deploy command will fail
  // with a clearer error in env.ts if the contract is missing).
  const { passet } = await import("@polkadot-api/descriptors");
  const provider = getWsProvider(wsUrl());
  const client = createClient(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = client.getTypedApi(passet) as any;
  return { client, api };
}
