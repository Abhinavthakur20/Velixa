import type { DownloadJob, PlaylistMetadata } from "@/types";
import { SongItem } from "@/components/SongItem";

interface SongListProps {
  playlist: PlaylistMetadata;
  selectedVideoIds: string[];
  jobs: DownloadJob[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRetry: (id: string) => void;
  onPlay: (id: string) => void;
}

export function SongList({
  playlist,
  selectedVideoIds,
  jobs,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onRetry,
  onPlay,
}: SongListProps) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];

  return (
    <section className="velixa-panel rounded-[2rem] p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-4 border-b border-[var(--velixa-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--velixa-gold-soft)]">
            Track Library
          </p>
          <h2 className="velixa-display text-3xl font-semibold text-[var(--velixa-ivory)]">
            Select the songs you want to keep
          </h2>
          <p className="text-sm leading-6 text-[var(--velixa-mist)]">
            {playlist.videoCount} tracks in this playlist, {selectedVideoIds.length} currently selected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="velixa-pill text-xs">{safeJobs.filter((job) => job.status === "completed").length} ready</span>
          <span className="velixa-pill text-xs">{safeJobs.filter((job) => job.status === "downloading").length} active</span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="velixa-button-ghost px-4 py-2 text-sm"
          onClick={onSelectAll}
        >
          Select All
        </button>
        <button
          type="button"
          className="velixa-button-ghost px-4 py-2 text-sm"
          onClick={onDeselectAll}
        >
          Deselect All
        </button>
      </div>
      <ul className="space-y-2.5">
        {playlist.videos.map((video) => (
          <SongItem
            key={video.id}
            video={video}
            isSelected={selectedVideoIds.includes(video.id)}
            onToggle={onToggle}
            onRetry={onRetry}
            onPlay={onPlay}
            job={safeJobs.find((job) => job.videoId === video.id)}
          />
        ))}
      </ul>
    </section>
  );
}
