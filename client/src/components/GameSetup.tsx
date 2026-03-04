import { useState } from "react";

interface Props {
  onStart: (
    numPlayers: number,
    deckSize: number,
    nodeUrl: string,
    stepDelay: number,
  ) => void;
}

export function GameSetup({ onStart }: Props) {
  const [numPlayers, setNumPlayers] = useState(2);
  const [deckSize, setDeckSize] = useState(20);
  const [nodeUrl, setNodeUrl] = useState("ws://127.0.0.1:9944");
  const [stepDelay, setStepDelay] = useState(1000);
  const [starting, setStarting] = useState(false);

  const minDeck = numPlayers * 5 + numPlayers; // enough for dealing + at least some draws
  const maxDeck = 200;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    onStart(numPlayers, deckSize, nodeUrl, stepDelay);
  };

  return (
    <form className="setup-form" onSubmit={handleSubmit}>
      <div className="setup-field">
        <label htmlFor="numPlayers">Players</label>
        <select
          id="numPlayers"
          value={numPlayers}
          onChange={(e) => {
            const n = Number(e.target.value);
            setNumPlayers(n);
            // Adjust deck size to minimum if needed
            const newMin = n * 5 + n;
            if (deckSize < newMin) setDeckSize(newMin);
          }}
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} players
            </option>
          ))}
        </select>
      </div>

      <div className="setup-field">
        <label htmlFor="deckSize">Deck Size</label>
        <input
          id="deckSize"
          type="range"
          min={minDeck}
          max={maxDeck}
          value={deckSize}
          onChange={(e) => setDeckSize(Number(e.target.value))}
        />
        <span className="range-value">{deckSize} cards</span>
      </div>

      <div className="setup-field">
        <label htmlFor="stepDelay">Speed</label>
        <input
          id="stepDelay"
          type="range"
          min={0}
          max={3000}
          step={100}
          value={stepDelay}
          onChange={(e) => setStepDelay(Number(e.target.value))}
        />
        <span className="range-value">
          {stepDelay === 0 ? "Instant" : `${(stepDelay / 1000).toFixed(1)}s`}
        </span>
      </div>

      <div className="setup-field">
        <label htmlFor="nodeUrl">Node URL</label>
        <input
          id="nodeUrl"
          type="text"
          value={nodeUrl}
          onChange={(e) => setNodeUrl(e.target.value)}
        />
      </div>

      <div className="setup-info">
        <p>
          {numPlayers - 1} Exploding Kitten{numPlayers - 1 !== 1 ? "s" : ""},
          {" "}{numPlayers + 2} Defuses,{" "}
          {deckSize - (numPlayers - 1) - (numPlayers + 2)} Safe cards
        </p>
      </div>

      <button type="submit" className="btn-primary" disabled={starting}>
        {starting ? "Starting..." : "Start Game"}
      </button>
    </form>
  );
}
