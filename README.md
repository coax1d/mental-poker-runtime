# Mental Poker Runtime

A Substrate solochain that implements the [mental poker](https://en.wikipedia.org/wiki/Mental_poker) protocol on-chain, with a browser-based Exploding Kittens demo.

Players can deal, shuffle, and reveal cards without any trusted dealer. The chain verifies zero-knowledge proofs and stores encrypted game state, while all cryptographic operations run client-side in WebAssembly.

## Repository Layout

```
node/               Substrate node (block production, RPC, networking)
runtime/            Solochain runtime (WASM blob executed by the node)
pallets/mental-poker/  Custom pallet — game lifecycle, proof verification, card storage
client/             Exploding Kittens web app (Vite + React + TypeScript)
```

## Prerequisites

- **Rust** (nightly) with the `wasm32-unknown-unknown` target
- **Node.js** >= 18
- **wasm-pack** — `cargo install wasm-pack`
- **polkadot-sdk** checked out at `../polkadot-sdk`
- **mental-poker** checked out at `../mental-poker` (branch `wasm-bindings`)

## Building the Node

```bash
cargo build --release
```

The binary is at `target/release/mental-poker-node`.

## Running the Demo

### 1. Start the node

```bash
./target/release/mental-poker-node --dev
```

This starts a local dev chain at `ws://127.0.0.1:9944` with pre-funded Alice/Bob/Charlie/Dave accounts.

### 2. Build the WASM crypto bindings

```bash
cd client
npm install
npm run build:wasm
```

This compiles the mental-poker `play` crate to WebAssembly and copies the output into `client/src/wasm/pkg/`.

### 3. Generate PAPI type descriptors

With the node running:

```bash
npm run setup:papi
```

This connects to the node, reads the runtime metadata, and generates typed chain definitions in `.papi/descriptors/`.

### 4. Start the web app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 5. Play

- Read the **About** tab for an overview of how the game and cryptography work
- Switch to the **Play** tab
- Select number of players (2-4), deck size, and game speed
- Click **Start Game**
- Watch the game log as it progresses through: setup, registration, masking, shuffling, dealing, and play

The demo controls all players locally (simulation mode) so you can see the full protocol in action.

## How It Works

1. **Key Generation** — Each player generates a secp256k1 keypair and publishes a public key with a proof of knowledge
2. **Masking** — The plaintext deck is encrypted using all players' combined public keys
3. **Shuffling** — Each player re-randomizes and re-orders the encrypted deck, submitting a zero-knowledge proof that the shuffle is valid
4. **Revealing** — To reveal a card, every player submits a partial decryption token with a correctness proof; the card is only readable when all tokens are combined

The pallet verifies all proofs on-chain. No player can see cards early or manipulate the deck.

## Quick Reference

| Command | Description |
|---|---|
| `cargo build --release` | Build the node |
| `./target/release/mental-poker-node --dev` | Run local dev chain |
| `cd client && npm run build:wasm` | Build WASM crypto |
| `cd client && npm run setup:papi` | Generate chain type bindings |
| `cd client && npm run dev` | Start the web app |
