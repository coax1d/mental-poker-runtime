import { useState, useCallback } from "react";
import type { GameState } from "./game";
import { GameSetup } from "./components/GameSetup";
import { GameBoard } from "./components/GameBoard";
import { About } from "./components/About";
import { GameHarness } from "./harness";
import * as chain from "./chain";
import { getDevAccounts } from "./accounts";

type Tab = "about" | "play";

export function App() {
  const [tab, setTab] = useState<Tab>("about");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [harness, setHarness] = useState<GameHarness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = useCallback(
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

  const handleStop = useCallback(() => {
    harness?.stop();
  }, [harness]);

  const showingGame = tab === "play" && gameState;

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

      {showingGame ? (
        <GameBoard state={gameState} onStop={handleStop} />
      ) : tab === "about" ? (
        <About />
      ) : (
        <GameSetup onStart={handleStart} />
      )}
    </div>
  );
}
