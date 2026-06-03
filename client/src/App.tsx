import { useState, useCallback, useEffect } from "react";
import type { GameState } from "./game";
import { GameBoard } from "./components/GameBoard";
import { About } from "./components/About";
import { GameHarness } from "./harness";
import * as chain from "./chain";
import { accountFromInjected, h160ToHex } from "./accounts";
import {
  listExtensions,
  connectExtension,
  listAccounts,
  type InjectedExtension,
  type InjectedPolkadotAccount,
} from "./wallet";

type Tab = "about" | "play";

const DEFAULT_CONTRACT = "0xc2744918942c7b12e3090103239372b8aeeb594d";
const DEFAULT_WS = "wss://sys.ibp.network/asset-hub-paseo";

export function App() {
  const [tab, setTab] = useState<Tab>("about");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [harness, setHarness] = useState<GameHarness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Wallet state
  const [extensions, setExtensions] = useState<string[]>([]);
  const [extension, setExtension] = useState<InjectedExtension | null>(null);
  const [accounts, setAccounts] = useState<InjectedPolkadotAccount[]>([]);
  const [p1Address, setP1Address] = useState<string>("");
  const [p2Address, setP2Address] = useState<string>("");

  // Setup form state
  const [contractAddr, setContractAddr] = useState(DEFAULT_CONTRACT);
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS);
  const [deckSize, setDeckSize] = useState(20);
  const [stepDelay, setStepDelay] = useState(500);

  useEffect(() => {
    // Detect injected extensions on mount. Some extensions inject late, so re-check briefly.
    const detect = () => setExtensions(listExtensions());
    detect();
    const t = setInterval(detect, 500);
    const stop = setTimeout(() => clearInterval(t), 4000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, []);

  const handleConnect = useCallback(async (name: string) => {
    setError(null);
    setLoading(true);
    try {
      const ext = await connectExtension(name);
      const accts = listAccounts(ext);
      if (accts.length === 0) {
        throw new Error(
          `${name} returned no accounts. Open the extension and grant this site access to at least two accounts.`,
        );
      }
      setExtension(ext);
      setAccounts(accts);
      setP1Address(accts[0].address);
      // Pick a *different* address for Player 2 if one exists; else leave empty
      // so the user notices they need to share another account.
      setP2Address(accts[1]?.address ?? "");
      ext.subscribe((next) => {
        setAccounts(next);
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!extension) throw new Error("Connect a wallet extension first.");
      if (!p1Address || !p2Address) throw new Error("Pick an account for each player.");
      if (p1Address === p2Address) {
        throw new Error("Player 1 and Player 2 must be different accounts.");
      }

      const a1 = accounts.find((a) => a.address === p1Address);
      const a2 = accounts.find((a) => a.address === p2Address);
      if (!a1 || !a2) throw new Error("Selected account no longer in extension.");

      const [p1, p2] = await Promise.all([
        accountFromInjected("Player 1", a1),
        accountFromInjected("Player 2", a2),
      ]);

      const conn = await chain.connect(contractAddr, wsUrl);

      // First-time accounts need to be mapped on pallet-revive (SS58 -> H160).
      // Storage query first; only submits a tx (one extension popup) if unmapped.
      await Promise.all([
        chain.ensureMapped(conn, p1.signer, p1.h160),
        chain.ensureMapped(conn, p2.signer, p2.h160),
      ]);

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
  }, [extension, accounts, p1Address, p2Address, contractAddr, wsUrl, deckSize, stepDelay]);

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
          <h2>Game Setup</h2>
          <p className="setup-hint">
            Connect a Polkadot wallet extension (Talisman, SubWallet, or polkadot-js)
            and pick two accounts. Each transaction is signed in your extension —
            the dapp never sees your seed phrase.
          </p>

          {!extension ? (
            <div className="wallet-connect">
              {extensions.length === 0 ? (
                <p className="setup-hint">
                  No wallet extension detected. Install{" "}
                  <a href="https://talisman.xyz/" target="_blank" rel="noreferrer">Talisman</a>,{" "}
                  <a href="https://subwallet.app/" target="_blank" rel="noreferrer">SubWallet</a>,
                  {" "}or the{" "}
                  <a href="https://polkadot.js.org/extension/" target="_blank" rel="noreferrer">polkadot-js extension</a>,
                  then reload.
                </p>
              ) : (
                <div className="wallet-list">
                  {extensions.map((name) => (
                    <button
                      key={name}
                      className="btn-start"
                      onClick={() => handleConnect(name)}
                      disabled={loading}
                    >
                      {loading ? "Connecting..." : `Connect ${name}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="setup-hint">
                Sharing {accounts.length} account{accounts.length === 1 ? "" : "s"}.
                {accounts.length < 2 && (
                  <>
                    {" "}
                    Open your extension → <strong>Connected sites</strong> → this URL,
                    and enable a second account, then refresh this page.
                  </>
                )}
              </p>
              <AccountPicker
                label="Player 1"
                accounts={accounts}
                value={p1Address}
                onChange={setP1Address}
              />
              <AccountPicker
                label="Player 2"
                accounts={accounts}
                value={p2Address}
                onChange={setP2Address}
              />
            </>
          )}

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
            disabled={loading || !extension}
          >
            {loading ? "Connecting..." : "Start Game"}
          </button>
        </div>
      )}
    </div>
  );
}

function AccountPicker({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string;
  accounts: InjectedPolkadotAccount[];
  value: string;
  onChange: (addr: string) => void;
}) {
  const selected = accounts.find((a) => a.address === value);
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          — select an account —
        </option>
        {accounts.map((a) => (
          <option key={a.address} value={a.address}>
            {a.name ? `${a.name} — ${shortAddr(a.address)}` : a.address}
          </option>
        ))}
      </select>
      {selected && <H160Hint address={selected.address} />}
    </label>
  );
}

function H160Hint({ address }: { address: string }) {
  const [h160, setH160] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSs58AddressInfo } = await import("polkadot-api");
        const info = getSs58AddressInfo(address);
        if (!info.isValid) return;
        const { keccak_256 } = await import("@noble/hashes/sha3");
        const hash = keccak_256(info.publicKey);
        if (!cancelled) setH160(h160ToHex(hash.slice(12, 32)));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);
  if (!h160) return null;
  return <span className="h160-hint">H160: {h160}</span>;
}

function shortAddr(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}
