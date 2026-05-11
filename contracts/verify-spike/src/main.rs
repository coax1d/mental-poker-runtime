//! verify-spike: S7 — runs `verify_shuffle` on-chain (also retains S4 `verify_player`).
//!
//! Exports:
//!   - `deploy`: no-op.
//!   - `call`: dispatches on a selector byte:
//!       0x02 → `verify_shuffle`
//!       anything else → `verify_player` (S4 legacy path)
//!
//! ## verify_player input layout (legacy, unchanged from S4)
//!   [0..4]         hello_len: u32 BE
//!   [4..4+N]       hello_bytes
//!   [4+N..]        player_name bytes
//!
//! ## verify_shuffle input layout
//!   [0]            selector: 0x02
//!   [1..5]         num_players: u32 BE
//!   For each player:
//!     [..]         hello_len: u32 BE
//!     [..]         hello_bytes (PlayerHello compressed)
//!     [..]         name_len: u32 BE
//!     [..]         name_bytes
//!   [..]           deck_len: u32 BE
//!   [..]           deck_bytes (Vec<MaskedCard> compressed)
//!   [..]           shuffle_msg_bytes (ShuffleMessage compressed, rest of input)
//!
//! ## Output layout (same for both paths)
//!   [0..28]        zero padding
//!   [28]           status byte (0 = OK, nonzero = error, see constants below)
//!   [29]           reserved (0)
//!   [30..32]       params_size_mod_u16 (smoke-test tag)

#![no_main]
#![no_std]

extern crate alloc;

use ark_serialize::CanonicalSerialize;
use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use uapi::{HostFn, HostFnImpl as api, ReturnFlags};

// ---------------------------------------------------------------------------
// Bump allocator — same as S4 but sized up for verify_shuffle intermediates.
// ---------------------------------------------------------------------------
const HEAP_SIZE: usize = 1536 * 1024; // 1.5 MB
#[repr(align(16))]
struct Heap(UnsafeCell<[u8; HEAP_SIZE]>);
unsafe impl Sync for Heap {}
static HEAP: Heap = Heap(UnsafeCell::new([0; HEAP_SIZE]));

struct BumpAllocator {
    next: UnsafeCell<usize>,
}
unsafe impl Sync for BumpAllocator {}
unsafe impl GlobalAlloc for BumpAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let next = &mut *self.next.get();
        let base = HEAP.0.get() as usize;
        let start = (base + *next + layout.align() - 1) & !(layout.align() - 1);
        let end = start + layout.size();
        if end > base + HEAP_SIZE {
            return core::ptr::null_mut();
        }
        *next = end - base;
        start as *mut u8
    }
    unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {}
}
#[global_allocator]
static ALLOCATOR: BumpAllocator = BumpAllocator { next: UnsafeCell::new(0) };

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    unsafe {
        core::arch::asm!("unimp");
        core::hint::unreachable_unchecked();
    }
}

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn deploy() {}

// ---------------------------------------------------------------------------
// Status codes
// ---------------------------------------------------------------------------
const STATUS_OK: u8 = 0;
// verify_player
const STATUS_SHORT_INPUT: u8 = 1;
const STATUS_BAD_HELLO: u8 = 2;
const STATUS_VERIFY_FAILED: u8 = 3;
// verify_shuffle
const STATUS_SHUFFLE_SHORT_INPUT: u8 = 4;
const STATUS_SHUFFLE_BAD_HELLO: u8 = 5;
const STATUS_SHUFFLE_APK_FAILED: u8 = 6;
const STATUS_SHUFFLE_BAD_DECK: u8 = 7;
const STATUS_SHUFFLE_BAD_MSG: u8 = 8;
const STATUS_SHUFFLE_VERIFY_FAILED: u8 = 9;

const SELECTOR_VERIFY_SHUFFLE: u8 = 0x02;

