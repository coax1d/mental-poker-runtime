# Why `verify_shuffle` Is Expensive

## The Problem

The Bayer-Groth shuffle proof verifier may exceed the block weight limit on Polkadot Asset Hub (pallet-revive). The bottleneck is **CPU time**, not data size — the proof itself is compact (~7.7 KB for 52 cards), but the verifier must perform hundreds of elliptic curve operations internally.

## Block Weight Budget

| Metric | Value |
|--------|-------|
| Max block weight (ref_time) | 2,000,000,000,000 (2 seconds) |
| Normal dispatch allocation (75%) | 1,500,000,000,000 (~1.5 seconds) |
| `verify_player` measured cost | 163,243,274,786 (~8% of block) |
| `verify_shuffle` estimated cost | 50-100x `verify_player` = 400-800% of block |

A single contract call on Polkadot Hub has at most ~1.3-1.5 seconds of CPU time available. There is no mechanism for a contract call to span multiple blocks.

## Proof Size vs Verification Cost — The Key Distinction

Bayer-Groth is designed to be **communication-efficient**: the proof is sub-linear in deck size. For a 52-card deck, the entire `ShuffleMessage` serializes to only **7,710 bytes**:

| Component | Size |
|-----------|------|
| Shuffled deck (52 × 66 bytes) | 3,432 bytes |
| Bayer-Groth ZK proof | ~4,148 bytes |
| Player public key + ownership sig | ~130 bytes |
| **Total ShuffleMessage** | **~7,710 bytes** |

The pallet's `MAX_SHUFFLE_SIZE = 262,144` (256 KB) is a generous upper bound for very large decks (up to 200 cards). For our 52-card Exploding Kittens demo, the data is small.

**The expense comes from what the verifier must compute, not how much data it receives.** A small, elegant proof can still require expensive verification — that's the fundamental tradeoff in zero-knowledge proof systems (compact proofs often shift work to the verifier).

## What Bayer-Groth Shuffle Verification Actually Does

The verifier confirms that an encrypted deck was correctly permuted and re-encrypted (re-masked) without revealing the permutation. It runs **three nested zero-knowledge arguments**:

### 1. Multi-Exponentiation Argument (the bottleneck)

For a 52-card deck arranged as an m × n matrix (m=4, n=13 via `mid_factor(52)`), the verifier runs a **diagonal computation** that is O(m²) in ciphertext operations. Each ciphertext operation involves 2 elliptic curve scalar multiplications on secp256k1.

```
for each of m rows:
    multiply m scalars by a challenge power       (m scalar mults)
    dot-product with m ciphertexts                (m EC point additions)
= m × (m scalar mults + m point additions) = O(m²) group operations
```

For 52 cards (m=4, n=13): ~200+ group operations in this step alone.

### 2. Matrix Elements Product Argument

Verifies the permutation is valid via a Hadamard product check. Involves O(m·n) group element additions, plus a nested **zero-value bilinear map** sub-argument with its own commitment checks and field operations.

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

The proof's small wire size (~7.7 KB) is deceptive — it encodes commitments and blinded values that the verifier must expand back into full verification equations over the entire m×n matrix of ciphertexts.

## How Proof Size and Verification Cost Scale with Deck Size

| Deck Size | Matrix (m×n) | Proof Size (approx) | Verification Cost |
|-----------|-------------|---------------------|-------------------|
| 8 cards | 2×4 | ~2 KB | Baseline |
| 52 cards | 4×13 | ~7.7 KB | ~16x baseline (m²=16) |
| 100 cards | 10×10 | ~15 KB | ~100x baseline (m²=100) |
| 200 cards | 10×20 | ~30 KB | ~100x baseline |

Proof size grows as O(m + n) — sub-linear and compact.
Verification cost grows as O(m²) — the expensive diagonal computation dominates.

## Comparison: How Others Solved This

The **zkShuffle** project (mental poker on Ethereum) hit the same wall. Their solution: wrap the Bayer-Groth verification in a **Groth16 SNARK** — the prover generates the shuffle proof off-chain, then generates a constant-size SNARK proof that the verification passes. On-chain, only the SNARK is verified (~3 pairings, fixed cost regardless of deck size). The tradeoff is significant circuit complexity (~170K R1CS constraints).

## Options If It Doesn't Fit

1. **SNARK-wrap** the verification (constant on-chain cost, high implementation complexity)
2. **Multi-transaction incremental verification** (split across N blocks, needs careful state design)
3. **Optimistic verification + dispute** (verify off-chain, challenge on-chain with a dispute window)
4. **Stay on solochain** (full control over weight allocation, but not deployable on Polkadot Hub)
