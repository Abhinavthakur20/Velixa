import type { DownloadJob, VideoItem } from "@/types";
import { ProgressBar } from "@/components/ProgressBar";

interface SongItemProps {
  video: VideoItem;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onRetry: (id: string) => void;
  onPlay: (id: string) => void;
  job?: DownloadJob;
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

  return "Audio track";
}

export function SongItem({ video, isSelected, onToggle, onRetry, onPlay, job }: SongItemProps) {
  const artistLine = getArtistLine(video.title);
  const statusClass =
    job?.status === "completed"
      ? "border-[rgba(115,216,155,0.24)] bg-[rgba(115,216,155,0.14)] text-[var(--velixa-success)]"
      : job?.status === "failed"
        ? "border-[rgba(255,143,128,0.22)] bg-[rgba(255,143,128,0.12)] text-[var(--velixa-danger)]"
        : job?.status === "downloading"
          ? "border-[rgba(114,184,255,0.22)] bg-[rgba(114,184,255,0.12)] text-[var(--velixa-info)]"
          : "border-[var(--velixa-border)] bg-white/5 text-[var(--velixa-mist)]";

  return (
    <li className="velixa-card rounded-[1.35rem] p-3 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(video.id)}
          className="mt-1 h-4 w-4 accent-[var(--velixa-gold)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="line-clamp-1 text-sm font-semibold text-[var(--velixa-ivory)] sm:text-base">
                {video.title}
              </p>
              <p className="mt-1 line-clamp-1 text-xs text-[var(--velixa-mist)] sm:text-sm">
                {artistLine}
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-medium capitalize ${statusClass}`}>
              {job?.status ?? "pending"}
            </span>
          </div>
        </div>
      </div>

      {job ? (
        <div className="mt-3 border-t border-[var(--velixa-border)] pt-3">
          <ProgressBar progress={job.progress} status={job.status} />
          {job.error ? <p className="mt-3 text-xs leading-5 text-[var(--velixa-danger)]">{job.error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="velixa-button-ghost px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
              onClick={() => onPlay(video.id)}
            >
              Play
            </button>
            {job.status === "completed" && job.filePath ? (
              <a
                href={`/api/file?videoId=${encodeURIComponent(video.id)}`}
                className="velixa-button inline-block px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
              >
                Download File
              </a>
            ) : null}
            {job.status === "failed" ? (
              <button
                type="button"
                className="rounded-full border border-[rgba(255,143,128,0.22)] bg-[rgba(255,143,128,0.12)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--velixa-danger)] transition hover:bg-[rgba(255,143,128,0.18)]"
                onClick={() => onRetry(video.id)}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t border-[var(--velixa-border)] pt-3">
          <button
            type="button"
            className="velixa-button-ghost px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
            onClick={() => onPlay(video.id)}
          >
            Play
          </button>
        </div>
      )}
    </li>
  );
}
