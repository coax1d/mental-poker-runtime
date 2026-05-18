//! Mental Poker contract for pallet-revive (Passet Hub / Polkadot Asset Hub).
//!
//! Architecture: shuffles happen off-chain between players. The chain verifies
//! player key ownership (registration), deck agreement signatures, and card
//! reveal proofs. No on-chain shuffle verification.
//!
//! ## State machine
//!   Registration → AwaitingDeck → Playing → Complete
//!                      |
//!                  timeout → Cancelled (forfeit non-submitters)
//!
//! ## Message selectors
//!   0x01  create_game(deck_size: u32, num_players: u8, timeout_blocks: u32)
//!   0x02  register_player(player_hello_bytes)
//!   0x03  submit_agreed_deck(deck_bytes, [sig per player])
//!   0x04  submit_reveal(card_index: u32, reveal_msg_bytes)
//!   0x05  claim_timeout()
//!   0x10  query_game() → returns GameInfo
//!
//! ## Storage layout (variable-length keys via set_storage/get_storage)
//!   b"game"                → GameInfo (phase, deck_size, num_players, registered, deadline)
//!   b"plyr" ++ [idx u8]    → 20-byte H160 caller address
//!   b"pk" ++ [idx u8]      → PlayerPublicKey (compressed secp256k1 point, 33 bytes)
//!   b"deck"                → Vec<MaskedCard> (arkworks compressed)
//!   b"rv" ++ [card:u16] ++ [player:u8] → RevealMessage (compressed)
//!   b"rc" ++ [card:u16]    → u32 reveal count

#![no_main]
#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use uapi::{HostFn, HostFnImpl as api, ReturnFlags, StorageFlags};

// ---------------------------------------------------------------------------
// Allocator (bump, 1 MB — max that pallet-revive accepts on Passet Hub)
// ---------------------------------------------------------------------------
const HEAP_SIZE: usize = 1024 * 1024;
#[repr(align(16))]
struct Heap(UnsafeCell<[u8; HEAP_SIZE]>);
unsafe impl Sync for Heap {}
static HEAP: Heap = Heap(UnsafeCell::new([0; HEAP_SIZE]));

struct BumpAllocator { next: UnsafeCell<usize> }
unsafe impl Sync for BumpAllocator {}
unsafe impl GlobalAlloc for BumpAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let next = &mut *self.next.get();
        let base = HEAP.0.get() as usize;
        let start = (base + *next + layout.align() - 1) & !(layout.align() - 1);
        let end = start + layout.size();
        if end > base + HEAP_SIZE { return core::ptr::null_mut(); }
        *next = end - base;
        start as *mut u8
    }
    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
}
#[global_allocator]
static ALLOCATOR: BumpAllocator = BumpAllocator { next: UnsafeCell::new(0) };

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unsafe { core::arch::asm!("unimp"); core::hint::unreachable_unchecked(); }
}

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------
const PHASE_NONE: u8 = 0;
const PHASE_REGISTRATION: u8 = 1;
const PHASE_AWAITING_DECK: u8 = 2;
const PHASE_PLAYING: u8 = 3;
const PHASE_COMPLETE: u8 = 4;
const PHASE_CANCELLED: u8 = 5;

// Message selectors
const SEL_CREATE_GAME: u8 = 0x01;
const SEL_REGISTER_PLAYER: u8 = 0x02;
const SEL_SUBMIT_AGREED_DECK: u8 = 0x03;
const SEL_SUBMIT_REVEAL: u8 = 0x04;
const SEL_CLAIM_TIMEOUT: u8 = 0x05;
const SEL_QUERY_GAME: u8 = 0x10;

// Status codes for revert output
const STATUS_OK: u8 = 0;
const STATUS_BAD_INPUT: u8 = 1;
const STATUS_WRONG_PHASE: u8 = 2;
const STATUS_NOT_REGISTERED: u8 = 3;
const STATUS_ALREADY_REGISTERED: u8 = 4;
const STATUS_GAME_FULL: u8 = 5;
const STATUS_BAD_DESER: u8 = 6;
const STATUS_VERIFY_FAILED: u8 = 7;
const STATUS_ALREADY_REVEALED: u8 = 8;
const STATUS_CARD_OOB: u8 = 9;
const STATUS_TIMEOUT_NOT_REACHED: u8 = 10;
const STATUS_GAME_EXISTS: u8 = 11;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
const STORAGE: StorageFlags = StorageFlags::empty();

