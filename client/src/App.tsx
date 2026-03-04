import { useState, useCallback } from "react";
import type { GameState } from "./game";
import { GameSetup } from "./components/GameSetup";
import { GameBoard } from "./components/GameBoard";
import { GameHarness } from "./harness";
import * as chain from "./chain";
import { getDevAccounts } from "./accounts";

export function App() {
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

  return (
    <div className="app">
      <h1>Exploding Kittens</h1>
      <p className="subtitle">Mental Poker Edition</p>

      {error && <div className="error-banner">{error}</div>}

      {!gameState ? (
        <GameSetup onStart={handleStart} />
      ) : (
        <GameBoard state={gameState} onStop={handleStop} />
      )}
    </div>
  );
}
