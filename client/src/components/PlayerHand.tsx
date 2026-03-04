import type { Card } from "../game";

interface Props {
  cards: Card[];
  isCurrentPlayer: boolean;
}

const CARD_ICONS: Record<string, string> = {
  ek: "EK",
  defuse: "DEF",
  safe: "OK",
};

export function PlayerHand({ cards, isCurrentPlayer }: Props) {
  if (cards.length === 0) return null;

  return (
    <div className={`player-hand ${isCurrentPlayer ? "current" : ""}`}>
      {cards.map((card, i) => (
        <div key={i} className={`card card-${card.type}`} title={`Deck position: ${card.deckPosition}`}>
          <span className="card-icon">{CARD_ICONS[card.type]}</span>
          <span className="card-label">{card.type}</span>
        </div>
      ))}
    </div>
  );
}
