use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use codec::{Decode, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub type Curve = ark_secp256k1::Projective;
pub type CardParameters = cards_protocol::Parameters<Curve>;
pub type MaskedCard = cards_protocol::MaskedCard<Curve>;
pub type UnmaskedCard = cards_protocol::UnmaskedCard<Curve>;
pub type PlayerHello = cards_protocol::keys::PlayerHello<Curve>;
pub type PlayerPublicKey = cards_protocol::keys::PlayerPublicKey<Curve>;
pub type AggregatedPublicKeys<'a> = cards_protocol::keys::AggregatedPublicKeys<'a, Curve>;
pub type ShuffleMessage = cards_protocol::shuffle::ShuffleMessage<Curve>;
pub type RevealMessage = cards_protocol::RevealMessage<Curve>;
pub type RevealToken = cards_protocol::RevealToken<Curve>;

#[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
pub enum GamePhase {
	Registration,
	Masking,
	Shuffling,
	Playing,
	Complete,
}

#[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
pub struct GameInfo {
	pub phase: GamePhase,
	pub deck_size: u32,
	pub num_players: u32,
	pub registered_count: u32,
}

pub fn serialize_ark<T: CanonicalSerialize>(val: &T) -> alloc::vec::Vec<u8> {
	let mut bytes = alloc::vec::Vec::new();
	val.serialize_compressed(&mut bytes).expect("serialization should not fail");
	bytes
}

pub fn deserialize_ark<T: CanonicalDeserialize>(bytes: &[u8]) -> Result<T, &'static str> {
	T::deserialize_compressed(bytes).map_err(|_| "arkworks deserialization failed")
}
