# Mental Poker on Paseo Asset Hub

A browser-based Exploding Kittens demo built on the [mental poker protocol](https://en.wikipedia.org/wiki/Mental_poker): players deal, shuffle, and reveal cards with no trusted dealer.

Architecture: shuffles run **off-chain** between players (browser WASM). A Rust contract on `pallet-revive` verifies the cryptography that matters — player key ownership, deck-agreement signatures, and per-card reveal proofs — so cheaters get rejected at submission, not just caught client-side.

```
contracts/mental-poker/   Rust contract → PolkaVM bytecode for pallet-revive
client/                   React + Vite app (game UI + WASM crypto)
```

## Quickstart

You'll need:

- **Rust** stable (a JSON target spec for `riscv64emac-unknown-none-polkavm` is checked in)
- **Node.js** ≥ 18 (24 tested via nvm)
- **[polkatool](https://github.com/paritytech/polkavm)** — `cargo install polkatool` (for inspecting the built contract; the build itself uses a vendored polkavm-linker)
- **A Polkadot wallet extension** — [Talisman](https://talisman.xyz/), [SubWallet](https://subwallet.app/), or [polkadot-js extension](https://polkadot.js.org/extension/)
- **PAS** on Paseo Asset Hub — get it from [faucet.polkadot.io](https://faucet.polkadot.io/) → *Polkadot Testnet (Paseo)* → *Hub (Contracts)*

The build also expects the `mental-poker` protocol crate checked out next to this repo. The client's `build:wasm` script consumes it:

```bash
git clone https://github.com/coax1d/mental-poker.git ../mental-poker
```

> ⚠️ Temporary: we point at the [`coax1d/mental-poker`](https://github.com/coax1d/mental-poker) fork because the WASM bindings and several supporting protocol changes haven't landed in [`paritytech/mental-poker`](https://github.com/paritytech/mental-poker) yet. Once they do, this will switch back to the upstream URL.

### 1. Build the contract

```bash
cd contracts/mental-poker
make
```

Produces `contract.polkavm` (~75 KB).

### 2. Deploy to Paseo Asset Hub

```bash
cd contracts/mental-poker/deploy
npm install
cp .env.example .env   # then edit .env with a funded SS58 mnemonic + address

npm run papi:add       # fetch chain metadata (one-time)
npm run deploy         # instantiate; writes deployment.json
```

> **Need a fresh account?** Any SS58 wallet works (polkadot.js, Talisman, SubWallet — generate, then export the mnemonic into `.env`). Fund it from [faucet.polkadot.io](https://faucet.polkadot.io/) → *Polkadot Testnet (Paseo)* → *Hub (Contracts)*. The deploy script will auto-`map_account` it on first run.

The deploy script handles `Revive.map_account` for you. Copy the printed contract address into `client/src/App.tsx` (`DEFAULT_CONTRACT`), or paste it into the UI's Contract Address field at runtime.

> The contract is single-game-per-instance, but `create_game` is idempotent — it wipes any prior game's state before initializing, so one deployed contract handles many games.

### 3. Run the client

```bash
cd client
npm install
npm run setup        # builds the WASM crypto module + fetches PAPI metadata
npm run dev
```

Open <http://localhost:5173>:

1. Go to the **Play** tab and click **Connect** to grant Talisman (or whatever extension) access to two accounts.
2. Pick them from the **Player 1** and **Player 2** dropdowns. Both need PAS balance and will be auto-mapped on `pallet-revive` if not already.
3. Click **Start Game**.

Each transaction prompts your wallet to sign. Block time on Paseo AH is ~6 s, which is the floor for per-tx wait. A 5-card deal in 2-player runs ~10 reveal txs before play begins.

## How the cryptography lands on chain

| Selector | Message | What the contract verifies |
|---|---|---|
| `0x01` | `create_game` | Wipes any prior game, stores new `GameInfo` |
| `0x02` | `register_player(hello)` | Schnorr proof of secret-key ownership (`verify_player`) |
| `0x03` | `submit_agreed_deck(deck, sigs[])` | One `verify_key_ownership` per player against the deck bytes |
| `0x04` | `submit_reveal(card_idx, msg)` | Per-card discrete-log equality proof (`verify_single_reveal`) |
| `0x10` | `query_game()` | Read-only |

The heavy shuffle verification (`verify_shuffle`) is **not** on chain — it doesn't fit in pallet-revive's gas/heap budget. Players verify each other's shuffles off-chain before signing the agreed deck. The deck-agreement signatures (`0x03`) are what binds each player's commitment to the final shuffled deck.

## Development notes

- The contract is its own Cargo workspace (`contracts/mental-poker/`), independent of the client and of any host-side Rust workspaces.
- `make` in `contracts/mental-poker/` builds the contract via a vendored `polkavm-linker` (`linker/`) pinned to the polkavm 0.30 / `ReviveV1` target the chain expects. `polkatool link` won't work — it hardcodes `Latest`.
- Storage values in pallet-revive are capped at 416 bytes per entry; the deck is chunked at 400 bytes (`DECK_CHUNK_SIZE` in `src/main.rs`).
- The client's `build:wasm` script invokes `wasm-pack` against `../../mental-poker/play/`. Make sure that path is checked out.
