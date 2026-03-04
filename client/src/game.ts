/**
 * Pure game logic for simplified Exploding Kittens.
 *
 * Card layout for N players, D deck size:
 *   positions 0          .. N-2       : Exploding Kitten  (N-1 cards)
 *   positions N-1        .. 2N        : Defuse            (N+2 cards)
 *   positions 2N+1       .. D-1       : Safe              (rest)
 *
 * Rules:
 *   - Deal 5 cards each, then take turns drawing 1 card from the pile.
 *   - Draw an EK with a Defuse in hand → both discarded, you survive.
 *   - Draw an EK without a Defuse → eliminated.
 *   - Last player standing wins.
 */

export type CardType = "ek" | "defuse" | "safe";

export interface Card {
  deckPosition: number;
  type: CardType;
}

export interface PlayerState {
  name: string;
  alive: boolean;
  hand: Card[];
}

export interface GameState {
  numPlayers: number;
  deckSize: number;
  /** Next card index to draw from the shuffled deck */
  drawIndex: number;
  /** Index into players array for current turn */
  currentPlayer: number;
  players: PlayerState[];
  /** Game event log for the UI */
  log: LogEntry[];
  phase: GamePhase;
  winner: number | null;
}

export type GamePhase =
  | "setup"
  | "registering"
  | "masking"
  | "shuffling"
  | "dealing"
  | "playing"
  | "finished";

export interface LogEntry {
  phase: GamePhase | "info";
  message: string;
}

export function cardType(position: number, numPlayers: number): CardType {
  const numEk = numPlayers - 1;
  const numDefuse = numPlayers + 2;
  if (position < numEk) return "ek";
  if (position < numEk + numDefuse) return "defuse";
  return "safe";
}

export function createInitialState(
  numPlayers: number,
  deckSize: number,
  playerNames: string[],
): GameState {
  return {
    numPlayers,
    deckSize,
    drawIndex: 0,
    currentPlayer: 0,
    players: playerNames.map((name) => ({
      name,
      alive: true,
      hand: [],
    })),
    log: [],
    phase: "setup",
    winner: null,
  };
}

/** Deal a revealed card to a player. */
export function dealCard(
  state: GameState,
  playerIdx: number,
  deckPosition: number,
): GameState {
  const type = cardType(deckPosition, state.numPlayers);
  const card: Card = { deckPosition, type };
  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: [...p.hand, card] } : p,
  );
  return {
    ...state,
    players,
    drawIndex: state.drawIndex + 1,
    log: [
      ...state.log,
      {
        phase: "dealing",
        message: `${state.players[playerIdx].name} received a ${cardLabel(type)} card`,
      },
    ],
  };
}

/** Process a drawn card during the play phase. Returns updated state. */
export function processDrawnCard(
  state: GameState,
  playerIdx: number,
  deckPosition: number,
): GameState {
  const type = cardType(deckPosition, state.numPlayers);
  const player = state.players[playerIdx];
  const card: Card = { deckPosition, type };

  let players = [...state.players];
  const log = [...state.log];

  if (type === "ek") {
    // Check for Defuse in hand
    const defuseIdx = player.hand.findIndex((c) => c.type === "defuse");
    if (defuseIdx >= 0) {
      // Discard both the EK and the Defuse
      const newHand = player.hand.filter((_, i) => i !== defuseIdx);
      players[playerIdx] = { ...player, hand: newHand };
      log.push({
        phase: "playing",
        message: `${player.name} drew Exploding Kitten! Used Defuse to survive.`,
      });
    } else {
      // Eliminated
      players[playerIdx] = { ...player, alive: false };
      log.push({
        phase: "playing",
        message: `${player.name} drew Exploding Kitten! No Defuse — eliminated!`,
      });
    }
  } else {
    // Safe or Defuse — add to hand
    players[playerIdx] = { ...player, hand: [...player.hand, card] };
    log.push({
      phase: "playing",
      message: `${player.name} drew a ${cardLabel(type)} card.`,
    });
  }

  return { ...state, players, log, drawIndex: state.drawIndex + 1 };
}

/** Advance to the next alive player. */
export function nextTurn(state: GameState): GameState {
  const alive = state.players
    .map((p, i) => ({ ...p, idx: i }))
    .filter((p) => p.alive);

  if (alive.length <= 1) {
    return {
      ...state,
      phase: "finished",
      winner: alive.length === 1 ? alive[0].idx : null,
      log: [
        ...state.log,
        {
          phase: "finished",
          message:
            alive.length === 1
              ? `${alive[0].name} wins!`
              : "No players left — draw!",
        },
      ],
    };
  }

  // Find next alive player after current
  let next = (state.currentPlayer + 1) % state.numPlayers;
  while (!state.players[next].alive) {
    next = (next + 1) % state.numPlayers;
  }

  return { ...state, currentPlayer: next };
}

/** Check if game is over. */
export function isGameOver(state: GameState): boolean {
  const aliveCount = state.players.filter((p) => p.alive).length;
  return aliveCount <= 1 || state.drawIndex >= state.deckSize;
}

/** Get a human-readable label for a card type. */
export function cardLabel(type: CardType): string {
  switch (type) {
    case "ek":
      return "Exploding Kitten";
    case "defuse":
      return "Defuse";
    case "safe":
      return "Safe";
  }
}

/** Cards remaining in the draw pile. */
export function cardsRemaining(state: GameState): number {
  return state.deckSize - state.drawIndex;
}
