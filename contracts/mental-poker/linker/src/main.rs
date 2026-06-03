//! Link a RISC-V ELF to a pallet-revive-compatible PolkaVM blob.
//!
//! Usage: `revive-linker <input.elf> <output.polkavm>`
//!
//! polkatool's `link` subcommand uses `TargetInstructionSet::Latest`, which
//! produces binaries that pallet-revive rejects with `CodeRejected`. This tool
//! replicates what polkadot-sdk's `substrate/frame/revive/fixtures/src/builder.rs`
//! does: call `polkavm_linker::program_from_elf` with `ReviveV1`.

use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let input = match args.next() {
        Some(p) => p,
        None => {
            eprintln!("usage: revive-linker <input.elf> <output.polkavm>");
            return ExitCode::from(2);
        }
    };
    let output = match args.next() {
        Some(p) => p,
        None => {
            eprintln!("usage: revive-linker <input.elf> <output.polkavm>");
            return ExitCode::from(2);
        }
    };

    let elf = match fs::read(&input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("failed to read {input}: {e}");
            return ExitCode::from(1);
        }
    };

    let mut config = polkavm_linker::Config::default();
    config.set_strip(true);
    config.set_optimize(true);

    let blob = match polkavm_linker::program_from_elf(
        config,
        polkavm_linker::TargetInstructionSet::ReviveV1,
        &elf,
    ) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("program_from_elf failed: {e}");
            return ExitCode::from(1);
        }
    };

    if let Err(e) = fs::write(&output, &blob) {
        eprintln!("failed to write {output}: {e}");
        return ExitCode::from(1);
    }

    eprintln!("wrote {} bytes to {output}", blob.len());
    ExitCode::SUCCESS
}
