"use client";

import { useState } from "react";
import { useDownloadStore } from "@/store/useDownloadStore";
import { validatePlaylistUrl } from "@/utils/validators";
import type { PlaylistMetadata } from "@/types";

export function UrlInput() {
  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { setPlaylist, setLoading, isLoading, setError } = useDownloadStore();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setError(null);

    if (!validatePlaylistUrl(url)) {
      setLocalError("Please enter a valid YouTube playlist URL.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as PlaylistMetadata | { error: string };
      if (!response.ok || "error" in payload) {
        setError("error" in payload ? payload.error : "Failed to fetch playlist");
        return;
      }

      setPlaylist(payload, url);
    } catch {
      setError("Unable to fetch playlist.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="velixa-panel rounded-[2rem] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--velixa-gold-soft)]">
            Playlist Source
          </p>
          <h2 className="velixa-display text-3xl font-semibold text-[var(--velixa-ivory)]">
            Bring in a public YouTube playlist
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-[var(--velixa-mist)]">
          Paste a playlist URL and Velixa will prepare the tracks, queue downloads, and surface
          files directly in the browser.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/playlist?list=..."
          className="velixa-input h-14 w-full rounded-[1.2rem] px-5 text-sm"
          aria-label="YouTube playlist URL"
        />
        <button
          type="submit"
          className="velixa-button h-14 min-w-40 px-6 text-sm font-semibold tracking-[0.08em] uppercase"
          disabled={isLoading}
        >
          {isLoading ? "Collecting..." : "Fetch Playlist"}
        </button>
      </form>
      {localError ? <p className="mt-3 text-sm text-[var(--velixa-danger)]">{localError}</p> : null}
      {isLoading ? (
        <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-[var(--velixa-border)] bg-white/4 p-4">
          <div className="h-3 w-32 animate-pulse rounded-full bg-white/10" />
          <div className="mt-4 h-12 animate-pulse rounded-2xl bg-white/7" />
        </div>
      ) : null}
    </section>
  );
}
