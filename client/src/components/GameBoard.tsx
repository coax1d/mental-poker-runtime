import type { GameState } from "../game";
import { cardsRemaining } from "../game";
import { PlayerHand } from "./PlayerHand";
import { DrawPile } from "./DrawPile";
import { PlayerStatus } from "./PlayerStatus";
import { GameLog } from "./GameLog";

interface Props {
  state: GameState;
  onStop: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  setup: "Setting up...",
  registering: "Registering players...",
  masking: "Masking deck...",
  shuffling: "Shuffling (ZK proofs)...",
  dealing: "Dealing cards...",
  playing: "Game in progress",
  finished: "Game over",
};

export function GameBoard({ state, onStop }: Props) {
  const currentPlayer =
    state.phase === "playing" ? state.players[state.currentPlayer] : null;
  const remaining = cardsRemaining(state);

  return (
    <div className="game-board">
      <div className="phase-bar">
        <span className="phase-label">
          {PHASE_LABELS[state.phase] ?? state.phase}
        </span>
        {state.phase !== "finished" && (
          <button className="btn-stop" onClick={onStop}>
            Stop
          </button>
        )}
      </div>

      {state.winner !== null && (
        <div className="winner-banner">
          {state.players[state.winner].name} wins!
        </div>
      )}

      <div className="board-layout">
        <div className="board-main">
          <DrawPile
            remaining={remaining}
            currentPlayer={currentPlayer?.name}
          />

          {state.players.map((player, i) => (
            <div key={i} className="player-section">
              <PlayerStatus
                player={player}
                isCurrent={state.currentPlayer === i && state.phase === "playing"}
              />
              <PlayerHand cards={player.hand} isCurrentPlayer={state.currentPlayer === i} />
            </div>
          ))}
        </div>

        <div className="board-sidebar">
          <GameLog entries={state.log} />
        </div>
      </div>
    </div>
  );
}
