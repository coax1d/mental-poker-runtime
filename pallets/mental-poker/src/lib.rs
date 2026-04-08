#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::vec::Vec;
use frame_support::pallet_prelude::*;
use frame_system::pallet_prelude::*;

pub mod types;
use types::*;

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
	use super::*;

	/// Maximum number of players per game.
	pub const MAX_PLAYERS: u32 = 10;
	/// Maximum serialized size for a player's public key / hello message.
	pub const MAX_KEY_SIZE: u32 = 1024;
	/// Maximum serialized size for the aggregate key data.
	pub const MAX_AGG_KEY_SIZE: u32 = 4096;
	/// Maximum serialized size for the deck (52 cards * ~66 bytes per masked card + overhead).
	pub const MAX_DECK_SIZE: u32 = 65_536;
	/// Maximum serialized size for a shuffle message (deck + ZK proof).
	pub const MAX_SHUFFLE_SIZE: u32 = 262_144;
	/// Maximum serialized size for a reveal message.
	pub const MAX_REVEAL_SIZE: u32 = 1024;

	type MaxPlayers = ConstU32<MAX_PLAYERS>;
	type MaxKeySize = ConstU32<MAX_KEY_SIZE>;
	type MaxAggKeySize = ConstU32<MAX_AGG_KEY_SIZE>;
	type MaxDeckSize = ConstU32<MAX_DECK_SIZE>;
	type MaxShuffleSize = ConstU32<MAX_SHUFFLE_SIZE>;
	type MaxRevealSize = ConstU32<MAX_REVEAL_SIZE>;

	#[pallet::config]
	pub trait Config:
		frame_system::Config<RuntimeEvent: From<Event<Self>>>
	{
	}

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	// ---- STORAGE ----

	/// Auto-incrementing game ID counter.
	#[pallet::storage]
	pub type GameCounter<T> = StorageValue<_, u32, ValueQuery>;

	/// Game metadata: phase, deck size, player count.
	#[pallet::storage]
	pub type Games<T> = StorageMap<_, Blake2_128Concat, u32, GameInfo>;

	/// Ordered list of players per game.
	#[pallet::storage]
	pub type PlayerOrder<T: Config> =
		StorageMap<_, Blake2_128Concat, u32, BoundedVec<T::AccountId, MaxPlayers>>;

	/// Serialized PlayerHello (public key + ownership proof) per game per player.
	#[pallet::storage]
	pub type PlayerKeys<T: Config> = StorageDoubleMap<
		_,
		Blake2_128Concat,
		u32,
		Blake2_128Concat,
		T::AccountId,
		BoundedVec<u8, MaxKeySize>,
	>;

	/// Serialized aggregate key data per game.
	#[pallet::storage]
	pub type AggregateKeyData<T> =
		StorageMap<_, Blake2_128Concat, u32, BoundedVec<u8, MaxAggKeySize>>;

	/// Serialized current masked deck per game.
	#[pallet::storage]
	pub type CurrentDeck<T> = StorageMap<_, Blake2_128Concat, u32, BoundedVec<u8, MaxDeckSize>>;

	/// Index of the next player who should shuffle.
	#[pallet::storage]
	pub type ShuffleIndex<T> = StorageMap<_, Blake2_128Concat, u32, u32, ValueQuery>;

	/// Reveal tokens per (game_id, card_index) per player.
	#[pallet::storage]
	pub type RevealTokens<T: Config> = StorageNMap<
		_,
		(
			NMapKey<Blake2_128Concat, u32>,
			NMapKey<Blake2_128Concat, u32>,
			NMapKey<Blake2_128Concat, T::AccountId>,
		),
		BoundedVec<u8, MaxRevealSize>,
	>;

	/// Count of reveal tokens submitted per (game_id, card_index).
	#[pallet::storage]
	pub type RevealCount<T> =
		StorageDoubleMap<_, Blake2_128Concat, u32, Blake2_128Concat, u32, u32, ValueQuery>;

	/// Sub-deck being reshuffled (separate from CurrentDeck during reshuffle).
	#[pallet::storage]
	pub type ReshuffleDeck<T> = StorageMap<_, Blake2_128Concat, u32, BoundedVec<u8, MaxDeckSize>>;

	/// The card index from which the reshuffle sub-deck starts.
	/// After reshuffle, CurrentDeck is truncated to this index and the reshuffled sub-deck is appended.
	#[pallet::storage]
	pub type ReshuffleFromIndex<T> = StorageMap<_, Blake2_128Concat, u32, u32>;

	// ---- EVENTS ----

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		GameCreated { game_id: u32, creator: T::AccountId, deck_size: u32, num_players: u32 },
		PlayerRegistered { game_id: u32, player: T::AccountId },
		KeysAggregated { game_id: u32 },
		DeckMasked { game_id: u32 },
		ShuffleSubmitted { game_id: u32, player: T::AccountId },
		ShuffleComplete { game_id: u32 },
		RevealTokenSubmitted { game_id: u32, card_index: u32, player: T::AccountId },
		CardRevealed { game_id: u32, card_index: u32 },
		ReshuffleInitiated { game_id: u32, from_card_index: u32, sub_deck_size: u32 },
		ReshuffleComplete { game_id: u32, new_deck_size: u32 },
	}

	// ---- ERRORS ----

	#[pallet::error]
	pub enum Error<T> {
		GameNotFound,
		GameNotInPhase,
		AlreadyRegistered,
		GameFull,
		NotYourTurn,
		InvalidProof,
		DeserializationFailed,
		InvalidDeckSize,
		CardIndexOutOfBounds,
		AlreadyRevealed,
		DataTooLarge,
		InternalError,
	}

	// ---- EXTRINSICS ----

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		/// Create a new mental poker game.
		///
		/// The caller becomes the first registered player.
		/// `deck_size` must be a valid deck size for the protocol.
		/// `num_players` is how many players are expected (2..=MAX_PLAYERS).
		#[pallet::call_index(0)]
		#[pallet::weight(Weight::from_parts(100_000, 0))]
		pub fn create_game(
			origin: OriginFor<T>,
			deck_size: u32,
			num_players: u32,
		) -> DispatchResult {
			let who = ensure_signed(origin)?;

			ensure!(num_players >= 2 && num_players <= MAX_PLAYERS, Error::<T>::InvalidDeckSize);
			let params = Self::load_parameters(deck_size)?;
			ensure!(
				params.check_deck_size(deck_size as usize),
				Error::<T>::InvalidDeckSize
			);

			let game_id = GameCounter::<T>::get();
			GameCounter::<T>::put(game_id.saturating_add(1));

			let game_info = GameInfo {
				phase: GamePhase::Registration,
				deck_size,
				num_players,
				registered_count: 0,
			};
			Games::<T>::insert(game_id, game_info);

			let players: BoundedVec<T::AccountId, MaxPlayers> = BoundedVec::new();
			PlayerOrder::<T>::insert(game_id, players);

			Self::deposit_event(Event::GameCreated {
				game_id,
				creator: who,
				deck_size,
				num_players,
			});

			Ok(())
		}

		/// Register as a player in an existing game.
		///
		/// `player_hello_bytes` is the serialized `PlayerHello<Curve>` containing
		/// the player's public key and key ownership proof.
		#[pallet::call_index(1)]
		#[pallet::weight(Weight::from_parts(500_000, 0))]
		pub fn register_player(
			origin: OriginFor<T>,
			game_id: u32,
			player_hello_bytes: BoundedVec<u8, MaxKeySize>,
		) -> DispatchResult {
			let who = ensure_signed(origin)?;

			let mut game = Games::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(game.phase == GamePhase::Registration, Error::<T>::GameNotInPhase);
			ensure!(!PlayerKeys::<T>::contains_key(game_id, &who), Error::<T>::AlreadyRegistered);
			ensure!(game.registered_count < game.num_players, Error::<T>::GameFull);

			// Deserialize and verify the player hello
			let player_hello: PlayerHello =
				deserialize_ark(&player_hello_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;

			// Verify key ownership proof using the player's account ID as public info
			let player_name = Self::account_to_name(&who);
			let params = Self::load_parameters(game.deck_size)?;
			params
				.verify_player(&player_hello, player_name.as_slice())
				.map_err(|_| Error::<T>::InvalidProof)?;

			// Store the player's key data
			PlayerKeys::<T>::insert(game_id, &who, player_hello_bytes);

			// Add to player order
			PlayerOrder::<T>::try_mutate(game_id, |maybe_players| -> DispatchResult {
				let players = maybe_players.as_mut().ok_or(Error::<T>::GameNotFound)?;
				players.try_push(who.clone()).map_err(|_| Error::<T>::GameFull)?;
				Ok(())
			})?;

			game.registered_count = game.registered_count.saturating_add(1);

			// If all players registered, aggregate keys and move to Masking phase
			if game.registered_count == game.num_players {
				Self::aggregate_keys(game_id, &game)?;
				game.phase = GamePhase::Masking;
				Self::deposit_event(Event::KeysAggregated { game_id });
			}

			Games::<T>::insert(game_id, game);
			Self::deposit_event(Event::PlayerRegistered { game_id, player: who });

			Ok(())
		}

		/// Submit the initial masked deck.
		///
		/// Can only be called once all players are registered (Masking phase).
		/// `masked_deck_bytes` is the serialized `Vec<MaskedCard>`.
		#[pallet::call_index(2)]
		#[pallet::weight(Weight::from_parts(1_000_000, 0))]
		pub fn submit_masked_deck(
			origin: OriginFor<T>,
			game_id: u32,
			masked_deck_bytes: BoundedVec<u8, MaxDeckSize>,
		) -> DispatchResult {
			let _who = ensure_signed(origin)?;

			let mut game = Games::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(game.phase == GamePhase::Masking, Error::<T>::GameNotInPhase);

			// Verify the deck can be deserialized and has the right number of cards
			let deck: Vec<MaskedCard> =
				deserialize_ark(&masked_deck_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;
			ensure!(deck.len() == game.deck_size as usize, Error::<T>::InvalidDeckSize);

			CurrentDeck::<T>::insert(game_id, masked_deck_bytes);
			ShuffleIndex::<T>::insert(game_id, 0u32);

			game.phase = GamePhase::Shuffling;
			Games::<T>::insert(game_id, game);

			Self::deposit_event(Event::DeckMasked { game_id });

			Ok(())
		}

		/// Submit a shuffled deck with its ZK proof.
		///
		/// Must be called by players in order (according to PlayerOrder).
		/// Works for both the initial Shuffling phase and mid-game Reshuffling.
		/// `shuffle_msg_bytes` is the serialized `ShuffleMessage<Curve>`.
		#[pallet::call_index(3)]
		#[pallet::weight(Weight::from_parts(50_000_000, 0))]
		pub fn submit_shuffle(
			origin: OriginFor<T>,
			game_id: u32,
			shuffle_msg_bytes: BoundedVec<u8, MaxShuffleSize>,
		) -> DispatchResult {
			let who = ensure_signed(origin)?;

			let mut game = Games::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			let is_reshuffle = match game.phase {
				GamePhase::Shuffling => false,
				GamePhase::Reshuffling => true,
				_ => return Err(Error::<T>::GameNotInPhase.into()),
			};

			// Verify it's this player's turn
			let players = PlayerOrder::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			let shuffle_idx = ShuffleIndex::<T>::get(game_id);
			ensure!(
				players.get(shuffle_idx as usize) == Some(&who),
				Error::<T>::NotYourTurn
			);

			// Deserialize the shuffle message
			let shuffle_msg: ShuffleMessage =
				deserialize_ark(&shuffle_msg_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;

			// Load the deck being shuffled (CurrentDeck or ReshuffleDeck)
			let deck_bytes = if is_reshuffle {
				ReshuffleDeck::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?
			} else {
				CurrentDeck::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?
			};
			let current_deck: Vec<MaskedCard> =
				deserialize_ark(&deck_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;

			// Reconstruct aggregate public keys and verify the shuffle
			let apk_bytes = AggregateKeyData::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			let params = Self::load_parameters(game.deck_size)?;
			let apk = Self::reconstruct_apk(game_id, &params, &apk_bytes)?;

			let (_pk, shuffled_deck) = apk.verify_shuffle(&current_deck, &shuffle_msg)
				.map_err(|_| Error::<T>::InvalidProof)?;

			let new_deck_bytes: BoundedVec<u8, MaxDeckSize> =
				serialize_ark(shuffled_deck)
					.try_into()
					.map_err(|_| Error::<T>::DataTooLarge)?;

			if is_reshuffle {
				ReshuffleDeck::<T>::insert(game_id, new_deck_bytes.clone());
			} else {
				CurrentDeck::<T>::insert(game_id, new_deck_bytes.clone());
			}

			let next_idx = shuffle_idx.saturating_add(1);
			ShuffleIndex::<T>::insert(game_id, next_idx);

			Self::deposit_event(Event::ShuffleSubmitted { game_id, player: who });

			// If all players have shuffled
			if next_idx >= game.num_players {
				if is_reshuffle {
					// Merge reshuffled sub-deck back into CurrentDeck
					let from_idx = ReshuffleFromIndex::<T>::get(game_id)
						.ok_or(Error::<T>::InternalError)?;
					let main_deck_bytes = CurrentDeck::<T>::get(game_id)
						.ok_or(Error::<T>::GameNotFound)?;
					let mut main_deck: Vec<MaskedCard> =
						deserialize_ark(&main_deck_bytes)
							.map_err(|_| Error::<T>::DeserializationFailed)?;
					let reshuffled: Vec<MaskedCard> =
						deserialize_ark(&new_deck_bytes)
							.map_err(|_| Error::<T>::DeserializationFailed)?;

					main_deck.truncate(from_idx as usize);
					main_deck.extend(reshuffled);

					let combined_bytes: BoundedVec<u8, MaxDeckSize> =
						serialize_ark(&main_deck)
							.try_into()
							.map_err(|_| Error::<T>::DataTooLarge)?;

					let new_deck_size = main_deck.len() as u32;
					CurrentDeck::<T>::insert(game_id, combined_bytes);
					game.deck_size = new_deck_size;
					game.phase = GamePhase::Playing;
					Games::<T>::insert(game_id, game);

					// Cleanup
					ReshuffleDeck::<T>::remove(game_id);
					ReshuffleFromIndex::<T>::remove(game_id);

					Self::deposit_event(Event::ReshuffleComplete { game_id, new_deck_size });
				} else {
					game.phase = GamePhase::Playing;
					Games::<T>::insert(game_id, game);
					Self::deposit_event(Event::ShuffleComplete { game_id });
				}
			} else {
				Games::<T>::insert(game_id, game);
			}

			Ok(())
		}

		/// Submit a reveal token for a specific card.
		///
		/// `reveal_msg_bytes` is the serialized `RevealMessage<Curve>`.
		/// When all players have submitted reveal tokens for a card, it is unmasked.
		#[pallet::call_index(4)]
		#[pallet::weight(Weight::from_parts(1_000_000, 0))]
		pub fn submit_reveal(
			origin: OriginFor<T>,
			game_id: u32,
			card_index: u32,
			reveal_msg_bytes: BoundedVec<u8, MaxRevealSize>,
		) -> DispatchResult {
			let who = ensure_signed(origin)?;

			let game = Games::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(game.phase == GamePhase::Playing, Error::<T>::GameNotInPhase);
			ensure!(card_index < game.deck_size, Error::<T>::CardIndexOutOfBounds);

			// Check player hasn't already submitted a reveal for this card
			ensure!(
				!RevealTokens::<T>::contains_key((game_id, card_index, &who)),
				Error::<T>::AlreadyRevealed
			);

			// Verify the player is part of the game
			let players = PlayerOrder::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(players.contains(&who), Error::<T>::InvalidProof);

			// Deserialize and verify the reveal message
			let reveal_msg: RevealMessage =
				deserialize_ark(&reveal_msg_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;

			let params = Self::load_parameters(game.deck_size)?;
			params
				.verify_single_reveal(&reveal_msg)
				.map_err(|_| Error::<T>::InvalidProof)?;

			// Store the reveal token
			RevealTokens::<T>::insert(
				(game_id, card_index, &who),
				reveal_msg_bytes,
			);

			let new_count = RevealCount::<T>::get(game_id, card_index).saturating_add(1);
			RevealCount::<T>::insert(game_id, card_index, new_count);

			Self::deposit_event(Event::RevealTokenSubmitted {
				game_id,
				card_index,
				player: who,
			});

			// If all players have submitted reveals for this card, emit CardRevealed
			if new_count >= game.num_players {
				Self::deposit_event(Event::CardRevealed { game_id, card_index });
			}

			Ok(())
		}

		/// Initiate a mid-game reshuffle (e.g., after an Exploding Kitten is defused).
		///
		/// The caller submits a sub-deck (remaining undrawn cards + the card to re-insert)
		/// and a `from_card_index` indicating where the sub-deck slots back into CurrentDeck.
		/// All players must then submit shuffles for this sub-deck before play resumes.
		#[pallet::call_index(5)]
		#[pallet::weight(Weight::from_parts(2_000_000, 0))]
		pub fn initiate_reshuffle(
			origin: OriginFor<T>,
			game_id: u32,
			from_card_index: u32,
			reshuffle_deck_bytes: BoundedVec<u8, MaxDeckSize>,
		) -> DispatchResult {
			let who = ensure_signed(origin)?;

			let mut game = Games::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(game.phase == GamePhase::Playing, Error::<T>::GameNotInPhase);

			// Verify the player is part of the game
			let players = PlayerOrder::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			ensure!(players.contains(&who), Error::<T>::InvalidProof);

			// Validate the sub-deck can be deserialized
			let sub_deck: Vec<MaskedCard> =
				deserialize_ark(&reshuffle_deck_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;
			let sub_deck_size = sub_deck.len() as u32;

			// Store reshuffle state
			ReshuffleDeck::<T>::insert(game_id, reshuffle_deck_bytes);
			ReshuffleFromIndex::<T>::insert(game_id, from_card_index);
			ShuffleIndex::<T>::insert(game_id, 0u32);

			game.phase = GamePhase::Reshuffling;
			Games::<T>::insert(game_id, game);

			Self::deposit_event(Event::ReshuffleInitiated {
				game_id,
				from_card_index,
				sub_deck_size,
			});

			Ok(())
		}
	}

	// ---- HELPERS ----

	impl<T: Config> Pallet<T> {
		/// Load protocol parameters for the given deck size.
		fn load_parameters(_deck_size: u32) -> Result<CardParameters, DispatchError> {
			// Use the pre-generated parameters from deck-secp256k1
			// These are valid for decks up to 200 cards
			Ok(deck_secp256k1::PARAMS.clone())
		}

		/// Convert an AccountId to a name byte slice for the protocol.
		fn account_to_name(who: &T::AccountId) -> alloc::vec::Vec<u8> {
			use codec::Encode;
			who.encode()
		}

		/// Aggregate all player keys for a game.
		fn aggregate_keys(game_id: u32, game: &GameInfo) -> Result<(), DispatchError> {
			let params = Self::load_parameters(game.deck_size)?;
			let players = PlayerOrder::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;

			let mut apk = params.create_aggregate_keys();

			for player in players.iter() {
				let key_bytes =
					PlayerKeys::<T>::get(game_id, player).ok_or(Error::<T>::GameNotFound)?;
				let player_hello: PlayerHello =
					deserialize_ark(&key_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;
				let player_name = Self::account_to_name(player);
				apk.verify_n_add(player_hello, player_name.as_slice())
					.map_err(|_| Error::<T>::InvalidProof)?;
			}

			// Serialize using the AggregatedPublicKeys' own CanonicalSerialize impl,
			// which writes Vec<PlayerPublicKey> (the aggregate key is re-derived on deser).
			let agg_data = serialize_ark(&apk);

			let bounded: BoundedVec<u8, MaxAggKeySize> =
				agg_data.try_into().map_err(|_| Error::<T>::DataTooLarge)?;
			AggregateKeyData::<T>::insert(game_id, bounded);

			Ok(())
		}

		/// Reconstruct AggregatedPublicKeys from stored data.
		fn reconstruct_apk<'a>(
			game_id: u32,
			params: &'a CardParameters,
			_apk_bytes: &[u8],
		) -> Result<AggregatedPublicKeys<'a>, DispatchError> {
			// Rebuild the aggregate keys from stored player hellos
			let players = PlayerOrder::<T>::get(game_id).ok_or(Error::<T>::GameNotFound)?;
			let mut apk = params.create_aggregate_keys();

			for player in players.iter() {
				let key_bytes =
					PlayerKeys::<T>::get(game_id, player).ok_or(Error::<T>::GameNotFound)?;
				let player_hello: PlayerHello =
					deserialize_ark(&key_bytes).map_err(|_| Error::<T>::DeserializationFailed)?;
				let player_name = Self::account_to_name(player);
				apk.verify_n_add(player_hello, player_name.as_slice())
					.map_err(|_| Error::<T>::InvalidProof)?;
			}

			Ok(apk)
		}
	}
}
