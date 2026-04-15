# verify-spike — Path C Feasibility Status

Rust smart contract on `pallet-revive`, deployed to **Paseo Asset Hub (Passet Hub)**.
Goal: prove that full on-chain mental-poker verification (secp256k1 / arkworks) fits on a live Polkadot-family chain, so the game can be shipped through Triangle without self-hosting a solochain.

Branch: `contract-rewrite` in `mental-poker-runtime`.
Chain: **Paseo Asset Hub**, endpoint `wss://sys.ibp.network/asset-hub-paseo`.
Deployer: `13ozYGWD6pRpQ5viqsQ7szMQ6CCSYJLW8NnWgCdg427KRA5p` (mapped H160 `0x66f7470e90ccbfabec291ceca963605d703c60a8`).

---

## Stage progress

| Stage | Description | Status | Binary | Address |
|---|---|---|---|---|
| S1 | Hello-world PolkaVM contract builds | ✅ done | 186 B | — |
| S2 | Deployed + callable on Passet Hub | ✅ done | 183 B | `0x4a6c055fe20d97cc41ae697c62c21064a0a703a5` |
| S3 | `cards-protocol` + arkworks linked in | ✅ done | 28,428 B | `0x5433fec976ca9aff8fbfc8a5548a221ba042fb46` |
| S4 | `verify_player` running on-chain | ✅ done | 53,931 B | `0x428bd48b492ea5bf6d07ee768991e6267b8e5da4` |
| S5 | Deploy verifier to Passet Hub | ✅ subsumed by S4 | — | — |
| S6 | Measure `verify_player` weight | 🟡 partial | — | — |
| S7 | Implement + measure `verify_shuffle` | ⏳ next (real feasibility test) | — | — |

---

## Measured cost so far (S6 partial)

On `verify_player` with a 122-byte input (98-byte `PlayerHello` + 4-byte length prefix + 20-byte H160 name):

| Metric | Value | % of block budget |
|---|---|---|
| `ref_time` | 163,243,274,786 | ~8% of 2×10¹² |
| `proof_size` | 67,597 | well under limits |

Headroom: ~12× before we'd exhaust a block. That is the spike's first positive signal.

---

## Commits

| Hash | Stage | Summary |
|---|---|---|
| `f305a4a` | S1 | Path C spike scaffolded, hello-world builds |
| `815837e` | S2 pre | Deploy scripts + npm scaffolding |
| `d5bd362` | S2 pre | Passet Hub endpoint probed, PAPI descriptors generated |
| `017eeb8` | S2 | ReviveV1 linker + map_account + PAPI field fixes — deploy + call working |
| `617f460` | S3 | arkworks + cards-protocol linked; runtime work forces linkage |
| `59de09a` | S4 | `verify_player` on-chain, framed input, REVERT on fail, `gen-hello` tool |

---

## What we learned (non-obvious things)

1. **polkatool `link` hardcodes `TargetInstructionSet::Latest`.** pallet-revive only accepts `ReviveV1` and rejects anything else with `CodeRejected`. Fix: a host-side linker tool in `linker/` that calls `polkavm_linker::program_from_elf(config, ReviveV1, elf)` directly.
2. **Pin polkavm-derive to 0.30** to match what the chain's `pallet-revive-uapi` expects. polkavm-derive 0.31+ produces incompatible binaries.
3. **PAPI field names** for `Revive.instantiate_with_code` / `Revive.call`:
   - `weight_limit` (not `gas_limit`)
   - `storage_deposit_limit: bigint` (not `Option`)
   - `dest: FixedSizeBinary<20>`
