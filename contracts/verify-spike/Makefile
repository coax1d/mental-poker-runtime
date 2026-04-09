TARGETS = all clean stats disasm
.PHONY: $(TARGETS)
.SILENT: $(TARGETS)

CONTRACT_ELF := target/riscv64emac-unknown-none-polkavm/release/contract
CONTRACT_PVM := contract.polkavm

all:
	# RUSTC_BOOTSTRAP=1 so stable rustc accepts the unstable build-std feature.
	# -Cpanic=immediate-abort minimizes binary size (replaces the old
	#  build-std-features = ["panic_immediate_abort"] that recent rustc rejected).
	RUSTC_BOOTSTRAP=1 \
	CARGO_ENCODED_RUSTFLAGS=$$'-Dwarnings\x1f-Zunstable-options\x1f-Cpanic=immediate-abort' \
	cargo build --release
	polkatool link --strip --output $(CONTRACT_PVM) $(CONTRACT_ELF)
	ls -l $(CONTRACT_PVM)

stats:
	polkatool stats $(CONTRACT_PVM)

disasm:
	polkatool disassemble $(CONTRACT_PVM)

clean:
	cargo clean
	rm -f $(CONTRACT_PVM)
