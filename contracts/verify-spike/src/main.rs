//! verify-spike: S4 runs `verify_player` on-chain.
//!
//! Exports:
//!   - `deploy`: no-op.
//!   - `call`: runs `Parameters::verify_player` against a caller-supplied
//!     `PlayerHello` + player name. Returns a 32-byte status blob.
//!
//! Input layout (big-endian where numeric):
//!   [0..4]         hello_len: u32
//!   [4..4+N]       hello_bytes: arkworks-compressed `PlayerHello<secp256k1::Projective>`
//!   [4+N..]        player_name: raw bytes (whatever the pallet would pass
//!                  as `player_public_info`; typically the encoded account id)
//!
//! Output layout:
//!   [0..28]        zero padding (Solidity 32-byte word alignment)
//!   [28]           status: 0 = OK, 1 = short input, 2 = bad hello bytes,
//!                          3 = verify_player failed
//!   [29]           reserved (0)
//!   [30..32]       params_size_mod_u16 (for quick smoke-test visibility)
//!
//! We stick to a single-byte status because pallet-revive's `call` extrinsic
//! doesn't surface return data in events — the signal we'll actually see is
//! ExtrinsicSuccess vs. ContractTrapped. Returning nonzero status lets a
//! future state_call consumer see the finer-grained reason.

#![no_main]
#![no_std]

extern crate alloc;

use ark_serialize::CanonicalSerialize;
use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use uapi::{HostFn, HostFnImpl as api, ReturnFlags};

/// Bump allocator backed by a fixed-size static buffer. Contracts run once
/// and then exit, so freeing isn't meaningful — dealloc is a no-op.
/// The SDK fixtures avoid heap entirely, but arkworks needs Vec/Box, so we
/// provide the minimum viable allocator. Size it generously for S4/S7 without
/// blowing the polkavm static memory limit (which, per pallet-revive's
/// `StaticMemoryTooLarge` error, is enforced at deploy time).
const HEAP_SIZE: usize = 256 * 1024; // 256 KB
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
    unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {
        // Bump allocator — freeing is a no-op. The contract terminates
        // after a single call, which is when the "heap" effectively resets.
    }
}
#[global_allocator]
static ALLOCATOR: BumpAllocator = BumpAllocator { next: UnsafeCell::new(0) };

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    // `unimp` is guaranteed to trap on RISC-V.
    unsafe {
        core::arch::asm!("unimp");
        core::hint::unreachable_unchecked();
    }
}

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn deploy() {}

const STATUS_OK: u8 = 0;
const STATUS_SHORT_INPUT: u8 = 1;
const STATUS_BAD_HELLO: u8 = 2;
const STATUS_VERIFY_FAILED: u8 = 3;

fn write_output(status: u8, params_size: usize) -> ! {
    let mut output = [0u8; 32];
    output[28] = status;
    let tag = (params_size as u16).to_be_bytes();
    output[30] = tag[0];
    output[31] = tag[1];
    // STATUS_OK returns normally → the extrinsic shows ExtrinsicSuccess on
    // chain. Anything else reverts, so a failed verification surfaces as
    // ExtrinsicFailed(ContractReverted) without needing state_call to
    // inspect the status byte.
    let flags = if status == STATUS_OK {
        ReturnFlags::empty()
    } else {
        ReturnFlags::REVERT
    };
    api::return_value(flags, &output);
}

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn call() {
    use alloc::vec::Vec;
    use ark_serialize::CanonicalDeserialize;
    use cards_protocol::keys::PlayerHello;

    let input_len = api::call_data_size() as usize;

    // Read the whole call data into a heap buffer. Keeping it on the heap
    // (not a fixed-size stack array) avoids blowing polkavm's static stack
    // budget for realistic `PlayerHello` payloads (~200 bytes).
    let mut input: Vec<u8> = alloc::vec![0u8; input_len];
    if input_len > 0 {
        api::call_data_copy(&mut input, 0);
    }

    // Pre-compute the params size for the output tag — also the hook that
    // keeps arkworks in the linked image even when the caller sends no data.
    let params = deck_secp256k1::PARAMS;
    let params_size = params.serialized_size(ark_serialize::Compress::Yes);

    // Parse the input envelope: u32 hello_len | hello | name.
    if input_len < 4 {
        write_output(STATUS_SHORT_INPUT, params_size);
    }
    let hello_len = u32::from_be_bytes([input[0], input[1], input[2], input[3]]) as usize;
    if input_len < 4 + hello_len {
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

    // The real verification: ownership proof over the player's public key,
    // bound to `name_bytes` through the Fiat-Shamir transcript.
    match params.verify_player(&hello, name_bytes) {
        Ok(_) => write_output(STATUS_OK, params_size),
        Err(_) => write_output(STATUS_VERIFY_FAILED, params_size),
    }
}
