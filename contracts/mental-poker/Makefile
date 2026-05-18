TARGETS = all clean stats disasm linker
.PHONY: $(TARGETS)
.SILENT: $(TARGETS)

CONTRACT_ELF := target/riscv64emac-unknown-none-polkavm/release/contract
CONTRACT_PVM := contract.polkavm
HOST_TRIPLE := $(shell rustc -vV | awk '/^host:/ { print $$2 }')
LINKER_BIN := linker/target/$(HOST_TRIPLE)/release/revive-linker

all: linker
	RUSTC_BOOTSTRAP=1 \
	CARGO_ENCODED_RUSTFLAGS=$$'-Dwarnings\x1f-Zunstable-options\x1f-Cpanic=immediate-abort' \
	cargo build --release
	$(LINKER_BIN) $(CONTRACT_ELF) $(CONTRACT_PVM)
	ls -l $(CONTRACT_PVM)

linker:
	cargo build --release --manifest-path linker/Cargo.toml --target $(HOST_TRIPLE)

stats:
	polkatool stats $(CONTRACT_PVM)

disasm:
	polkatool disassemble $(CONTRACT_PVM)

clean:
	cargo clean
	cargo clean --manifest-path linker/Cargo.toml
	rm -f $(CONTRACT_PVM)
