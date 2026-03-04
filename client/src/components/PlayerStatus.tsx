import type { PlayerState } from "../game";

interface Props {
  player: PlayerState;
  isCurrent: boolean;
}

export function PlayerStatus({ player, isCurrent }: Props) {
  return (
    <div
      className={`player-status ${player.alive ? "alive" : "dead"} ${isCurrent ? "current" : ""}`}
    >
      <span className="player-name">{player.name}</span>
      <span className="player-life">{player.alive ? "Alive" : "Dead"}</span>
      <span className="player-cards">{player.hand.length} cards</span>
    </div>
  );
}
