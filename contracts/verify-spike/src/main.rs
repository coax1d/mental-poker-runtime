//! Hello-world PolkaVM contract for the verify-spike, now with S3 linkage.
//!
//! Exports:
//!   - `deploy`: run once at instantiation, no-op for now.
//!   - `call`: returns `(0xCAFEBABE << 32) | serialized_compressed_size(Parameters)`
//!             packed into the low 64 bits of a 32-byte big-endian word.
//!
//! The `cards_protocol::Parameters` reference is just enough to force the
//! linker to pull in arkworks and the Barnett-Smart crates, so `cargo build`
//! exercises the same dependency graph S4 will need and `polkatool stats`
//! reports the real binary size.

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

#[no_mangle]
#[polkavm_derive::polkavm_export]
pub extern "C" fn call() {
    use alloc::vec::Vec;
    use ark_serialize::CanonicalDeserialize;

    // Read input length from the runtime so we force real work — without this
    // the compiler constant-folds the whole call and prunes arkworks.
    let input_len = api::call_data_size() as usize;

    // Actually serialize PARAMS — this writes to memory at runtime, so LLVM
    // can't pre-compute it.
    let mut buf: Vec<u8> = Vec::new();
    deck_secp256k1::PARAMS
        .serialize_compressed(&mut buf)
        .ok();

    // If the caller sent any input, try to deserialize it as a curve point
    // (mirrors the hot path in verify_player). This pulls arkworks curve
    // deserialization into the linked image.
    let deser_ok: u32 = if input_len > 0 {
        let mut input = [0u8; 33]; // secp256k1 compressed point is 33 bytes
        let take = core::cmp::min(input_len, input.len()) as u32;
        api::call_data_copy(&mut input[..take as usize], 0);
        match ark_secp256k1::Affine::deserialize_compressed(&input[..take as usize]) {
            Ok(_) => 1,
            Err(_) => 0,
        }
    } else {
        0
    };

    // Pack 0xCAFEBABE | serialized_len | deser_ok into an output blob.
    let serialized_len = buf.len() as u32;
    let sentinel = 0xCAFE_BABE_u32;

    let mut output = [0u8; 32];
    output[16..20].copy_from_slice(&sentinel.to_be_bytes());
    output[20..24].copy_from_slice(&serialized_len.to_be_bytes());
    output[24..28].copy_from_slice(&deser_ok.to_be_bytes());
    output[28..32].copy_from_slice(&(input_len as u32).to_be_bytes());
    api::return_value(ReturnFlags::empty(), &output);
}
