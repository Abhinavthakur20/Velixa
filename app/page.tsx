"use client";

import { useCallback, useState } from "react";
import { DownloadButton } from "@/components/DownloadButton";
import { LogPanel } from "@/components/LogPanel";
import { MusicPlayer } from "@/components/MusicPlayer";
import { PlaylistCard } from "@/components/PlaylistCard";
import { SongList } from "@/components/SongList";
import { toast } from "@/components/ui/use-toast";
import { UrlInput } from "@/components/UrlInput";
import { useDownloadStore } from "@/store/useDownloadStore";
import type { DownloadJob } from "@/types";

export default function Home() {
  const [currentPlayingVideoId, setCurrentPlayingVideoId] = useState<string | null>(null);
  const {
    playlist,
    playlistUrl,
    selectedVideoIds,
    jobs,
    error,
    logs,
    toggleVideoSelection,
    selectAll,
    deselectAll,
    setJobs,
    setLogs,
    setError,
  } = useDownloadStore();

  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const activeCount = jobs.filter((job) => job.status === "downloading").length;
  const currentPlayingVideo =
    playlist?.videos.find((video) => video.id === currentPlayingVideoId) ?? null;

  const retrySingle = useCallback(
    async (videoId: string) => {
      if (!playlistUrl) return;
      try {
        const enqueue = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistUrl, videoIds: [videoId] }),
        });
        const payload = (await enqueue.json()) as { jobId?: string; error?: string };
        if (!enqueue.ok || !payload.jobId) {
          throw new Error(payload.error || "Retry failed");
        }

        let done = false;
        while (!done) {
          const response = await fetch(
            `/api/download?jobId=${encodeURIComponent(payload.jobId)}&includeLogs=true`,
          );
          const statusPayload = (await response.json()) as
            | { jobs: DownloadJob[]; logs: string[] }
            | { error: string };

          if (!response.ok || !("jobs" in statusPayload)) {
            throw new Error("error" in statusPayload ? statusPayload.error : "Retry polling failed");
          }

          const nextJobs = Array.isArray(statusPayload.jobs) ? statusPayload.jobs : [];
          setJobs(nextJobs);
          setLogs(Array.isArray(statusPayload.logs) ? statusPayload.logs : []);
          done = nextJobs.every(
            (job) => job.status === "completed" || job.status === "failed",
          );
          if (!done) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Retry failed";
        setError(message);
        toast({ title: "Retry failed", description: message, variant: "destructive" });
      }
    },
    [playlistUrl, setError, setJobs, setLogs],
  );

  return (
    <main className="velixa-shell mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <section className="velixa-hero velixa-glow velixa-animate-in rounded-[2.7rem] px-4 py-5 text-white sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="relative z-10 space-y-8">
          <div className="flex justify-center">
            <div className="velixa-island flex min-h-16 w-full max-w-2xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="velixa-island-dot" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/56">
                    Velixa
                  </p>
                  <p className="text-sm font-medium text-white/88">Dynamic audio queue</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs text-white/70">
                <span className="h-2 w-2 rounded-full bg-[var(--velixa-success)]" />
                Active flow
              </div>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:items-end lg:gap-10">
            <div className="velixa-hero-copy space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.24em] text-white/62">
                  <span className="h-2 w-2 rounded-full bg-[var(--velixa-success)]" />
                  Audio delivery, simplified
                </div>
                <h1 className="velixa-display max-w-3xl text-5xl leading-[0.94] font-semibold text-white sm:text-6xl lg:max-w-4xl lg:text-7xl">
                  Velixa. Queue it. Fetch it. Own it.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-white/62 sm:text-base">
                  Bring in a public playlist, choose only the tracks you want, stream instantly,
                  and export the finished set in one focused flow.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-white/78">
                  Capsule identity
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-white/78">
                  Queue-first workflow
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-white/78">
                  Browser ZIP export
                </span>
              </div>
            </div>

            <div className="velixa-hero-metrics space-y-4 rounded-[2rem] border border-white/6 bg-white/[0.025] p-3 sm:p-4 lg:p-5">
              <div className="hidden items-start justify-between gap-4 lg:flex">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/46">
                    Queue status
                  </p>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-white/54">
                    A quick view of what is selected, processing, completed, and blocked.
                  </p>
                </div>
                <div className="rounded-full border border-white/8 bg-black/30 px-3 py-2 text-xs text-white/54">
                  Live counters
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-2">
                <div className="velixa-hero-stat velixa-island rounded-[1.4rem] px-3 py-3 sm:rounded-[2rem] sm:px-4 sm:py-4">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/50 sm:text-[11px] sm:tracking-[0.24em]">
                    Selected
                  </p>
                  <p className="mt-2 text-center text-2xl font-semibold text-white sm:mt-3 sm:text-4xl">
                    {selectedVideoIds.length}
                  </p>
                </div>
                <div className="velixa-hero-stat velixa-island rounded-[1.4rem] px-3 py-3 sm:rounded-[2rem] sm:px-4 sm:py-4">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/50 sm:text-[11px] sm:tracking-[0.24em]">
                    Ready
                  </p>
                  <p className="mt-2 text-center text-2xl font-semibold text-[var(--velixa-success)] sm:mt-3 sm:text-4xl">
                    {completedCount}
                  </p>
                </div>
                <div className="velixa-hero-stat velixa-hero-stat-active velixa-island rounded-[1.4rem] px-3 py-3 sm:rounded-[2rem] sm:px-4 sm:py-4">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/50 sm:text-[11px] sm:tracking-[0.24em]">
                    Active
                  </p>
                  <p className="mt-2 text-center text-2xl font-semibold text-[var(--velixa-success)] sm:mt-3 sm:text-4xl sm:text-[var(--velixa-info)]">
                    {activeCount}
                  </p>
                </div>
                <div className="velixa-hero-stat velixa-island rounded-[1.4rem] px-3 py-3 sm:rounded-[2rem] sm:px-4 sm:py-4">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/50 sm:text-[11px] sm:tracking-[0.24em]">
                    Failed
                  </p>
                  <p className="mt-2 text-center text-2xl font-semibold text-[var(--velixa-danger)] sm:mt-3 sm:text-4xl">
                    {failedCount}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="velixa-animate-in" style={{ animationDelay: "180ms" }}>
        <UrlInput />
      </div>

      {error ? (
        <p className="velixa-animate-in rounded-[1.35rem] border border-[rgba(241,94,108,0.22)] bg-[rgba(100,22,30,0.42)] px-4 py-3 text-sm text-[var(--velixa-danger)] shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
          {error}
        </p>
      ) : null}

      {playlist ? (
        <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:gap-8">
          <div className="velixa-animate-in space-y-4 lg:sticky lg:top-6 lg:self-start" style={{ animationDelay: "220ms" }}>
            <MusicPlayer video={currentPlayingVideo} />
            <PlaylistCard playlist={playlist} />
            <DownloadButton />
            <LogPanel lines={logs} />
          </div>
          <div className="velixa-animate-in" style={{ animationDelay: "280ms" }}>
            <SongList
              playlist={playlist}
              selectedVideoIds={selectedVideoIds}
              jobs={jobs}
              onToggle={toggleVideoSelection}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onRetry={retrySingle}
              onPlay={setCurrentPlayingVideoId}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
