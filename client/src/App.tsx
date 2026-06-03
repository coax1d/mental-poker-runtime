import { useState, useCallback } from "react";
import type { GameState } from "./game";
import { GameSetup } from "./components/GameSetup";
import { GameBoard } from "./components/GameBoard";
import { About } from "./components/About";
import { GameHarness } from "./harness";
import { PlayerAgent } from "./agent";
import * as chain from "./chain";
import { getDevAccounts, getDevAccount } from "./accounts";

type Tab = "about" | "play";

export function App() {
  const [tab, setTab] = useState<Tab>("about");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [harness, setHarness] = useState<GameHarness | null>(null);
  const [agent, setAgent] = useState<PlayerAgent | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStartSimulation = useCallback(
    async (numPlayers: number, deckSize: number, nodeUrl: string, stepDelay: number) => {
      setError(null);
      try {
        const { api } = await chain.connect(nodeUrl);
        const accounts = getDevAccounts(numPlayers);

        const h = new GameHarness({
          api,
          accounts,
          deckSize,
          stepDelay,
          onUpdate: (state) => setGameState({ ...state }),
        });
        setHarness(h);
        h.runGame();
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  const handleCreateGame = useCallback(
    async (accountName: string, deckSize: number, numPlayers: number, nodeUrl: string) => {
      setError(null);
      try {
        const { api } = await chain.connect(nodeUrl);
        const account = getDevAccount(accountName);

        const a = new PlayerAgent({
          api,
          account,
          onUpdate: (state) => setGameState({ ...state }),
        });
        setAgent(a);
        const id = await a.createGame(deckSize, numPlayers);
        setGameId(id);
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  const handleJoinGame = useCallback(
    async (accountName: string, joinGameId: number, nodeUrl: string) => {
      setError(null);
      try {
        const { api } = await chain.connect(nodeUrl);
        const account = getDevAccount(accountName);

        const a = new PlayerAgent({
          api,
          account,
          onUpdate: (state) => setGameState({ ...state }),
        });
        setAgent(a);
        setGameId(joinGameId);
        await a.joinGame(joinGameId);
      } catch (err) {
        setError(String(err));
      }
    },
    [],
  );

  const handleStop = useCallback(() => {
    harness?.stop();
    agent?.stop();
  }, [harness, agent]);

  const showingGame = gameState !== null;

  return (
    <div className="app">
      <h1>Exploding Kittens</h1>
      <p className="subtitle">Mental Poker Edition</p>

      {!showingGame && (
        <nav className="tab-bar">
          <button
            className={`tab ${tab === "about" ? "tab-active" : ""}`}
            onClick={() => setTab("about")}
          >
            About
          </button>
          <button
            className={`tab ${tab === "play" ? "tab-active" : ""}`}
            onClick={() => setTab("play")}
          >
            Play
          </button>
        </nav>
      )}

      {error && <div className="error-banner">{error}</div>}

      {gameId !== null && showingGame && (
        <div className="game-id-banner">
          Game ID: <strong>{gameId}</strong>
          <span className="game-id-hint">Share this with other players</span>
        </div>
      )}

      {showingGame ? (
        <GameBoard state={gameState} onStop={handleStop} />
      ) : tab === "about" ? (
        <About />
      ) : (
        <GameSetup
          onStartSimulation={handleStartSimulation}
          onCreateGame={handleCreateGame}
          onJoinGame={handleJoinGame}
        />
      )}
    </div>
  );
}
