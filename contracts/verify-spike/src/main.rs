//! Hello-world PolkaVM contract for the verify-spike.
//!
//! The contract has two exports:
//!   - `deploy`: run once at instantiation, no-op for now.
//!   - `call`: returns the constant `0xCAFEBABE` as a 32-byte big-endian value
//!             (Solidity ABI-compatible `uint32`).
//!
//! This is S1 of the Path C spike: prove the toolchain (rust + build-std +
//! polkatool) can produce a .polkavm artifact at all. No crypto, no storage.

#![no_main]
#![no_std]

use uapi::{HostFn, HostFnImpl as api, ReturnFlags};

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
    // Return 0xCAFEBABE as a 32-byte big-endian word (Solidity uint32 layout).
    let mut output = [0u8; 32];
    output[28..].copy_from_slice(&0xCAFE_BABE_u32.to_be_bytes());
    api::return_value(ReturnFlags::empty(), &output);
}
