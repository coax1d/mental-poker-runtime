//! Generate a test `PlayerHello` + framed input blob for the verify-spike
//! contract, and print it as hex on stdout.
//!
//! Usage: `gen-hello <name-hex>` or `gen-hello --name-ascii <ascii-string>`.
//!
//! The contract expects the input layout:
//!   [0..4]   u32 hello_len (big-endian)
//!   [4..]    hello_bytes (arkworks-compressed PlayerHello<secp256k1::Projective>)
//!   [4+N..]  name_bytes
//!
//! The name must exactly match the `player_public_info` the contract uses,
//! because it's mixed into the Fiat-Shamir transcript on both sides.

use ark_serialize::CanonicalSerialize;
use ark_std::rand::SeedableRng;
use std::env;

fn decode_hex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("invalid hex"))
        .collect()
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn main() {
    let mut args = env::args().skip(1);
    let first = args.next().unwrap_or_else(|| {
        eprintln!("usage: gen-hello <hex> | --name-ascii <ascii> [--seed <u64>]");
        std::process::exit(2);
    });

    let (name, remaining): (Vec<u8>, Vec<String>) = if first == "--name-ascii" {
        let ascii = args.next().expect("--name-ascii needs a value");
        (ascii.into_bytes(), args.collect())
    } else {
        (decode_hex(&first), args.collect())
    };

    // Deterministic RNG so the emitted blob is reproducible across runs.
    let mut seed: u64 = 0xC0FFEE_DEAD_BEEF;
    let mut iter = remaining.into_iter();
    while let Some(tok) = iter.next() {
        if tok == "--seed" {
            seed = iter
                .next()
                .expect("--seed needs a value")
                .parse()
                .expect("--seed must be u64");
        }
    }
    let mut rng = ark_std::rand::rngs::StdRng::seed_from_u64(seed);

    let params = deck_secp256k1::PARAMS;
    let (hello, _keypair) = params.generate_player(&mut rng, name.as_slice());

    let mut hello_bytes: Vec<u8> = Vec::new();
    hello
        .serialize_compressed(&mut hello_bytes)
        .expect("hello serialization");

    eprintln!("# name bytes ({} bytes): {}", name.len(), encode_hex(&name));
    eprintln!("# hello bytes ({} bytes): {}", hello_bytes.len(), encode_hex(&hello_bytes));

    // Framed input: u32 BE hello_len | hello_bytes | name_bytes.
    let mut blob: Vec<u8> = Vec::with_capacity(4 + hello_bytes.len() + name.len());
    blob.extend_from_slice(&(hello_bytes.len() as u32).to_be_bytes());
    blob.extend_from_slice(&hello_bytes);
    blob.extend_from_slice(&name);
    println!("{}", encode_hex(&blob));
}
