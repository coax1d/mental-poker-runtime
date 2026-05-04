# Why `verify_shuffle` Is Expensive

## The Problem

The Bayer-Groth shuffle proof verifier may exceed the block weight limit on Polkadot Asset Hub (pallet-revive). This document explains why at the cryptographic level and what the numbers look like.

## Block Weight Budget

| Metric | Value |
|--------|-------|
| Max block weight (ref_time) | 2,000,000,000,000 (2 seconds) |
| Normal dispatch allocation (75%) | 1,500,000,000,000 (~1.5 seconds) |
| `verify_player` measured cost | 163,243,274,786 (~8% of block) |
| `verify_shuffle` estimated cost | 50-100x `verify_player` = 400-800% of block |

A single contract call on Polkadot Hub has at most ~1.3-1.5 seconds of CPU time available. There is no mechanism for a contract call to span multiple blocks.

## What Bayer-Groth Shuffle Verification Actually Does

The verifier proves that an encrypted deck was correctly permuted and re-encrypted (re-masked) without revealing the permutation. It runs **three nested zero-knowledge arguments**:

### 1. Multi-Exponentiation Argument (the bottleneck)

For a 52-card deck arranged as an m x n matrix (e.g. 4 x 13), the verifier runs a **diagonal computation** that is O(m^2) in ciphertext operations. Each ciphertext operation involves 2 elliptic curve point multiplications on secp256k1.

```
for each of m rows:
    multiply m scalars by a challenge power       (m scalar mults)
    dot-product with m ciphertexts                (m EC point additions)
= m * (m scalar mults + m point additions) = O(m^2) group operations
```

For 52 cards (m=4, n=13): ~200+ group operations in this step alone.

### 2. Matrix Elements Product Argument

Verifies the permutation is valid via a Hadamard product check. Involves O(m*n) group element additions, plus a nested **zero-value bilinear map** sub-argument with its own commitment checks and field operations.

### 3. Pedersen Commitment Verification

Multiple multi-scalar multiplications (MSMs) via `msm_unchecked()` over n bases. Called 2+ times = O(n) curve operations each. MSM is one of the most expensive primitives in elliptic curve cryptography.

## Why It's 50-100x More Than `verify_player`

`verify_player` is essentially a single Schnorr-like proof: ~3-5 EC operations total.

`verify_shuffle` involves:
- Hundreds of EC scalar multiplications
- Hundreds of EC point additions
- Multiple MSMs over vectors of length n
- Three nested proof protocols, each with their own challenge-response verification
- All operating on El Gamal ciphertexts (2 EC points each, doubling the work)

## Why the Shuffle Message Is ~256 KB

The `ShuffleMessage` contains:
- **Shuffled deck**: 52 cards x ~66 bytes each (two compressed secp256k1 points per El Gamal ciphertext) = ~3.4 KB
- **Shuffle proof** (`ShuffleUnsigned.proof`):
  - m + n Pedersen commitments (~33 bytes each)
  - m + 1 ciphertexts in the multi-exponentiation proof (~66 bytes each)
  - n blinded scalars (~32 bytes each)
  - Nested sub-proofs (product argument, Hadamard, zero-value bilinear map)
- **Player public key + key ownership signature**: ~130 bytes

Total scales as O(m + n) for proof elements plus O(m*n) for the deck, reaching tens of KB for a 52-card deck.

## Comparison: How Others Solved This

The **zkShuffle** project (mental poker on Ethereum) hit the same wall. Their solution: wrap the Bayer-Groth verification in a **Groth16 SNARK** — the prover generates the shuffle proof off-chain, then generates a constant-size SNARK proof that the verification passes. On-chain, only the SNARK is verified (~3 pairings, fixed cost regardless of deck size). The tradeoff is significant circuit complexity (~170K R1CS constraints).

## Options If It Doesn't Fit

1. **SNARK-wrap** the verification (constant on-chain cost, high implementation complexity)
2. **Multi-transaction incremental verification** (split across N blocks, needs careful state design)
3. **Optimistic verification + dispute** (verify off-chain, challenge on-chain with a dispute window)
4. **Stay on solochain** (full control over weight allocation, but not deployable on Polkadot Hub)
