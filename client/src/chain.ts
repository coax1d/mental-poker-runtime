/**
 * Chain interaction via polkadot-api (PAPI) — contract-based architecture.
 *
 * All game operations are submitted as `Revive.call` extrinsics to the
 * mental-poker contract on Paseo Asset Hub. Shuffles happen off-chain;
 * the contract verifies player registration (Schnorr proofs), deck
 * agreement signatures, and reveal proofs.
 *
 * SETUP: The PAPI descriptors must be generated for Paseo Asset Hub:
 *   npx papi add passet -f ../passet.metadata.scale
 *
 * The contract address is passed as a parameter (from deployment.json
 * or hardcoded after deploy).
 */

import {
  createClient,
  type PolkadotSigner,
  type PolkadotClient,
  Binary,
  FixedSizeBinary,
} from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;
export type TypedApi = Api;

export interface ChainConnection {
  client: PolkadotClient;
  api: Api;
  contractAddress: string;
}

const DEFAULT_WS = "wss://sys.ibp.network/asset-hub-paseo";

/** Connect to Paseo Asset Hub. */
export async function connect(
  contractAddress: string,
  wsUrl: string = DEFAULT_WS,
): Promise<ChainConnection> {
  // Lazily import descriptors
  const { passet } = await import("@polkadot-api/descriptors");
  const provider = getWsProvider(wsUrl);
  const client = createClient(provider);
  const api = client.getTypedApi(passet);
  return { client, api, contractAddress };
}

/** Disconnect. */
export function disconnect(conn: ChainConnection): void {
  conn.client.destroy();
}

/** Query whether an account is already registered in pallet-revive's mapping. */
export async function isMapped(
  conn: ChainConnection,
  h160: Uint8Array,
): Promise<boolean> {
  const key = FixedSizeBinary.fromBytes(h160);
  const value = await conn.api.query.Revive.OriginalAccount.getValue(key);
  return value != null;
}

/**
 * Ensure the account is mapped on pallet-revive (SS58 → H160).
 * Queries storage first to avoid a ~6s tx round-trip when already mapped.
 * Only submits map_account if storage shows the account is unmapped.
 */
export async function ensureMapped(
  conn: ChainConnection,
  signer: PolkadotSigner,
  h160: Uint8Array,
): Promise<void> {
  if (await isMapped(conn, h160)) return;

  let result;
  try {
    result = await submitOnInclusion(conn.api.tx.Revive.map_account(), signer);
  } catch (e) {
    if (isAlreadyMappedError(e)) return;
    throw e;
  }
  if (result.ok) return;

  const failed = result.events?.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => e.type === "System" && e.value?.type === "ExtrinsicFailed",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = (failed as any)?.value?.value?.dispatch_error;
  if (
    err?.type === "Module" &&
    err.value?.type === "Revive" &&
    err.value?.value?.type === "AccountAlreadyMapped"
  ) {
    return;
  }
  throw new Error(`map_account failed: ${JSON.stringify(err)}`);
}

function isAlreadyMappedError(e: unknown): boolean {
  const s = String(e);
  return s.includes("AccountAlreadyMapped");
}

// --- Internal helpers ---

function destFromAddress(address: string): FixedSizeBinary<20> {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  const bytes = new Uint8Array(
    hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
  );
  return FixedSizeBinary.fromBytes(bytes);
}

/** Submit a contract call and return as soon as it's included in a best block (don't wait for finalization). */
async function callContract(
  conn: ChainConnection,
  signer: PolkadotSigner,
  data: Uint8Array,
  refTimeLimit = 500_000_000_000n,
): Promise<{ ok: boolean; refTime?: bigint; proofSize?: bigint }> {
  const tx = conn.api.tx.Revive.call({
    dest: destFromAddress(conn.contractAddress),
    value: 0n,
    weight_limit: { ref_time: refTimeLimit, proof_size: 5_000_000n },
    storage_deposit_limit: 10_000_000_000_000n,
    data: Binary.fromBytes(data),
  });

  const result = await submitOnInclusion(tx, signer);

  let refTime: bigint | undefined;
  let proofSize: bigint | undefined;

  for (const event of result.events ?? []) {
    if (event.type === "System" && event.value?.type === "ExtrinsicSuccess") {
      const w = (event.value.value as any)?.dispatch_info?.weight;
      refTime = w?.ref_time != null ? BigInt(w.ref_time) : undefined;
      proofSize = w?.proof_size != null ? BigInt(w.proof_size) : undefined;
    }
  }

  return { ok: result.ok, refTime, proofSize };
}

/**
 * Wrap signSubmitAndWatch: resolve as soon as the tx is found in a best block
 * (~one block time on Paseo AH, ~6s), instead of waiting for GRANDPA finalization (~12-18s).
 */
function submitOnInclusion(
  tx: { signSubmitAndWatch: (signer: PolkadotSigner) => any },
  signer: PolkadotSigner,
): Promise<{ ok: boolean; events: any[] }> {
  return new Promise((resolve, reject) => {
    let sub: { unsubscribe: () => void } | null = null;
    sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (ev: any) => {
        if (ev.type === "txBestBlocksState") {
          if (ev.found) {
            sub?.unsubscribe();
            resolve({ ok: ev.ok, events: ev.events ?? [] });
          } else if (!ev.isValid) {
            sub?.unsubscribe();
            reject(new Error("tx dropped from pool (invalid)"));
          }
        } else if (ev.type === "finalized") {
          // Fallback: if we somehow missed best-block state, resolve on finalized.
          sub?.unsubscribe();
          resolve({ ok: ev.ok, events: ev.events ?? [] });
        }
      },
      error: (err: unknown) => {
        sub?.unsubscribe();
        reject(err);
      },
    });
  });
}

// --- Contract message builders ---