/// GameInfo packed as 12 bytes:
///   [0] phase, [1] deck_size_hi, [2] deck_size_lo (u16 BE),
///   [3] num_players, [4] registered_count,
///   [5..9] deadline_block (u32 BE), [9..12] reserved
#[derive(Clone, Copy)]
struct GameInfo {
    phase: u8,
    deck_size: u16,
    num_players: u8,
    registered_count: u8,
    deadline_block: u32,
}

impl GameInfo {
    fn to_bytes(&self) -> [u8; 12] {
        let mut b = [0u8; 12];
        b[0] = self.phase;
        b[1..3].copy_from_slice(&self.deck_size.to_be_bytes());
        b[3] = self.num_players;
        b[4] = self.registered_count;
        b[5..9].copy_from_slice(&self.deadline_block.to_be_bytes());
        b
    }
    fn from_bytes(b: &[u8; 12]) -> Self {
        GameInfo {
            phase: b[0],
            deck_size: u16::from_be_bytes([b[1], b[2]]),
            num_players: b[3],
            registered_count: b[4],
            deadline_block: u32::from_be_bytes([b[5], b[6], b[7], b[8]]),
        }
    }
}

fn store_game(info: &GameInfo) {
    let b = info.to_bytes();
    api::set_storage(STORAGE, b"game", &b);
}

fn load_game() -> Option<GameInfo> {
    let mut buf = [0u8; 12];
    let mut out: &mut [u8] = &mut buf;
    match api::get_storage(STORAGE, b"game", &mut out) {
        Ok(()) => Some(GameInfo::from_bytes(&buf)),
        Err(_) => None,
    }
}

fn store_player_addr(idx: u8, addr: &[u8; 20]) {
    let key = [b'p', b'l', b'y', b'r', idx];
    api::set_storage(STORAGE, &key, addr);
}

fn load_player_addr(idx: u8) -> Option<[u8; 20]> {
    let key = [b'p', b'l', b'y', b'r', idx];
    let mut buf = [0u8; 20];
    let mut out: &mut [u8] = &mut buf;
    match api::get_storage(STORAGE, &key, &mut out) {
        Ok(()) => Some(buf),
        Err(_) => None,
    }
}

fn store_player_pk(idx: u8, pk_bytes: &[u8]) {
    let key = [b'p', b'k', idx];
    api::set_storage(STORAGE, &key, pk_bytes);
}

fn load_player_pk_bytes(idx: u8) -> Option<Vec<u8>> {
    let key = [b'p', b'k', idx];
    let buf_len = 128usize; // compressed secp256k1 point is 33 bytes, generous
    let mut buf = alloc::vec![0u8; buf_len];
    let mut out: &mut [u8] = &mut buf;
    match api::get_storage(STORAGE, &key, &mut out) {
        Ok(()) => {
            let remaining = out.len();
            let len = buf_len - remaining;
            buf.truncate(len);
            Some(buf)
        }
        Err(_) => None,
    }
}

fn store_deck(deck_bytes: &[u8]) {
    api::set_storage(STORAGE, b"deck", deck_bytes);
}

#[allow(dead_code)]
fn load_deck_bytes() -> Option<Vec<u8>> {
    let buf_len = 65536usize; // MAX_DECK_SIZE
    let mut buf = alloc::vec![0u8; buf_len];
    let mut out: &mut [u8] = &mut buf;
    match api::get_storage(STORAGE, b"deck", &mut out) {
        Ok(()) => {
            let remaining = out.len();
            let len = buf_len - remaining;
            buf.truncate(len);
            Some(buf)
        }
        Err(_) => None,
    }
}

fn reveal_key(card: u16, player_idx: u8) -> [u8; 5] {
    let cb = card.to_be_bytes();
    [b'r', b'v', cb[0], cb[1], player_idx]
}

fn store_reveal(card: u16, player_idx: u8, reveal_bytes: &[u8]) {
    let key = reveal_key(card, player_idx);
    api::set_storage(STORAGE, &key, reveal_bytes);
}

