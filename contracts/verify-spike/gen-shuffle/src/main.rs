//! Generate a test verify_shuffle payload for the verify-spike contract.
//!
//! Produces a framed blob containing:
//!   - selector (0x02)
//!   - player hellos (to reconstruct AggregatedPublicKeys on-chain)
//!   - the current (zero-masked) deck
//!   - a valid ShuffleMessage from player 1
//!
//! Usage:
//!   gen-shuffle [--deck-size N] [--num-players N] [--seed U64]
//!
//! Defaults: 52 cards, 2 players, seed 0xC0FFEE_DEAD_BEEF.
//! Output: hex-encoded framed blob on stdout, diagnostics on stderr.

use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_std::rand::SeedableRng;
use std::env;

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn main() {
    let mut deck_size: usize = 52;
    let mut num_players: usize = 2;
    let mut seed: u64 = 0xC0FFEE_DEAD_BEEF;

    // Simple arg parsing
    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--deck-size" => {
                i += 1;
                deck_size = args[i].parse().expect("--deck-size must be a number");
            }
            "--num-players" => {
                i += 1;
                num_players = args[i].parse().expect("--num-players must be a number");
            }
            "--seed" => {
                i += 1;
                seed = args[i].parse().expect("--seed must be u64");
            }
            other => {
                eprintln!("unknown arg: {}", other);
                eprintln!("usage: gen-shuffle [--deck-size N] [--num-players N] [--seed U64]");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    assert!(num_players >= 2, "need at least 2 players");
    assert!(deck_size >= 2, "need at least 2 cards");

    let mut rng = ark_std::rand::rngs::StdRng::seed_from_u64(seed);
    let params = deck_secp256k1::PARAMS;

    eprintln!("# Generating {} players, {} card deck, seed={:#x}", num_players, deck_size, seed);

    // Generate players
    let mut hellos = Vec::new();
    let mut keypairs = Vec::new();
    let mut names: Vec<Vec<u8>> = Vec::new();

    for p in 0..num_players {
        let name = format!("player{}", p).into_bytes();
        let (hello, keypair) = params.generate_player(&mut rng, name.as_slice());
        hellos.push(hello);
        keypairs.push(keypair);
        names.push(name);
    }

    // Build AggregatedPublicKeys
    let mut apk = params.create_aggregate_keys();
    for (hello, name) in hellos.iter().zip(names.iter()) {
        apk.verify_n_add(hello.clone(), name.as_slice())
            .expect("verify_n_add failed");
    }
    eprintln!("# APK built with {} players", num_players);

    // Create initial zero-masked deck
    let deck_affines = &deck_secp256k1::DECK_SECP256K1.0;
    assert!(
        deck_size <= deck_affines.len(),
        "deck_size {} exceeds available card encodings ({})",
        deck_size,
        deck_affines.len()
    );
    let initial_deck = cards_protocol::masking::zero_mask_affines::<ark_secp256k1::Projective>(
        deck_affines[..deck_size].iter(),
    );
    eprintln!("# Initial deck: {} cards", initial_deck.len());

    // Player 0 shuffles
    eprintln!("# Generating shuffle proof (this may take a moment) ...");
    let shuffle_msg = apk
        .shuffle_and_remask(&mut rng, &keypairs[0], &initial_deck)
        .expect("shuffle_and_remask failed");

    // Verify locally before emitting (sanity check)
    apk.verify_shuffle(&initial_deck, &shuffle_msg)
        .expect("local verify_shuffle failed — bug in payload generation");
    eprintln!("# Local verification passed");

    // Serialize the framed blob
    let mut blob: Vec<u8> = Vec::new();

    // Selector
    blob.push(0x02u8);

    // num_players
    blob.extend_from_slice(&(num_players as u32).to_be_bytes());

    // Each player: hello_len | hello_bytes | name_len | name_bytes
    for (hello, name) in hellos.iter().zip(names.iter()) {
        let mut hello_bytes: Vec<u8> = Vec::new();
        hello
            .serialize_compressed(&mut hello_bytes)
            .expect("hello serialization");
        blob.extend_from_slice(&(hello_bytes.len() as u32).to_be_bytes());
        blob.extend_from_slice(&hello_bytes);
        blob.extend_from_slice(&(name.len() as u32).to_be_bytes());
        blob.extend_from_slice(name);
    }

    // deck_len | deck_bytes
    let mut deck_bytes: Vec<u8> = Vec::new();
    initial_deck
        .serialize_compressed(&mut deck_bytes)
        .expect("deck serialization");
    blob.extend_from_slice(&(deck_bytes.len() as u32).to_be_bytes());
    blob.extend_from_slice(&deck_bytes);

    // shuffle_msg_bytes (rest of blob — no length prefix needed)
    let mut shuffle_bytes: Vec<u8> = Vec::new();
    shuffle_msg
        .serialize_compressed(&mut shuffle_bytes)
        .expect("shuffle_msg serialization");
    blob.extend_from_slice(&shuffle_bytes);

    eprintln!("# Blob breakdown:");
    eprintln!("#   selector:      1 byte");
    eprintln!("#   players:       {} players", num_players);
    eprintln!("#   deck:          {} bytes", deck_bytes.len());
    eprintln!("#   shuffle_msg:   {} bytes", shuffle_bytes.len());
    eprintln!("#   total blob:    {} bytes", blob.len());
    eprintln!("#");
    eprintln!("# Sanity: re-deserialize shuffle_msg from blob ...");

    // Re-deserialize sanity check
    let re_msg = cards_protocol::shuffle::ShuffleMessage::<ark_secp256k1::Projective>::deserialize_compressed(
        shuffle_bytes.as_slice(),
    )
    .expect("re-deserialization of shuffle_msg failed");
    assert_eq!(re_msg.deck().len(), deck_size, "round-trip deck size mismatch");
    eprintln!("#   round-trip OK ({} cards in shuffled deck)", re_msg.deck().len());

    println!("{}", encode_hex(&blob));
}
