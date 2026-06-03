import { useEffect, useRef } from "react";
import type { LogEntry } from "../game";

interface Props {
  entries: LogEntry[];
}

const PHASE_COLORS: Record<string, string> = {
  setup: "#888",
  registering: "#6a9",
  masking: "#69a",
  shuffling: "#a69",
  dealing: "#9a6",
  playing: "#aa6",
  finished: "#e84",
  info: "#aaa",
};

export function GameLog({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="game-log">
      <h3>Game Log</h3>
      <div className="log-entries">
        {entries.map((entry, i) => (
          <div key={i} className="log-entry">
            <span
              className="log-phase"
              style={{ color: PHASE_COLORS[entry.phase] ?? "#aaa" }}
            >
              [{entry.phase}]
            </span>{" "}
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
