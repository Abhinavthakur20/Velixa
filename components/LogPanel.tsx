"use client";

import { useEffect, useRef, useState } from "react";

interface LogPanelProps {
  lines: string[];
}

export function LogPanel({ lines }: LogPanelProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <section className="velixa-card overflow-hidden rounded-[1.6rem]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-4 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--velixa-gold-soft)]">
            Activity
          </span>
          <span className="mt-1 block text-sm font-semibold text-[var(--velixa-ivory)]">
            {open ? "Hide Logs" : "Show Logs"}
          </span>
        </span>
        <span className="rounded-full border border-[var(--velixa-border)] bg-white/5 px-3 py-1 text-xs text-[var(--velixa-mist)]">
          {lines.length} lines
        </span>
      </button>
      {open ? (
        <div
          ref={containerRef}
          className="max-h-72 overflow-y-auto border-t border-[var(--velixa-border)] bg-black/22 p-4 text-xs leading-6 text-[var(--velixa-mist)]"
        >
          {lines.length === 0 ? <p>No logs yet.</p> : lines.map((line, idx) => <p key={`${line}-${idx}`}>{line}</p>)}
        </div>
      ) : null}
    </section>
  );
}
