import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { applyRateLimit } from "@/lib/rateLimit";
import { DownloadDependencyError, downloadVideos, ensureDownloadDependencies } from "@/lib/ytDlp";

const schema = z.object({
  videoId: z.string().min(1),
});

const downloadsDir = path.resolve(process.cwd(), env.DOWNLOADS_DIR);
const DOWNLOADABLE_EXTENSIONS = new Set([".m4a", ".mp3", ".aac", ".wav", ".mp4"]);

function sanitizeErrorMessage(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s"]+|\/[^\s"]+/g, "[path]");
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
  let bestMatch: { filePath: string; mtimeMs: number } | null = null;
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
        const stats = fs.statSync(fullPath);
        if (!bestMatch || stats.mtimeMs > bestMatch.mtimeMs) {
          bestMatch = { filePath: fullPath, mtimeMs: stats.mtimeMs };
        }
      }
    }
  }
  return bestMatch?.filePath;
}

function removeExistingDownloads(videoId: string): void {
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
      if (entry.isFile() && entry.name.includes(`[${videoId}]`)) {
        try {
          fs.unlinkSync(fullPath);
        } catch {
          // Best-effort cleanup before fresh repair download.
        }
      }
    }
  }
}

export async function POST(request: NextRequest) {
  if (!applyRateLimit(request, "repair-audio")) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    ensureDownloadDependencies();
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { videoId } = parsed.data;
    const directVideoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    removeExistingDownloads(videoId);

    await new Promise<void>((resolve, reject) => {
      const child = downloadVideos({
        url: directVideoUrl,
        videoIds: [videoId],
        downloadsDir,
      });

      if (!child.stdout || !child.stderr) {
        reject(new Error("Download process streams were unavailable."));
        return;
      }

      const stdoutReader = createInterface({ input: child.stdout });
      const stderrReader = createInterface({ input: child.stderr });

      child.on("close", (code) => {
        stdoutReader.close();
        stderrReader.close();
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error("Audio repair download failed."));
      });

      child.on("error", (error) => {
        stdoutReader.close();
        stderrReader.close();
        reject(error);
      });
    });

    const downloaded = findDownloadedFile(videoId);
    const relativePath = downloaded ? toRelativeDownloadPath(downloaded) : null;
    if (!relativePath) {
      return NextResponse.json({ error: "Repaired file could not be located." }, { status: 404 });
    }

    return NextResponse.json({ filePath: relativePath });
  } catch (error) {
    if (error instanceof DownloadDependencyError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: sanitizeErrorMessage(error instanceof Error ? error.message : "Unable to repair audio") },
      { status: 502 },
    );
  }
}

