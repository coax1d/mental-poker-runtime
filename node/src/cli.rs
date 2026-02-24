use polkadot_sdk::*;

#[derive(Debug, Clone)]
pub enum Consensus {
	ManualSeal(u64),
	InstantSeal,
	None,
}

impl std::str::FromStr for Consensus {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		Ok(if s == "instant-seal" {
			Consensus::InstantSeal
		} else if let Some(block_time) = s.strip_prefix("manual-seal-") {
			Consensus::ManualSeal(block_time.parse().map_err(|_| "invalid block time")?)
		} else if s.to_lowercase() == "none" {
			Consensus::None
		} else {
			return Err("incorrect consensus identifier".into());
		})
	}
}

#[derive(Debug, clap::Parser)]
pub struct Cli {
	#[command(subcommand)]
	pub subcommand: Option<Subcommand>,

	#[clap(long, default_value = "manual-seal-3000")]
	pub consensus: Consensus,

	#[clap(flatten)]
	pub run: sc_cli::RunCmd,
}

#[derive(Debug, clap::Subcommand)]
#[allow(deprecated)]
pub enum Subcommand {
	#[command(subcommand)]
	Key(sc_cli::KeySubcommand),

	#[deprecated(
		note = "build-spec command will be removed after 1/04/2026. Use export-chain-spec command instead"
	)]
	BuildSpec(sc_cli::BuildSpecCmd),

	ExportChainSpec(sc_cli::ExportChainSpecCmd),

	CheckBlock(sc_cli::CheckBlockCmd),

	ExportBlocks(sc_cli::ExportBlocksCmd),

	ExportState(sc_cli::ExportStateCmd),

	ImportBlocks(sc_cli::ImportBlocksCmd),

	PurgeChain(sc_cli::PurgeChainCmd),

	Revert(sc_cli::RevertCmd),

	ChainInfo(sc_cli::ChainInfoCmd),
}