fn has_reveal(card: u16, player_idx: u8) -> bool {
    let key = reveal_key(card, player_idx);
    let mut buf = [0u8; 1];
    let mut out: &mut [u8] = &mut buf;
    api::get_storage(STORAGE, &key, &mut out).is_ok()
}

fn reveal_count_key(card: u16) -> [u8; 4] {
    let cb = card.to_be_bytes();
    [b'r', b'c', cb[0], cb[1]]
}

fn load_reveal_count(card: u16) -> u32 {
    let key = reveal_count_key(card);
    let mut buf = [0u8; 4];
    let mut out: &mut [u8] = &mut buf;
    match api::get_storage(STORAGE, &key, &mut out) {
        Ok(()) => u32::from_be_bytes(buf),
        Err(_) => 0,
    }
}

fn store_reveal_count(card: u16, count: u32) {
    let key = reveal_count_key(card);
    api::set_storage(STORAGE, &key, &count.to_be_bytes());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
fn caller_h160() -> [u8; 20] {
    let mut addr = [0u8; 20];
    api::caller(&mut addr);
    addr
}

fn current_block() -> u32 {
    let mut buf = [0u8; 32];
    api::block_number(&mut buf);
    // Block number is a U256 LE. For practical purposes take low 4 bytes.
    u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]])
}

fn find_player_index(caller: &[u8; 20], num: u8) -> Option<u8> {
    for i in 0..num {
        if let Some(addr) = load_player_addr(i) {
            if &addr == caller { return Some(i); }
        }
    }
    None
}

fn return_ok() -> ! {
    let output = [0u8; 32];
    api::return_value(ReturnFlags::empty(), &output);
}

fn return_status(status: u8) -> ! {
    let mut output = [0u8; 32];
    output[31] = status;
    let flags = if status == STATUS_OK {
        ReturnFlags::empty()
    } else {
        ReturnFlags::REVERT
    };
    api::return_value(flags, &output);
}

fn read_u32_be(input: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([input[offset], input[offset+1], input[offset+2], input[offset+3]])
}

