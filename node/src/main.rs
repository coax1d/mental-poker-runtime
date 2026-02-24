#![warn(missing_docs)]
//! Mental Poker node binary.

mod chain_spec;
mod cli;
mod command;
mod rpc;
mod service;

fn main() -> polkadot_sdk::sc_cli::Result<()> {
	command::run()
}
