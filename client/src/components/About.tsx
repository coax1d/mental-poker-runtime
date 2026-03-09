export function About() {
  return (
    <div className="about">
      <section className="about-section">
        <h2>The Game</h2>
        <p>
          Exploding Kittens is a card game where players take turns drawing from
          a shared deck. Most cards are safe, but hidden in the deck are
          <strong> Exploding Kitten</strong> cards. Draw one and you're out —
          unless you have a <strong>Defuse</strong> card to save yourself.
          Last player standing wins.
        </p>
        <div className="about-cards">
          <div className="about-card about-card-safe">
            <span className="about-card-icon">+</span>
            <span>Safe</span>
            <span className="about-card-desc">Nothing happens</span>
          </div>
          <div className="about-card about-card-defuse">
            <span className="about-card-icon">~</span>
            <span>Defuse</span>
            <span className="about-card-desc">Saves you once</span>
          </div>
          <div className="about-card about-card-ek">
            <span className="about-card-icon">*</span>
            <span>Exploding Kitten</span>
            <span className="about-card-desc">You're out</span>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>The Problem</h2>
        <p>
          Card games on a blockchain face a fundamental tension: blockchains are
          transparent by design, but card games require hidden information. If the
          deck is stored on-chain in plaintext, any player can read the contract
          state and know every card before it's drawn. The game is broken before
          it starts.
        </p>
        <p>
          Traditional solutions involve a trusted dealer server that holds the
          deck and reveals cards privately. But that reintroduces the centralized
          trust that blockchains were built to eliminate. If the dealer colludes
          with a player, or goes offline mid-game, fairness is lost.
        </p>
      </section>

      <section className="about-section">
        <h2>The Solution: Mental Poker</h2>
        <p>
          Mental poker is a cryptographic protocol that lets players deal, shuffle,
          and reveal cards without any trusted third party. It was first proposed
          in 1979 and has been refined over decades of research. This demo
          implements a modern variant using elliptic curve cryptography on the
          secp256k1 curve.
        </p>
        <p>Here's how each phase works:</p>
        <div className="about-phases">
          <div className="about-phase">
            <h3>Key Generation</h3>
            <p>
              Each player generates a secret key and publishes a corresponding
              public key along with a zero-knowledge proof that they know the
              secret. This proof prevents players from choosing malicious keys.
            </p>
          </div>
          <div className="about-phase">
            <h3>Masking</h3>
            <p>
              The deck starts as a set of known plaintext cards. These are
              "masked" (encrypted) using the combined public keys of all players.
              After masking, no single player can read any card — it takes
              cooperation from everyone to decrypt.
            </p>
          </div>
          <div className="about-phase">
            <h3>Shuffling</h3>
            <p>
              Each player takes the encrypted deck, re-randomizes every card, and
              shuffles the order. They attach a zero-knowledge proof that they
              shuffled correctly without tampering. After all players shuffle, the
              deck order is truly random and unknown to everyone.
            </p>
          </div>
          <div className="about-phase">
            <h3>Revealing</h3>
            <p>
              To reveal a card, every player submits a "reveal token" — a partial
              decryption using their secret key, plus a proof that it's correct.
              Only when all tokens are combined can the card be unmasked, ensuring
              no single player can peek early.
            </p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>Why This Matters</h2>
        <p>
          The blockchain acts as a public bulletin board: it enforces turn order,
          stores encrypted cards, and verifies every zero-knowledge proof
          on-chain. No trusted server, no hidden state on anyone's machine. The
          cryptography guarantees that:
        </p>
        <ul className="about-list">
          <li>No player can see cards before they're meant to be revealed</li>
          <li>No player can manipulate the shuffle or deck order</li>
          <li>Every action is publicly verifiable by anyone</li>
          <li>The game can proceed without trusting any single party</li>
        </ul>
        <p>
          This demo runs on a local Substrate node with a custom Mental Poker
          pallet. The cryptographic operations (key generation, shuffling proofs,
          reveal tokens) happen in the browser via WebAssembly, while the chain
          verifies proofs and stores the game state.
        </p>
      </section>
    </div>
  );
}