4. **Accounts must be mapped first.** pallet-revive uses H160 internally; SS58 origins need `Revive.map_account` before they can instantiate or call.
5. **Dead-code elimination is aggressive.** Touching static constants from `cards-protocol` gets constant-folded at compile time. The link graph only survives if the call path does runtime-dependent work (read call_data, deserialize, actually run a verification).
6. **No SDK fixture uses heap.** All `substrate/frame/revive/fixtures/contracts/*.rs` avoid `Vec`/`Box` entirely, so there's no upstream pattern for `#[global_allocator]`. We hand-rolled a 256 KB bump allocator with no-op dealloc.
7. **Runtime APIs aren't in the PAPI descriptors.** `IRuntimeCalls = {}` — there's no typed `ReviveApi.call` for dry-run or return-value reading. Workaround: REVERT on failure paths so the pass/fail signal reaches extrinsic events.
8. **`ExhaustsResources` ≠ `OutOfGas`.** The first is "your requested `weight_limit` exceeds the per-block budget"; the second is "your contract consumed more than you requested." Don't pass absurd weight limits — start with 500 B ref_time.

---

## Layout

```
contracts/verify-spike/
├── src/main.rs               # no_std contract, bump allocator, verify_player
├── Cargo.toml                # polkavm-derive 0.30, pallet-revive-uapi 0.11,
│                             # cards-protocol + arkworks as path deps
├── Makefile                  # build host linker, build contract, run linker
├── riscv64emac-unknown-none-polkavm.json
├── linker/                   # host-side ReviveV1 linker (standalone workspace)
├── gen-hello/                # host-side PlayerHello generator (standalone)
├── contract.polkavm          # build output (gitignored)
└── deploy/                   # PAPI Node scripts
    ├── scripts/
    │   ├── gen-account.ts
    │   ├── deploy.ts         # includes map_account + instantiate
    │   ├── call.ts           # empty-input sanity call
    │   └── verify.ts         # submit framed verify_player blob
    ├── deployment.json       # last deploy's address (gitignored)
    └── .env                  # mnemonic (gitignored)
```

---

## How to run

```sh
# From contracts/verify-spike/
make                  # builds linker, compiles contract, links with ReviveV1

cd deploy
source ~/.nvm/nvm.sh && nvm use 24
npm run deploy        # ~1 PAS gas; prints address, saves deployment.json

# Generate a PlayerHello for the current H160 name and call verify_player:
cd ..
BLOB=$(./gen-hello/target/$(rustc -vV | awk '/^host:/ { print $2 }')/release/gen-hello \
  0x66f7470e90ccbfabec291ceca963605d703c60a8 | tail -1)

cd deploy
npm run verify -- "$BLOB"
# → System.ExtrinsicSuccess (weight: ref_time=~163B, proof_size=~68K)
```

Change the name bytes to a different H160 → `verify` should revert (`ExtrinsicFailed: ContractReverted`), proving the proof is actually transcript-bound.

---

## What's next — S7

S7 is the real feasibility test. `verify_shuffle` takes a full Bayer-Groth shuffle argument that runs to ~256 KB and performs the heaviest cryptographic work in the protocol. The question: does it fit in pallet-revive's weight limit on a single block?

Pallet reference: `pallets/mental-poker/src/lib.rs::submit_shuffle` → `params.verify_shuffle(...)`. The protocol implementation is in `../../mental-poker/protocol/src/shuffle.rs`.

Budget check: `verify_player` used ~8% of a 2-second block. `verify_shuffle` is roughly O(m·n·log(n)) for an m-of-n shuffle over 52 cards — empirically it's 10–30× a single Schnorr ID proof in the pallet, which would put us at 80–240% of a block. If it blows past the block limit, the spike fails as specified and we need a different architecture (batched verification, off-chain proof aggregation, or back to a solochain). **This is the kill point.**

---

## After the spike

If S7 fits:
1. Port all 6 pallet extrinsics + storage to the contract (mirror `pallet-mental-poker` exactly)
2. Refactor `client/src/chain.ts` to use PAPI ink-sdk against the deployed contract
3. Triangle integration: host detection, `createPapiProvider`, real Spektr accounts
4. Ship static frontend to IPFS + DotNS

If S7 doesn't fit, this spike ends here with the measurements as-is and we pick a different path.
