import { useState, useCallback } from "react";
import type { GameState } from "./game";
import { GameBoard } from "./components/GameBoard";
import { About } from "./components/About";
import { GameHarness, type PlayerAccount } from "./harness";
import * as chain from "./chain";
import { accountFromMnemonic, h160FromHex } from "./accounts";

type Tab = "about" | "play";

// Default contract address (most recent deployment on Paseo Asset Hub).
// Redeploy via contracts/mental-poker/ to get a new one.
const DEFAULT_CONTRACT = "0xaa7fba169e86dca20440a4ceec394f334845add7";
const DEFAULT_WS = "wss://sys.ibp.network/asset-hub-paseo";

export function App() {
  const [tab, setTab] = useState<Tab>("about");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [harness, setHarness] = useState<GameHarness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Setup form state
  const [mnemonic1, setMnemonic1] = useState("");
  const [mnemonic2, setMnemonic2] = useState("");
  const [contractAddr, setContractAddr] = useState(DEFAULT_CONTRACT);
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const [deckSize, setDeckSize] = useState(20);
  const [stepDelay, setStepDelay] = useState(500);

  const handleStart = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!mnemonic1.trim() || !mnemonic2.trim()) {
        throw new Error("Both player mnemonics are required");
      }

      // Derive accounts
      const [p1, p2] = await Promise.all([
        accountFromMnemonic("Player 1", mnemonic1.trim()),
        accountFromMnemonic("Player 2", mnemonic2.trim()),
      ]);

      // Connect to chain
      const conn = await chain.connect(contractAddr, wsUrl);

      const h = new GameHarness({
        conn,
        accounts: [p1, p2],
        deckSize,
        stepDelay,
        onUpdate: (state) => setGameState({ ...state }),
      });
      setHarness(h);
      h.runGame();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [mnemonic1, mnemonic2, contractAddr, wsUrl, deckSize, stepDelay]);

  const handleStop = useCallback(() => {
    harness?.stop();
  }, [harness]);

  const showingGame = gameState !== null;

  return (
    <div className="app">
      <h1>Exploding Kittens</h1>
      <p className="subtitle">Mental Poker Edition (Paseo Asset Hub)</p>

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
        <div className="setup-panel">
          <h2>Game Setup (Simulation Mode)</h2>
          <p className="setup-hint">
            Both players run from this browser. Shuffles happen off-chain;
            registration, deck agreement, and reveals are verified on Paseo Asset Hub.
          </p>

          <label>
            Player 1 Mnemonic
            <input
              type="password"
              value={mnemonic1}
              onChange={(e) => setMnemonic1(e.target.value)}
              placeholder="12-word mnemonic..."
            />
          </label>

          <label>
            Player 2 Mnemonic
            <input
              type="password"
              value={mnemonic2}
              onChange={(e) => setMnemonic2(e.target.value)}
              placeholder="12-word mnemonic..."
            />
          </label>

          <label>
            Contract Address
            <input
              type="text"
              value={contractAddr}
              onChange={(e) => setContractAddr(e.target.value)}
            />
          </label>

          <label>
            WebSocket Endpoint
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
            />
          </label>

          <div className="setup-row">
            <label>
              Deck Size
              <input
                type="number"
                value={deckSize}
                onChange={(e) => setDeckSize(Number(e.target.value))}
                min={8}
                max={52}
              />
            </label>
            <label>
              Step Delay (ms)
              <input
                type="number"
                value={stepDelay}
                onChange={(e) => setStepDelay(Number(e.target.value))}
                min={0}
                max={5000}
              />
            </label>
          </div>

          <button
            className="btn-start"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? "Connecting..." : "Start Game"}
          </button>
        </div>
      )}
    </div>
  );
}
