use mental_poker_runtime::WASM_BINARY;
use polkadot_sdk::{
	sc_service::{ChainType, Properties},
	*,
};

pub type ChainSpec = sc_service::GenericChainSpec;

fn props() -> Properties {
	let mut properties = Properties::new();
	properties.insert("tokenDecimals".to_string(), 0.into());
	properties.insert("tokenSymbol".to_string(), "POKER".into());
	properties
}

pub fn development_chain_spec() -> Result<ChainSpec, String> {
	Ok(ChainSpec::builder(WASM_BINARY.expect("Development wasm not available"), Default::default())
		.with_name("Mental Poker Development")
		.with_id("dev")
		.with_chain_type(ChainType::Development)
		.with_genesis_config_preset_name(sp_genesis_builder::DEV_RUNTIME_PRESET)
		.with_properties(props())
		.build())
}
