"use client";

import { useRef } from "react";
import { useDownloadStore } from "@/store/useDownloadStore";
import { toast } from "@/components/ui/use-toast";
import type { DownloadJob } from "@/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DownloadButton() {
  const pollingRef = useRef(false);
  const {
    playlist,
    playlistUrl,
    currentJobId,
    selectedVideoIds,
    jobs,
    isLoading,
    setLoading,
    setJobs,
    setError,
    setLogs,
    setCurrentJobId,
  } = useDownloadStore();
  const completedJobs = jobs.filter((job) => job.status === "completed" && job.filePath);
  const batchFinished = jobs.length > 0 && jobs.every((job) => job.status === "completed" || job.status === "failed");

  const pollJobStatus = async (jobId: string) => {
    pollingRef.current = true;
    while (pollingRef.current) {
      const response = await fetch(`/api/download?jobId=${encodeURIComponent(jobId)}&includeLogs=true`);
      const payload = (await response.json()) as
        | { jobs: DownloadJob[]; logs: string[] }
        | DownloadJob[]
        | { error: string };

      if (!response.ok) {
        const message = !Array.isArray(payload) && "error" in payload ? payload.error : "Polling failed";
        throw new Error(message);
      }

      const jobs = Array.isArray(payload) ? payload : "jobs" in payload ? payload.jobs : [];
      setJobs(jobs);
      if (!Array.isArray(payload) && "logs" in payload) {
        setLogs(payload.logs);
      }

      const done = jobs.length > 0 && jobs.every((job) => job.status === "completed" || job.status === "failed");
      if (done) {
        const failed = jobs.filter((job) => job.status === "failed").length;
        if (failed > 0) {
          toast({
            title: "Downloads finished with failures",
            description: `${failed} file(s) failed to download`,
            variant: "destructive",
          });
        } else {
          toast({ title: "All downloads completed successfully." });
        }
        pollingRef.current = false;
        break;
      }

      await sleep(1500);
    }
  };

  const handleDownload = async () => {
    if (!playlistUrl || selectedVideoIds.length === 0) return;
    pollingRef.current = false;
    setError(null);
    setCurrentJobId(null);
    setJobs([]);
    setLogs([]);
    setLoading(true);

    try {
      const enqueue = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistUrl,
          videoIds: selectedVideoIds,
        }),
      });
      const payload = (await enqueue.json()) as { jobId?: string; error?: string };
      if (!enqueue.ok || !payload.jobId) {
        throw new Error(payload.error || "Failed to enqueue downloads");
      }

      setCurrentJobId(payload.jobId);
      await pollJobStatus(payload.jobId);
    } catch (error) {
      pollingRef.current = false;
      const message = error instanceof Error ? error.message : "Download request failed";
      setCurrentJobId(null);
      setJobs([]);
      setError(message);
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="velixa-button flex w-full items-center justify-between gap-3 rounded-full px-5 py-4 text-left disabled:opacity-50"
        disabled={selectedVideoIds.length === 0 || isLoading}
        onClick={handleDownload}
      >
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--velixa-gold-soft)]">
            Ready Queue
          </span>
          <span className="mt-1 block text-base font-semibold text-[var(--velixa-ivory)]">
            {isLoading ? "Preparing downloads..." : `Download Selected (${selectedVideoIds.length})`}
          </span>
        </span>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/88">
          {selectedVideoIds.length} tracks
        </span>
      </button>

      {currentJobId && batchFinished && completedJobs.length > 0 ? (
        <a
          href={`/api/archive?jobId=${encodeURIComponent(currentJobId)}&title=${encodeURIComponent(playlist?.title ?? "velixa-downloads")}`}
          className="velixa-button-ghost flex w-full items-center justify-between gap-3 rounded-full px-5 py-4 text-left shadow-[0_16px_34px_rgba(0,0,0,0.18)]"
        >
          <span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--velixa-gold-soft)]">
              Browser Delivery
            </span>
            <span className="mt-1 block text-base font-semibold text-[var(--velixa-ivory)]">
              Download Ready ZIP
            </span>
          </span>
          <span className="rounded-full border border-[var(--velixa-border)] bg-white/5 px-3 py-1 text-xs text-[var(--velixa-mist)]">
            {completedJobs.length} files
          </span>
        </a>
      ) : null}
    </div>
  );
}
