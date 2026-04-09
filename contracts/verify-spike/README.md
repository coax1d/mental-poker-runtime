# verify-spike

Spike contract for Path C of the mental-poker Triangle deployment plan:
prove that a Rust contract on `pallet-revive` can import `cards-protocol` +
arkworks and run the pallet's shuffle / hello / reveal verifications on-chain.

This crate is an **independent workspace** so it does not pollute the main
`mental-poker-runtime` workspace.

## Prerequisites

```sh
rustup toolchain install nightly --component rust-src
cargo install polkatool
```

Alternatively, use stable rust with `RUSTC_BOOTSTRAP=1` (what the Makefile does).

## Build

```sh
make          # builds + links → contract.polkavm
make stats    # polkatool stats contract.polkavm
make disasm   # polkatool disassemble contract.polkavm
make clean
```

Output: `contract.polkavm` — PolkaVM bytecode ready for `Revive.upload_code`.

## Spike stages

- **S1** (here) — hello world. Returns `0xCAFEBABE` as a Solidity `uint32`.
- **S2** — deploy S1 to Passet Hub, call it.
- **S3** — add `cards-protocol` as a dep, rebuild. Check binary size.
- **S4** — implement `verify_player` on-chain.
- **S5** — deploy S4 to Passet Hub.
- **S6** — measure `verify_player` gas/weight.
- **S7** — implement and measure `verify_shuffle` (the feasibility gate).
