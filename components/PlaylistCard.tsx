import Image from "next/image";
import type { PlaylistMetadata } from "@/types";

interface PlaylistCardProps {
  playlist: PlaylistMetadata;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  return (
    <article className="velixa-card overflow-hidden rounded-[2rem] p-4">
      <div className="relative mb-5 h-60 w-full overflow-hidden rounded-[1.45rem]">
        <Image
          src={playlist.thumbnailUrl || "/vercel.svg"}
          alt={playlist.title}
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(29,185,84,0.22),transparent_26%),linear-gradient(to_top,rgba(0,0,0,0.82),rgba(0,0,0,0.12),transparent)]" />
        <div className="absolute left-4 right-4 bottom-4 flex items-end justify-between gap-3">
          <span className="rounded-full border border-white/18 bg-black/28 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white">
            Curated Playlist
          </span>
          <span className="rounded-full bg-black/30 px-3 py-1 text-xs text-white/86">
            {playlist.videoCount} tracks
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <h2 className="velixa-display text-3xl leading-tight font-semibold text-[var(--velixa-ivory)]">
          {playlist.title}
        </h2>
        <p className="text-sm leading-6 text-[var(--velixa-mist)]">
          A ready-to-download collection with file delivery routed straight back into the browser.
        </p>
      </div>
    </article>
  );
}
