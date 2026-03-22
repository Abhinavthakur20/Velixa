import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import PQueue from "p-queue";
import { nanoid } from "nanoid";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { downloadVideos } from "@/lib/ytDlp";
import type { DownloadJob, DownloadRequest } from "@/types";

const queue = new PQueue({ concurrency: env.MAX_CONCURRENT_DOWNLOADS });
const jobsById = new Map<string, DownloadJob[]>();
const logsByJobId = new Map<string, string[]>();

const downloadsDir = path.resolve(process.cwd(), env.DOWNLOADS_DIR);
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

const DOWNLOADABLE_EXTENSIONS = new Set([".m4a", ".webm", ".mp3", ".opus", ".ogg", ".wav", ".aac"]);

function sanitizeErrorMessage(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s"]+|\/[^\s"]+/g, "[path]");
}

function pushLog(jobId: string, line: string): void {
  const current = logsByJobId.get(jobId) ?? [];
  current.push(line);
  if (current.length > 50) {
    current.splice(0, current.length - 50);
  }
  logsByJobId.set(jobId, current);
}

function deriveFailureMessage(jobId: string): string {
  const lines = logsByJobId.get(jobId) ?? [];
  const recent = lines.slice(-20).join("\n").toLowerCase();

  if (recent.includes("sign in to confirm your age")) {
    return "YouTube blocked this item (age-restricted/auth-required).";
  }

  if (recent.includes("private video")) {
    return "This video is private and cannot be downloaded.";
  }

  if (recent.includes("video unavailable")) {
    return "This video is unavailable.";
  }

  if (
    recent.includes("too many requests") ||
    recent.includes("sign in to confirm you're not a bot") ||
    recent.includes("use --cookies-from-browser or --cookies")
  ) {
    return "YouTube blocked the server IP (429/anti-bot). Add YTDLP_COOKIES_PATH cookies or use non-datacenter hosting.";
  }

  return "Audio download failed. You can retry this video.";
}

function updateJob(jobId: string, videoId: string, update: Partial<DownloadJob>) {
  const items = jobsById.get(jobId);
  if (!items) return;
  jobsById.set(
    jobId,
    items.map((item) => (item.videoId === videoId ? { ...item, ...update } : item)),
  );
}

function isDownloadableFile(filePath: string): boolean {
  return DOWNLOADABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toRelativeDownloadPath(filePath: string): string | null {
  const normalized = path.resolve(filePath);
  if (!normalized.startsWith(`${downloadsDir}${path.sep}`)) {
    return null;
  }

  return path.relative(downloadsDir, normalized);
}

function findDownloadedFile(videoId: string): string | undefined {
  const stack = [downloadsDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(`[${videoId}]`) && isDownloadableFile(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

export function queueDownloads(request: DownloadRequest): string {
  const jobId = nanoid();

  const jobs: DownloadJob[] = request.videoIds.map((videoId) => ({
    videoId,
    title: videoId,
    status: "pending",
    progress: 0,
  }));

  jobsById.set(jobId, jobs);
  logsByJobId.set(jobId, []);

  for (const videoId of request.videoIds) {
    queue.add(async () => {
      updateJob(jobId, videoId, { status: "downloading", progress: 0 });

      await new Promise<void>((resolve) => {
        const child = downloadVideos({
          url: request.playlistUrl,
          videoIds: [videoId],
          downloadsDir,
        });
        if (!child.stdout || !child.stderr) {
          updateJob(jobId, videoId, {
            status: "failed",
            error: "Download process streams were unavailable.",
          });
          resolve();
          return;
        }

        const stdoutReader = createInterface({ input: child.stdout });
        const stderrReader = createInterface({ input: child.stderr });

        const onLine = (line: string) => {
          pushLog(jobId, line);

          const trimmed = line.trim();
          if (!trimmed || !path.isAbsolute(trimmed) || !fs.existsSync(trimmed)) {
            return;
          }

          if (!isDownloadableFile(trimmed)) {
            return;
          }

          const relativePath = toRelativeDownloadPath(trimmed);
          if (relativePath) {
            updateJob(jobId, videoId, { filePath: relativePath });
          }
        };

        stdoutReader.on("line", onLine);
        stderrReader.on("line", onLine);

        child.on("ytDlpProgress", (value: number) => {
          updateJob(jobId, videoId, { progress: Math.min(100, Math.floor(value)) });
        });

        child.on("close", (code) => {
          stdoutReader.close();
          stderrReader.close();
          if (code === 0) {
            const filePath = findDownloadedFile(videoId);
            const relativePath = filePath ? toRelativeDownloadPath(filePath) : undefined;
            updateJob(jobId, videoId, {
              status: "completed",
              progress: 100,
              filePath: relativePath ?? undefined,
            });
            logger.info({ jobId, videoId }, "Download completed");
          } else {
            updateJob(jobId, videoId, {
              status: "failed",
              error: deriveFailureMessage(jobId),
            });
            logger.error({ jobId, videoId, code }, "Download failed");
          }
          resolve();
        });

        child.on("error", (error) => {
          updateJob(jobId, videoId, {
            status: "failed",
            error: sanitizeErrorMessage(error.message),
          });
          logger.error({ jobId, videoId, error }, "Download process error");
          resolve();
        });
      });
    });
  }

  return jobId;
}

export function getJobStatus(jobId: string): DownloadJob[] {
  return jobsById.get(jobId) ?? [];
}

export function getJobDownloadFiles(jobId: string): Array<{ videoId: string; filePath: string }> {
  const jobs = jobsById.get(jobId) ?? [];

  return jobs.flatMap((job) => {
    if (job.status !== "completed" || !job.filePath) {
      return [];
    }

    const absolutePath = path.resolve(downloadsDir, job.filePath);
    if (!absolutePath.startsWith(`${downloadsDir}${path.sep}`) || !fs.existsSync(absolutePath)) {
      return [];
    }

    return [{ videoId: job.videoId, filePath: absolutePath }];
  });
}

export function retryFailedVideo(jobId: string, request: DownloadRequest, videoId: string): boolean {
  const jobs = jobsById.get(jobId);
  if (!jobs) return false;

  const target = jobs.find((job) => job.videoId === videoId);
  if (!target || target.status !== "failed") return false;

  updateJob(jobId, videoId, { status: "pending", progress: 0, error: undefined });
  queueDownloads({ ...request, videoIds: [videoId] });
  return true;
}

export function getJobLogs(jobId: string): string[] {
  return logsByJobId.get(jobId) ?? [];
}
