import { useState } from "react";
import { DEV_ACCOUNT_NAMES } from "../accounts";

export type GameMode = "simulation" | "multiplayer";

interface Props {
  onStartSimulation: (
    numPlayers: number,
    deckSize: number,
    nodeUrl: string,
    stepDelay: number,
  ) => void;
  onCreateGame: (
    accountName: string,
    deckSize: number,
    numPlayers: number,
    nodeUrl: string,
  ) => void;
  onJoinGame: (
    accountName: string,
    gameId: number,
    nodeUrl: string,
  ) => void;
}

export function GameSetup({ onStartSimulation, onCreateGame, onJoinGame }: Props) {
  const [mode, setMode] = useState<GameMode>("simulation");

  // Simulation fields
  const [numPlayers, setNumPlayers] = useState(2);
  const [deckSize, setDeckSize] = useState(20);
  const [nodeUrl, setNodeUrl] = useState("ws://127.0.0.1:9944");
  const [stepDelay, setStepDelay] = useState(1000);

  // Multiplayer fields
  const [accountName, setAccountName] = useState(DEV_ACCOUNT_NAMES[0]);
  const [mpDeckSize, setMpDeckSize] = useState(20);
  const [mpNumPlayers, setMpNumPlayers] = useState(2);
  const [joinGameId, setJoinGameId] = useState("");
  const [mpAction, setMpAction] = useState<"create" | "join">("create");

  const [starting, setStarting] = useState(false);

  const minDeck = numPlayers * 5 + numPlayers;
  const mpMinDeck = mpNumPlayers * 5 + mpNumPlayers;
  const maxDeck = 200;

  const handleSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    onStartSimulation(numPlayers, deckSize, nodeUrl, stepDelay);
  };

  const handleMultiplayer = (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    if (mpAction === "create") {
      onCreateGame(accountName, mpDeckSize, mpNumPlayers, nodeUrl);
    } else {
      const id = parseInt(joinGameId, 10);
      if (isNaN(id)) {
        setStarting(false);
        return;
      }
      onJoinGame(accountName, id, nodeUrl);
    }
  };

  return (
    <div>
      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === "simulation" ? "mode-active" : ""}`}
          onClick={() => setMode("simulation")}
          type="button"
        >
          Simulation
        </button>
        <button
          className={`mode-btn ${mode === "multiplayer" ? "mode-active" : ""}`}
          onClick={() => setMode("multiplayer")}
          type="button"
        >
          Multiplayer
        </button>
      </div>

      {mode === "simulation" ? (
        <form className="setup-form" onSubmit={handleSimulation}>
          <div className="setup-field">
            <label htmlFor="numPlayers">Players</label>
            <select
              id="numPlayers"
              value={numPlayers}
              onChange={(e) => {
                const n = Number(e.target.value);
                setNumPlayers(n);
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
            {starting ? "Starting..." : "Start Simulation"}
          </button>
        </form>
      ) : (
        <form className="setup-form" onSubmit={handleMultiplayer}>
          <div className="setup-field">
            <label htmlFor="account">Your Account</label>
            <select
              id="account"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            >
              {DEV_ACCOUNT_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="setup-field">
            <label>Action</label>
            <div className="action-toggle">
              <button
                type="button"
                className={`action-btn ${mpAction === "create" ? "action-active" : ""}`}
                onClick={() => setMpAction("create")}
              >
                Create Game
              </button>
              <button
                type="button"
                className={`action-btn ${mpAction === "join" ? "action-active" : ""}`}
                onClick={() => setMpAction("join")}
              >
                Join Game
              </button>
            </div>
          </div>

          {mpAction === "create" ? (
            <>
              <div className="setup-field">
                <label htmlFor="mpNumPlayers">Players</label>
                <select
                  id="mpNumPlayers"
                  value={mpNumPlayers}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setMpNumPlayers(n);
                    const newMin = n * 5 + n;
                    if (mpDeckSize < newMin) setMpDeckSize(newMin);
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
                <label htmlFor="mpDeckSize">Deck Size</label>
                <input
                  id="mpDeckSize"
                  type="range"
                  min={mpMinDeck}
                  max={maxDeck}
                  value={mpDeckSize}
                  onChange={(e) => setMpDeckSize(Number(e.target.value))}
                />
                <span className="range-value">{mpDeckSize} cards</span>
              </div>

              <div className="setup-info">
                <p>
                  {mpNumPlayers - 1} Exploding Kitten{mpNumPlayers - 1 !== 1 ? "s" : ""},
                  {" "}{mpNumPlayers + 2} Defuses,{" "}
                  {mpDeckSize - (mpNumPlayers - 1) - (mpNumPlayers + 2)} Safe cards
                </p>
              </div>
            </>
          ) : (
            <div className="setup-field">
              <label htmlFor="joinGameId">Game ID</label>
              <input
                id="joinGameId"
                type="text"
                placeholder="e.g. 0"
                value={joinGameId}
                onChange={(e) => setJoinGameId(e.target.value)}
              />
            </div>
          )}

          <div className="setup-field">
            <label htmlFor="mpNodeUrl">Node URL</label>
            <input
              id="mpNodeUrl"
              type="text"
              value={nodeUrl}
              onChange={(e) => setNodeUrl(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={starting}>
            {starting
              ? "Connecting..."
              : mpAction === "create"
                ? "Create & Join"
                : "Join Game"}
          </button>
        </form>
      )}
    </div>
  );
}
