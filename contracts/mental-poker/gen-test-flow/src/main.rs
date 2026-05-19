//! Generate test payloads for the mental-poker contract.
//!
//! Simulates the full off-chain flow:
//!   1. Generate player keypairs
//!   2. Generate PlayerHellos (bound to each player's H160)
//!   3. Do the off-chain shuffle (player 1 shuffles, player 2 shuffles)
//!   4. Each player signs the final deck (ZKProofKeyOwnership over deck bytes)
//!   5. Generate reveal messages for a test card
//!
//! Outputs JSON with hex-encoded payloads for each contract message.
//!
//! Usage:
//!   gen-test-flow --player1 <h160-hex> --player2 <h160-hex> [--deck-size N] [--seed U64]
//!
//! If no player addresses given, uses deterministic dummy addresses.

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

fn decode_hex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("invalid hex"))
        .collect()
}

fn main() {
    let mut player1_h160: Option<Vec<u8>> = None;
    let mut player2_h160: Option<Vec<u8>> = None;
    let mut deck_size: usize = 52;
    let mut seed: u64 = 0xC0FFEE_DEAD_BEEF;
    let mut timeout_blocks: u32 = 100;

    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--player1" => { i += 1; player1_h160 = Some(decode_hex(&args[i])); }
            "--player2" => { i += 1; player2_h160 = Some(decode_hex(&args[i])); }
            "--deck-size" => { i += 1; deck_size = args[i].parse().unwrap(); }
            "--seed" => { i += 1; seed = args[i].parse().unwrap(); }
            "--timeout" => { i += 1; timeout_blocks = args[i].parse().unwrap(); }
            other => { eprintln!("unknown arg: {}", other); std::process::exit(2); }
        }
        i += 1;
    }

    // Default dummy H160 addresses for testing
    let p1_addr = player1_h160.unwrap_or_else(|| vec![0x11u8; 20]);
    let p2_addr = player2_h160.unwrap_or_else(|| vec![0x22u8; 20]);

    assert_eq!(p1_addr.len(), 20, "player1 H160 must be 20 bytes");
    assert_eq!(p2_addr.len(), 20, "player2 H160 must be 20 bytes");

    let mut rng = ark_std::rand::rngs::StdRng::seed_from_u64(seed);
    let params = deck_secp256k1::PARAMS;

    eprintln!("# Generating test flow: {} cards, seed={:#x}", deck_size, seed);
    eprintln!("# Player 1: {}", encode_hex(&p1_addr));
    eprintln!("# Player 2: {}", encode_hex(&p2_addr));

    // --- Generate players (hello bound to H160 address) ---
    let (hello1, keypair1) = params.generate_player(&mut rng, p1_addr.as_slice());
    let (hello2, keypair2) = params.generate_player(&mut rng, p2_addr.as_slice());

    // --- Build AggregatedPublicKeys ---
    let mut apk = params.create_aggregate_keys();
    apk.verify_n_add(hello1.clone(), p1_addr.as_slice()).expect("p1 verify_n_add");
    apk.verify_n_add(hello2.clone(), p2_addr.as_slice()).expect("p2 verify_n_add");

    // --- Create initial zero-masked deck ---
    let deck_affines = &deck_secp256k1::DECK_SECP256K1.0;
    assert!(deck_size <= deck_affines.len());
    let initial_deck = cards_protocol::masking::zero_mask_affines::<ark_secp256k1::Projective>(
        deck_affines[..deck_size].iter(),
    );

    // --- Off-chain shuffle: player 1 then player 2 ---
    eprintln!("# Player 1 shuffling...");
    let shuffle1 = apk.shuffle_and_remask(&mut rng, &keypair1, &initial_deck).unwrap();
    apk.verify_shuffle(&initial_deck, &shuffle1).expect("p1 shuffle verify");
    let deck_after_p1: Vec<_> = shuffle1.deck().to_vec();

    eprintln!("# Player 2 shuffling...");
    let shuffle2 = apk.shuffle_and_remask(&mut rng, &keypair2, &deck_after_p1).unwrap();
    apk.verify_shuffle(&deck_after_p1, &shuffle2).expect("p2 shuffle verify");
    let final_deck: Vec<_> = shuffle2.deck().to_vec();
    eprintln!("# Final deck: {} cards", final_deck.len());

    // --- Serialize the final deck ---
    let mut deck_bytes: Vec<u8> = Vec::new();
    final_deck.serialize_compressed(&mut deck_bytes).unwrap();

    // --- Each player signs the deck (ZKProofKeyOwnership over deck_bytes) ---
    eprintln!("# Signing deck agreement...");
    let sig1 = params.prove_key_ownership(&mut rng, &keypair1, deck_bytes.as_slice());
    let sig2 = params.prove_key_ownership(&mut rng, &keypair2, deck_bytes.as_slice());

    // Verify locally
    use core::ops::Deref;
    params.verify_key_ownership(hello1.deref(), deck_bytes.as_slice(), &sig1).expect("sig1 verify");
    params.verify_key_ownership(hello2.deref(), deck_bytes.as_slice(), &sig2).expect("sig2 verify");
    eprintln!("# Deck agreement signatures verified locally");

    // --- Generate reveal messages for card 0 ---
    eprintln!("# Generating reveal for card 0...");
    let reveal1 = params.prove_single_reveal_token(&mut rng, &keypair1, &final_deck[0]);
    let reveal2 = params.prove_single_reveal_token(&mut rng, &keypair2, &final_deck[0]);
    params.verify_single_reveal(&reveal1).expect("reveal1 verify");
    params.verify_single_reveal(&reveal2).expect("reveal2 verify");
    eprintln!("# Reveals verified locally");

    // === Build contract payloads ===

    // 1. create_game: selector 0x01 + deck_size:u16 BE + num_players:u8 + timeout:u32 BE
    let mut create_game = vec![0x01u8];
    create_game.extend_from_slice(&(deck_size as u16).to_be_bytes());
    create_game.push(2u8); // num_players
    create_game.extend_from_slice(&timeout_blocks.to_be_bytes());

    // 2. register_player: selector 0x02 + PlayerHello compressed
    let mut hello1_bytes = Vec::new();
    hello1.serialize_compressed(&mut hello1_bytes).unwrap();
    let mut reg_p1 = vec![0x02u8];
    reg_p1.extend_from_slice(&hello1_bytes);

    let mut hello2_bytes = Vec::new();
    hello2.serialize_compressed(&mut hello2_bytes).unwrap();
    let mut reg_p2 = vec![0x02u8];
    reg_p2.extend_from_slice(&hello2_bytes);

    // 3. submit_agreed_deck: selector 0x03 + deck_len:u32 BE + deck + (sig_len + sig) per player
    let mut agreed_deck = vec![0x03u8];
    agreed_deck.extend_from_slice(&(deck_bytes.len() as u32).to_be_bytes());
    agreed_deck.extend_from_slice(&deck_bytes);

    let mut sig1_bytes = Vec::new();
    sig1.serialize_compressed(&mut sig1_bytes).unwrap();
    agreed_deck.extend_from_slice(&(sig1_bytes.len() as u32).to_be_bytes());
    agreed_deck.extend_from_slice(&sig1_bytes);

    let mut sig2_bytes = Vec::new();
    sig2.serialize_compressed(&mut sig2_bytes).unwrap();
    agreed_deck.extend_from_slice(&(sig2_bytes.len() as u32).to_be_bytes());
    agreed_deck.extend_from_slice(&sig2_bytes);

    // 4. submit_reveal: selector 0x04 + card_index:u16 BE + RevealMessage compressed
    let mut reveal1_bytes = Vec::new();
    reveal1.serialize_compressed(&mut reveal1_bytes).unwrap();
    let mut rev_p1 = vec![0x04u8];
    rev_p1.extend_from_slice(&0u16.to_be_bytes()); // card 0
    rev_p1.extend_from_slice(&reveal1_bytes);

    let mut reveal2_bytes = Vec::new();
    reveal2.serialize_compressed(&mut reveal2_bytes).unwrap();
    let mut rev_p2 = vec![0x04u8];
    rev_p2.extend_from_slice(&0u16.to_be_bytes()); // card 0
    rev_p2.extend_from_slice(&reveal2_bytes);

    // 5. query_game: selector 0x10
    let query = vec![0x10u8];

    // 6. claim_timeout: selector 0x05
    let claim_timeout = vec![0x05u8];

    // === Output JSON ===
    eprintln!("# Payload sizes:");
    eprintln!("#   create_game:      {} bytes", create_game.len());
    eprintln!("#   register_player1: {} bytes", reg_p1.len());
    eprintln!("#   register_player2: {} bytes", reg_p2.len());
    eprintln!("#   agreed_deck:      {} bytes", agreed_deck.len());
    eprintln!("#   reveal_p1:        {} bytes", rev_p1.len());
    eprintln!("#   reveal_p2:        {} bytes", rev_p2.len());

    println!("{{");
    println!("  \"create_game\": \"{}\",", encode_hex(&create_game));
    println!("  \"register_player1\": \"{}\",", encode_hex(&reg_p1));
    println!("  \"register_player2\": \"{}\",", encode_hex(&reg_p2));
    println!("  \"submit_agreed_deck\": \"{}\",", encode_hex(&agreed_deck));
    println!("  \"reveal_card0_player1\": \"{}\",", encode_hex(&rev_p1));
    println!("  \"reveal_card0_player2\": \"{}\",", encode_hex(&rev_p2));
    println!("  \"query_game\": \"{}\",", encode_hex(&query));
    println!("  \"claim_timeout\": \"{}\"", encode_hex(&claim_timeout));
    println!("}}");
}
