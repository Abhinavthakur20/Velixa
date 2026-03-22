import type { DownloadJob } from "@/types";

interface ProgressBarProps {
  progress: number;
  status: DownloadJob["status"];
}

export function ProgressBar({ progress, status }: ProgressBarProps) {
  const colorClass =
    status === "completed"
      ? "from-[var(--velixa-success)] to-[#49b070]"
      : status === "failed"
        ? "from-[var(--velixa-danger)] to-[#ff705f]"
        : "from-[var(--velixa-info)] to-[#3d8dff]";

  return (
    <div className="w-full">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all duration-300 ${colorClass}`}
          style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-[var(--velixa-mist)]">{progress}%</p>
    </div>
  );
}