fn read_u16_be(input: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([input[offset], input[offset+1]])
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------
#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn deploy() {}

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn call() {
    let input_len = api::call_data_size() as usize;
    if input_len < 1 {
        return_status(STATUS_BAD_INPUT);
    }
    let mut input = alloc::vec![0u8; input_len];
    api::call_data_copy(&mut input, 0);

    match input[0] {
        SEL_CREATE_GAME => msg_create_game(&input[1..]),
        SEL_REGISTER_PLAYER => msg_register_player(&input[1..]),
        SEL_SUBMIT_AGREED_DECK => msg_submit_agreed_deck(&input[1..]),
        SEL_SUBMIT_REVEAL => msg_submit_reveal(&input[1..]),
        SEL_CLAIM_TIMEOUT => msg_claim_timeout(),
        SEL_QUERY_GAME => msg_query_game(),
        _ => return_status(STATUS_BAD_INPUT),
    }
}

// ---------------------------------------------------------------------------
// 0x01: create_game(deck_size: u16 BE, num_players: u8, timeout_blocks: u32 BE)
// ---------------------------------------------------------------------------
fn msg_create_game(input: &[u8]) -> ! {
    // Don't allow creating a game if one already exists
    if let Some(g) = load_game() {
        if g.phase != PHASE_NONE && g.phase != PHASE_COMPLETE && g.phase != PHASE_CANCELLED {
            return_status(STATUS_GAME_EXISTS);
        }
    }

    if input.len() < 7 {
        return_status(STATUS_BAD_INPUT);
    }
    let deck_size = read_u16_be(input, 0);
    let num_players = input[2];
    let timeout_blocks = read_u32_be(input, 3);

    if num_players < 2 || num_players > 10 || deck_size < 2 || timeout_blocks == 0 {
        return_status(STATUS_BAD_INPUT);
    }

    // Store timeout_blocks in deadline_block — it gets converted to an
    // absolute block number when registration completes.
    let info = GameInfo {
        phase: PHASE_REGISTRATION,
        deck_size,
        num_players,
        registered_count: 0,
        deadline_block: timeout_blocks,
    };
    store_game(&info);
    return_ok();
}

// ---------------------------------------------------------------------------
// 0x02: register_player(player_hello_bytes)
// ---------------------------------------------------------------------------
fn msg_register_player(input: &[u8]) -> ! {
    let mut game = match load_game() {
        Some(g) => g,
        None => return_status(STATUS_WRONG_PHASE),
    };
    if game.phase != PHASE_REGISTRATION {
        return_status(STATUS_WRONG_PHASE);
    }
    if game.registered_count >= game.num_players {
        return_status(STATUS_GAME_FULL);
    }

    let caller = caller_h160();

    // Check not already registered
    if find_player_index(&caller, game.registered_count).is_some() {
        return_status(STATUS_ALREADY_REGISTERED);
    }

    // Deserialize and verify the player hello
    let hello = match cards_protocol::keys::PlayerHello::<ark_secp256k1::Projective>::deserialize_compressed(input) {
        Ok(h) => h,
        Err(_) => return_status(STATUS_BAD_DESER),
    };

    let params = deck_secp256k1::PARAMS;
    // Use the caller's H160 address as player_public_info (bound into transcript)
    let pk = match params.verify_player(&hello, caller.as_slice()) {
        Ok(pk) => pk,
        Err(_) => return_status(STATUS_VERIFY_FAILED),
    };

    // Store player address and public key
    let idx = game.registered_count;
    store_player_addr(idx, &caller);

    let mut pk_bytes = Vec::new();
    pk.serialize_compressed(&mut pk_bytes).unwrap_or_else(|_| {});
    store_player_pk(idx, &pk_bytes);

    game.registered_count += 1;

    // If all players registered, move to AwaitingDeck and start timeout
    if game.registered_count == game.num_players {
        game.phase = PHASE_AWAITING_DECK;
        let block = current_block();
        // deadline_block currently holds timeout_blocks from create_game.
        // Convert to absolute deadline.
        game.deadline_block = block.saturating_add(game.deadline_block);
    }

    store_game(&game);
    return_ok();
}

// ---------------------------------------------------------------------------
// 0x03: submit_agreed_deck(deck_bytes_len: u32 BE, deck_bytes, [sig per player])
//
// Input layout after selector:
//   [0..4]   deck_len: u32 BE
//   [4..4+N] deck_bytes (Vec<MaskedCard> compressed)
//   For each player (num_players times):
//     [..]   sig_len: u32 BE
//     [..]   sig_bytes (ZKProofKeyOwnership compressed)
// ---------------------------------------------------------------------------
fn msg_submit_agreed_deck(input: &[u8]) -> ! {
    let mut game = match load_game() {
        Some(g) => g,
        None => return_status(STATUS_WRONG_PHASE),
    };
    if game.phase != PHASE_AWAITING_DECK {
        return_status(STATUS_WRONG_PHASE);
    }

    let params = deck_secp256k1::PARAMS;
    let mut cursor: usize = 0;

    // Parse deck
    if input.len() < cursor + 4 {
        return_status(STATUS_BAD_INPUT);
    }
    let deck_len = read_u32_be(input, cursor) as usize;
    cursor += 4;
    if input.len() < cursor + deck_len {
        return_status(STATUS_BAD_INPUT);
    }
    let deck_bytes = &input[cursor..cursor + deck_len];
    cursor += deck_len;

    // Verify deck deserializes and has correct size
    let deck: Vec<cards_protocol::MaskedCard<ark_secp256k1::Projective>> =
        match CanonicalDeserialize::deserialize_compressed(deck_bytes) {
            Ok(d) => d,
            Err(_) => return_status(STATUS_BAD_DESER),
        };
    if deck.len() != game.deck_size as usize {
        return_status(STATUS_BAD_INPUT);
    }

    // Verify each player's signature over the deck
    // The signature is a ZKProofKeyOwnership (Schnorr proof) with deck_bytes as
    // the player_public_info bound into the Fiat-Shamir transcript.
    for i in 0..game.num_players {
        // Load player's registered public key
        let pk_bytes = match load_player_pk_bytes(i) {
            Some(b) => b,
            None => return_status(STATUS_BAD_INPUT),
        };
        let pk = match <ark_secp256k1::Projective as ark_ec::CurveGroup>::Affine::deserialize_compressed(
            pk_bytes.as_slice(),
        ) {
            Ok(p) => p,
            Err(_) => return_status(STATUS_BAD_DESER),
        };

        // Parse this player's signature
        if input.len() < cursor + 4 {
            return_status(STATUS_BAD_INPUT);
        }
        let sig_len = read_u32_be(input, cursor) as usize;
        cursor += 4;
        if input.len() < cursor + sig_len {
            return_status(STATUS_BAD_INPUT);
        }
        let sig_bytes = &input[cursor..cursor + sig_len];
        cursor += sig_len;

        let sig = match cards_protocol::keys::ZKProofKeyOwnership::<ark_secp256k1::Projective>::deserialize_compressed(sig_bytes) {
            Ok(s) => s,
            Err(_) => return_status(STATUS_BAD_DESER),
        };

        // Verify: signature is bound to deck_bytes via the transcript
        if params.verify_key_ownership(&pk, deck_bytes, &sig).is_err() {
            return_status(STATUS_VERIFY_FAILED);
        }
    }

    // All signatures valid — store deck and move to Playing
    store_deck(deck_bytes);
    game.phase = PHASE_PLAYING;
    game.deadline_block = 0; // clear timeout
    store_game(&game);
    return_ok();
}

// ---------------------------------------------------------------------------
// 0x04: submit_reveal(card_index: u16 BE, reveal_msg_bytes)
// ---------------------------------------------------------------------------
fn msg_submit_reveal(input: &[u8]) -> ! {
    let game = match load_game() {
        Some(g) => g,
        None => return_status(STATUS_WRONG_PHASE),
    };
    if game.phase != PHASE_PLAYING {
        return_status(STATUS_WRONG_PHASE);
    }

    if input.len() < 2 {
        return_status(STATUS_BAD_INPUT);
    }
    let card_index = read_u16_be(input, 0);
    let reveal_bytes = &input[2..];

    if card_index >= game.deck_size {
        return_status(STATUS_CARD_OOB);
    }

    let caller = caller_h160();
    let player_idx = match find_player_index(&caller, game.num_players) {
        Some(i) => i,
        None => return_status(STATUS_NOT_REGISTERED),
    };

    // Check not already revealed
    if has_reveal(card_index, player_idx) {
        return_status(STATUS_ALREADY_REVEALED);
    }

    // Deserialize and verify
    let reveal_msg = match cards_protocol::RevealMessage::<ark_secp256k1::Projective>::deserialize_compressed(reveal_bytes) {
        Ok(m) => m,
        Err(_) => return_status(STATUS_BAD_DESER),
    };

    let params = deck_secp256k1::PARAMS;
    if params.verify_single_reveal(&reveal_msg).is_err() {
        return_status(STATUS_VERIFY_FAILED);
    }

    // Store reveal and update count
    store_reveal(card_index, player_idx, reveal_bytes);
    let count = load_reveal_count(card_index) + 1;
    store_reveal_count(card_index, count);

    // Note: we don't auto-transition to Complete here — the client tracks
    // which cards have been fully revealed. The game stays in Playing until
    // the client decides the game is over.

    return_ok();
}

// ---------------------------------------------------------------------------
// 0x05: claim_timeout()
// ---------------------------------------------------------------------------
fn msg_claim_timeout() -> ! {
    let mut game = match load_game() {
        Some(g) => g,
        None => return_status(STATUS_WRONG_PHASE),
    };
    if game.phase != PHASE_AWAITING_DECK {
        return_status(STATUS_WRONG_PHASE);
    }
    if game.deadline_block == 0 {
        return_status(STATUS_TIMEOUT_NOT_REACHED);
    }

    let block = current_block();
    if block < game.deadline_block {
        return_status(STATUS_TIMEOUT_NOT_REACHED);
    }

    game.phase = PHASE_CANCELLED;
    store_game(&game);
    return_ok();
}

// ---------------------------------------------------------------------------
// 0x10: query_game() → returns GameInfo as 12 bytes (no revert)
// ---------------------------------------------------------------------------
fn msg_query_game() -> ! {
    match load_game() {
        Some(info) => {
            let mut output = [0u8; 32];
            let b = info.to_bytes();
            output[..12].copy_from_slice(&b);
            api::return_value(ReturnFlags::empty(), &output);
        }
        None => {
            // No game — return all zeros (phase = PHASE_NONE = 0)
            let output = [0u8; 32];
            api::return_value(ReturnFlags::empty(), &output);
        }
    }
}