fn write_output(status: u8, params_size: usize) -> ! {
    let mut output = [0u8; 32];
    output[28] = status;
    let tag = (params_size as u16).to_be_bytes();
    output[30] = tag[0];
    output[31] = tag[1];
    let flags = if status == STATUS_OK {
        ReturnFlags::empty()
    } else {
        ReturnFlags::REVERT
    };
    api::return_value(flags, &output);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn call() {
    use alloc::vec::Vec;

    let input_len = api::call_data_size() as usize;
    let mut input: Vec<u8> = alloc::vec![0u8; input_len];
    if input_len > 0 {
        api::call_data_copy(&mut input, 0);
    }

    let params = deck_secp256k1::PARAMS;
    let params_size = params.serialized_size(ark_serialize::Compress::Yes);

    if input_len >= 1 && input[0] == SELECTOR_VERIFY_SHUFFLE {
        do_verify_shuffle(&input[1..], &params, params_size);
    } else {
        do_verify_player(&input, &params, params_size);
    }
}

// ---------------------------------------------------------------------------
// verify_player (S4 path, unchanged)
// ---------------------------------------------------------------------------
fn do_verify_player(
    input: &[u8],
    params: &cards_protocol::Parameters<ark_secp256k1::Projective>,
    params_size: usize,
) -> ! {
    use ark_serialize::CanonicalDeserialize;
    use cards_protocol::keys::PlayerHello;

    if input.len() < 4 {
        write_output(STATUS_SHORT_INPUT, params_size);
    }
    let hello_len = u32::from_be_bytes([input[0], input[1], input[2], input[3]]) as usize;
    if input.len() < 4 + hello_len {
        write_output(STATUS_SHORT_INPUT, params_size);
    }
    let hello_bytes = &input[4..4 + hello_len];
    let name_bytes = &input[4 + hello_len..];

    let hello = match PlayerHello::<ark_secp256k1::Projective>::deserialize_compressed(
        hello_bytes,
    ) {
        Ok(h) => h,
        Err(_) => write_output(STATUS_BAD_HELLO, params_size),
    };

    match params.verify_player(&hello, name_bytes) {
        Ok(_) => write_output(STATUS_OK, params_size),
        Err(_) => write_output(STATUS_VERIFY_FAILED, params_size),
    }
}

// ---------------------------------------------------------------------------
// verify_shuffle (S7 — the feasibility measurement)
// ---------------------------------------------------------------------------
fn do_verify_shuffle(
    input: &[u8],
    params: &cards_protocol::Parameters<ark_secp256k1::Projective>,
    params_size: usize,
) -> ! {
    use alloc::vec::Vec;
    use ark_serialize::CanonicalDeserialize;
    use cards_protocol::keys::PlayerHello;
    use cards_protocol::shuffle::ShuffleMessage;
    use cards_protocol::MaskedCard;

    let mut cursor: usize = 0;

    // --- num_players ---
    if input.len() < cursor + 4 {
        write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
    }
    let num_players = u32::from_be_bytes([
        input[cursor], input[cursor + 1], input[cursor + 2], input[cursor + 3],
    ]) as usize;
    cursor += 4;

    // --- Build AggregatedPublicKeys from player hellos ---
    let mut apk = params.create_aggregate_keys();
    for _ in 0..num_players {
        // hello_len
        if input.len() < cursor + 4 {
            write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
        }
        let hello_len = u32::from_be_bytes([
            input[cursor], input[cursor + 1], input[cursor + 2], input[cursor + 3],
        ]) as usize;
        cursor += 4;

        if input.len() < cursor + hello_len {
            write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
        }
        let hello_bytes = &input[cursor..cursor + hello_len];
        cursor += hello_len;

        // name_len
        if input.len() < cursor + 4 {
            write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
        }
        let name_len = u32::from_be_bytes([
            input[cursor], input[cursor + 1], input[cursor + 2], input[cursor + 3],
        ]) as usize;
        cursor += 4;

        if input.len() < cursor + name_len {
            write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
        }
        let name_bytes = &input[cursor..cursor + name_len];
        cursor += name_len;

        let hello = match PlayerHello::<ark_secp256k1::Projective>::deserialize_compressed(
            hello_bytes,
        ) {
            Ok(h) => h,
            Err(_) => write_output(STATUS_SHUFFLE_BAD_HELLO, params_size),
        };

        if apk.verify_n_add(hello, name_bytes).is_err() {
            write_output(STATUS_SHUFFLE_APK_FAILED, params_size);
        }
    }

    // --- Current deck ---
    if input.len() < cursor + 4 {
        write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
    }
    let deck_len = u32::from_be_bytes([
        input[cursor], input[cursor + 1], input[cursor + 2], input[cursor + 3],
    ]) as usize;
    cursor += 4;

    if input.len() < cursor + deck_len {
        write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
    }
    let deck_bytes = &input[cursor..cursor + deck_len];
    cursor += deck_len;

    let current_deck: Vec<MaskedCard<ark_secp256k1::Projective>> =
        match CanonicalDeserialize::deserialize_compressed(deck_bytes) {
            Ok(d) => d,
            Err(_) => write_output(STATUS_SHUFFLE_BAD_DECK, params_size),
        };

    // --- ShuffleMessage (rest of input) ---
    let shuffle_bytes = &input[cursor..];
    if shuffle_bytes.is_empty() {
        write_output(STATUS_SHUFFLE_SHORT_INPUT, params_size);
    }

    let shuffle_msg: ShuffleMessage<ark_secp256k1::Projective> =
        match CanonicalDeserialize::deserialize_compressed(shuffle_bytes) {
            Ok(m) => m,
            Err(_) => write_output(STATUS_SHUFFLE_BAD_MSG, params_size),
        };

    // --- THE MEASUREMENT: verify_shuffle ---
    match apk.verify_shuffle(&current_deck, &shuffle_msg) {
        Ok(_) => write_output(STATUS_OK, params_size),
        Err(_) => write_output(STATUS_SHUFFLE_VERIFY_FAILED, params_size),
    }
}