/** Encode u16 big-endian */
function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

/** Encode u32 big-endian */
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

/** Concatenate Uint8Arrays */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// --- Selectors ---
const SEL_CREATE_GAME = 0x01;
const SEL_REGISTER_PLAYER = 0x02;
const SEL_SUBMIT_AGREED_DECK = 0x03;
const SEL_SUBMIT_REVEAL = 0x04;
const SEL_CLAIM_TIMEOUT = 0x05;
const SEL_QUERY_GAME = 0x10;

// --- Extrinsic Helpers ---

/**
 * Create a new game. Returns immediately (no game_id — single game per contract).
 */
export async function createGame(
  conn: ChainConnection,
  signer: PolkadotSigner,
  deckSize: number,
  numPlayers: number,
  timeoutBlocks = 100,
): Promise<void> {
  const data = concat(
    new Uint8Array([SEL_CREATE_GAME]),
    u16be(deckSize),
    new Uint8Array([numPlayers]),
    u32be(timeoutBlocks),
  );
  const result = await callContract(conn, signer, data);
  if (!result.ok) throw new Error("create_game failed (contract reverted)");
}

/**
 * Register a player. `playerHelloBytes` is the compressed PlayerHello
 * (keypair.prove_player(h160Address)).
 */
export async function registerPlayer(
  conn: ChainConnection,
  signer: PolkadotSigner,
  playerHelloBytes: Uint8Array,
): Promise<void> {
  const data = concat(
    new Uint8Array([SEL_REGISTER_PLAYER]),
    playerHelloBytes,
  );
  const result = await callContract(conn, signer, data);
  if (!result.ok) throw new Error("register_player failed (contract reverted)");
}

/**
 * Submit the agreed-upon deck with per-player signatures.
 *
 * @param deckBytes - Serialized Vec<MaskedCard> (compressed arkworks)
 * @param signatures - One ZKProofKeyOwnership per player, in registration order
 */
export async function submitAgreedDeck(
  conn: ChainConnection,
  signer: PolkadotSigner,
  deckBytes: Uint8Array,
  signatures: Uint8Array[],
): Promise<void> {
  const parts: Uint8Array[] = [
    new Uint8Array([SEL_SUBMIT_AGREED_DECK]),
    u32be(deckBytes.length),
    deckBytes,
  ];
  for (const sig of signatures) {
    parts.push(u32be(sig.length));
    parts.push(sig);
  }
  const data = concat(...parts);
  // Deck agreement verifies N signatures — needs more gas
  const result = await callContract(conn, signer, data, 1_200_000_000_000n);
  if (!result.ok) throw new Error("submit_agreed_deck failed (contract reverted)");
}

/**
 * Submit a reveal token for a specific card.
 */
export async function submitReveal(
  conn: ChainConnection,
  signer: PolkadotSigner,
  cardIndex: number,
  revealMsgBytes: Uint8Array,
): Promise<void> {
  const data = concat(
    new Uint8Array([SEL_SUBMIT_REVEAL]),
    u16be(cardIndex),
    revealMsgBytes,
  );
  const result = await callContract(conn, signer, data);
  if (!result.ok) throw new Error("submit_reveal failed (contract reverted)");
}

/**
 * Claim timeout — cancels the game if the deck deadline has passed.
 */
export async function claimTimeout(
  conn: ChainConnection,
  signer: PolkadotSigner,
): Promise<void> {
  const data = new Uint8Array([SEL_CLAIM_TIMEOUT]);
  const result = await callContract(conn, signer, data);
  if (!result.ok) throw new Error("claim_timeout failed");
}

// --- Game phase constants ---
export const PHASE_NONE = 0;
export const PHASE_REGISTRATION = 1;
export const PHASE_AWAITING_DECK = 2;
export const PHASE_PLAYING = 3;
export const PHASE_COMPLETE = 4;
export const PHASE_CANCELLED = 5;

export const PHASE_NAMES: Record<number, string> = {
  [PHASE_NONE]: "None",
  [PHASE_REGISTRATION]: "Registration",
  [PHASE_AWAITING_DECK]: "AwaitingDeck",
  [PHASE_PLAYING]: "Playing",
  [PHASE_COMPLETE]: "Complete",
  [PHASE_CANCELLED]: "Cancelled",
};

/** Game info as returned by the contract's query_game (selector 0x10). */
export interface GameInfo {
  phase: number;
  phaseName: string;
  deck_size: number;
  num_players: number;
  registered_count: number;
  deadline_block: number;
}

/**
 * Query game state. This submits a transaction (costs gas) since we can't
 * do dry-run calls via PAPI descriptors on Paseo Asset Hub yet.
 *
 * TODO: Switch to `state_call ReviveApi.call` or `eth_call` for free reads.
 */
export async function queryGame(
  conn: ChainConnection,
  signer: PolkadotSigner,
): Promise<GameInfo> {
  const data = new Uint8Array([SEL_QUERY_GAME]);
  const result = await callContract(conn, signer, data);
  if (!result.ok) throw new Error("query_game failed");
  // Note: we can't read the 32-byte return value from extrinsic events.
  // For now, return a placeholder — the harness tracks state locally.
  return {
    phase: PHASE_NONE,
    phaseName: "Unknown",
    deck_size: 0,
    num_players: 0,
    registered_count: 0,
    deadline_block: 0,
  };
}

// --- Polling Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until a condition is met. Uses a callback since we can't read
 * contract return data from extrinsic events.
 */
export async function waitFor(
  check: () => Promise<boolean>,
  signal?: { stopped: boolean },
  intervalMs = 2000,
): Promise<void> {
  while (true) {
    if (signal?.stopped) throw new Error("Stopped");
    if (await check()) return;
    await sleep(intervalMs);
  }
}
