TARGETS = all clean stats disasm linker gen-hello gen-shuffle
.PHONY: $(TARGETS)
.SILENT: $(TARGETS)

CONTRACT_ELF := target/riscv64emac-unknown-none-polkavm/release/contract
CONTRACT_PVM := contract.polkavm
HOST_TRIPLE := $(shell rustc -vV | awk '/^host:/ { print $$2 }')
LINKER_BIN := linker/target/$(HOST_TRIPLE)/release/revive-linker
GEN_HELLO_BIN := gen-hello/target/$(HOST_TRIPLE)/release/gen-hello
GEN_SHUFFLE_BIN := gen-shuffle/target/$(HOST_TRIPLE)/release/gen-shuffle

all: linker
	# RUSTC_BOOTSTRAP=1 so stable rustc accepts the unstable build-std feature.
	# -Cpanic=immediate-abort minimizes binary size (replaces the old
	#  build-std-features = ["panic_immediate_abort"] that recent rustc rejected).
	RUSTC_BOOTSTRAP=1 \
	CARGO_ENCODED_RUSTFLAGS=$$'-Dwarnings\x1f-Zunstable-options\x1f-Cpanic=immediate-abort' \
	cargo build --release
	# Link with polkavm-linker using TargetInstructionSet::ReviveV1 — polkatool's
	# `link` subcommand hardcodes `Latest`, which pallet-revive rejects.
	$(LINKER_BIN) $(CONTRACT_ELF) $(CONTRACT_PVM)
	ls -l $(CONTRACT_PVM)

linker:
	# --target overrides the polkavm target inherited from verify-spike/.cargo/config.toml.
	cargo build --release --manifest-path linker/Cargo.toml --target $(HOST_TRIPLE)

gen-hello:
	cargo build --release --manifest-path gen-hello/Cargo.toml --target $(HOST_TRIPLE)
	@echo "Built: $(GEN_HELLO_BIN)"

gen-shuffle:
	cargo build --release --manifest-path gen-shuffle/Cargo.toml --target $(HOST_TRIPLE)
	@echo "Built: $(GEN_SHUFFLE_BIN)"

stats:
	polkatool stats $(CONTRACT_PVM)

disasm:
	polkatool disassemble $(CONTRACT_PVM)

clean:
	cargo clean
	cargo clean --manifest-path linker/Cargo.toml
	cargo clean --manifest-path gen-hello/Cargo.toml
	cargo clean --manifest-path gen-shuffle/Cargo.toml
	rm -f $(CONTRACT_PVM)
