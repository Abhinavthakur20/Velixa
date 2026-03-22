"use client";

import type { VideoItem } from "@/types";

interface MusicPlayerProps {
  video: VideoItem | null;
}

function getArtistLine(title: string): string {
  const cleaned = title.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim();
  const pipeParts = cleaned
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  if (pipeParts.length > 1) {
    return pipeParts.slice(1, 3).join(" • ");
  }

  const dashParts = cleaned
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (dashParts.length > 1) {
    return dashParts[0];
  }

  return "Streaming preview";
}

export function MusicPlayer({ video }: MusicPlayerProps) {
  return (
    <section className="velixa-card overflow-hidden rounded-[1.8rem] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--velixa-gold-soft)]">
            Music Player
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--velixa-ivory)]">
            {video ? "Now playing" : "Pick a song to play"}
          </h2>
        </div>
        <span className="rounded-full border border-[var(--velixa-border)] bg-white/5 px-3 py-1 text-xs text-[var(--velixa-mist)]">
          No download
        </span>
      </div>

      {video ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[1.4rem] border border-[var(--velixa-border)] bg-black">
            <iframe
              title={`Now playing ${video.title}`}
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0&modestbranding=1`}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div>
            <p className="line-clamp-2 text-sm font-semibold text-[var(--velixa-ivory)]">{video.title}</p>
            <p className="mt-1 text-xs text-[var(--velixa-mist)]">{getArtistLine(video.title)}</p>
          </div>
        </div>
      ) : (
        <div className="rounded-[1.4rem] border border-dashed border-[var(--velixa-border)] bg-white/4 px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--velixa-ivory)]">Play any track without storing it</p>
          <p className="mt-2 text-xs leading-6 text-[var(--velixa-mist)]">
            Use the play button on a song card to stream it inside Velixa.
          </p>
        </div>
      )}
    </section>
  );
}
