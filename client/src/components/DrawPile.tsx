interface Props {
  remaining: number;
  currentPlayer: string | undefined;
}

export function DrawPile({ remaining, currentPlayer }: Props) {
  return (
    <div className="draw-pile">
      <div className="pile-card">
        <span className="pile-icon">?</span>
      </div>
      <div className="pile-info">
        <span className="pile-count">{remaining} cards left</span>
        {currentPlayer && (
          <span className="pile-turn">{currentPlayer}&apos;s turn</span>
        )}
      </div>
    </div>
  );
}
