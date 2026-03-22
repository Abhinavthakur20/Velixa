import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { env } from "@/lib/env";
import { sanitizePlaylistTitle } from "@/utils/sanitizer";
import type { DownloadOptions, PlaylistMetadata, VideoItem } from "@/types";

const PROGRESS_REGEX = /\[download\]\s+(\d+\.?\d*)%/;
const WINDOWS_YTDLP_CANDIDATES = [
  path.join(process.env.USERPROFILE ?? "", ".local", "bin", "yt-dlp.exe"),
  path.join(
    process.env.APPDATA ?? "",
    "Python",
    "Python313",
    "Scripts",
    "yt-dlp.exe",
  ),
];
const WINDOWS_FFMPEG_CANDIDATES = [
  path.join(process.env.USERPROFILE ?? "", ".local", "bin", "ffmpeg.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
  path.join(process.env.USERPROFILE ?? "", "scoop", "shims", "ffmpeg.exe"),
  path.join(process.env.ProgramFiles ?? "", "ffmpeg", "bin", "ffmpeg.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "ffmpeg", "bin", "ffmpeg.exe"),
  path.join(process.env.CHOCOLATEYINSTALL ?? "C:\\ProgramData\\chocolatey", "bin", "ffmpeg.exe"),
];

export class DownloadDependencyError extends Error {}
const MOBILE_SAFE_FALLBACK_FORMAT =
  "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio[ext=aac]/best[ext=mp4]/best";
const MOBILE_SAFE_AUDIO_FORMAT_WITH_FFMPEG =
  "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio[ext=aac]/bestaudio/best";
const MOBILE_SAFE_PREVIEW_FORMAT =
  "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio[ext=aac]/best[ext=mp4]/best";

function resolveCookiesPath(): string | null {
  const inlineCookies = env.YTDLP_COOKIES_CONTENT?.trim();
  if (inlineCookies) {
    const targetDir = path.resolve(process.cwd(), ".cache");
    const targetPath = path.join(targetDir, "yt-cookies.txt");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, inlineCookies, "utf8");
    return targetPath;
  }

  const candidate = env.YTDLP_COOKIES_PATH?.trim();
  if (!candidate) {
    return null;
  }
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) ? resolved : null;
}

function resolveYtDlpBinary(): string {
  const custom = process.env.YTDLP_PATH?.trim();
  if (custom && fs.existsSync(custom)) {
    return custom;
  }

  for (const candidate of WINDOWS_YTDLP_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "yt-dlp";
}

function resolveFfmpegBinary(): string | null {
  const custom = process.env.FFMPEG_PATH?.trim();
  if (custom && fs.existsSync(custom)) {
    return custom;
  }

  for (const candidate of WINDOWS_FFMPEG_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }

  return "ffmpeg";
}

function binaryExists(binary: string): boolean {
  if (fs.existsSync(binary)) {
    return true;
  }

  const result = spawnSync(binary, ["-version"], {
    stdio: "ignore",
    windowsHide: true,
  });

  return !result.error;
}

export function ensureDownloadDependencies(): void {
  if (!binaryExists(resolveYtDlpBinary())) {
    throw new DownloadDependencyError("yt-dlp is not installed or not available in PATH.");
  }
}

interface RawYtDlpEntry {
  id?: string;
  title?: string;
  duration_string?: string;
  duration?: number;
  thumbnail?: string;
}

interface RawYtDlpPlaylist {
  id?: string;
  title?: string;
  thumbnail?: string;
  entries?: RawYtDlpEntry[];
}

export function fetchPreviewAudioUrl(videoId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cookiesPath = resolveCookiesPath();
    const args = [
      "-f",
      MOBILE_SAFE_PREVIEW_FORMAT,
      "--get-url",
      `https://www.youtube.com/watch?v=${videoId}`,
      ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    ];
    const process = spawn(
      resolveYtDlpBinary(),
      args,
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdoutData = "";
    let stderrData = "";

    process.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    process.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    process.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed or not in PATH"));
        return;
      }
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderrData.trim() || "yt-dlp preview URL command failed"));
        return;
      }

      const previewUrl = stdoutData
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      if (!previewUrl) {
        reject(new Error("No preview audio URL returned by yt-dlp"));
        return;
      }

      resolve(previewUrl);
    });
  });
}

export function fetchPlaylistMetadata(url: string): Promise<PlaylistMetadata> {
  return new Promise((resolve, reject) => {
    const cookiesPath = resolveCookiesPath();
    const args = ["--flat-playlist", "-J", "--no-warnings", ...(cookiesPath ? ["--cookies", cookiesPath] : []), url];
    const process = spawn(resolveYtDlpBinary(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutData = "";
    let stderrData = "";

    process.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    process.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    process.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed or not in PATH"));
        return;
      }
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderrData.trim() || "yt-dlp metadata command failed"));
        return;
      }

      try {
        const raw = JSON.parse(stdoutData) as RawYtDlpPlaylist;
        const videos: VideoItem[] = (raw.entries ?? [])
          .filter((entry): entry is Required<Pick<RawYtDlpEntry, "id" | "title">> & RawYtDlpEntry => {
            return Boolean(entry.id && entry.title);
          })
          .map((entry) => ({
            id: entry.id!,
            title: entry.title!,
            duration: entry.duration_string ?? String(entry.duration ?? ""),
            thumbnailUrl: entry.thumbnail ?? "",
          }));

        resolve({
          id: raw.id ?? "",
          title: sanitizePlaylistTitle(raw.title ?? "YouTube Playlist"),
          thumbnailUrl: raw.thumbnail ?? "",
          videoCount: videos.length,
          videos,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function downloadVideos(opts: DownloadOptions): ChildProcess {
  const ffmpegBinary = resolveFfmpegBinary();
  const hasFfmpeg = Boolean(ffmpegBinary && binaryExists(ffmpegBinary));
  const cookiesPath = resolveCookiesPath();

  const outputTemplate = path.join(
    opts.downloadsDir,
    "%(playlist_title)s",
    "%(title)s [%(id)s].%(ext)s",
  );

  const args = hasFfmpeg
    ? [
        "-f",
        MOBILE_SAFE_AUDIO_FORMAT_WITH_FFMPEG,
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--ffmpeg-location",
        ffmpegBinary!,
        "--no-playlist-reverse",
        "--print",
        "after_move:%(filepath)s",
        "-o",
        outputTemplate,
        ...(cookiesPath ? ["--cookies", cookiesPath] : []),
        "--match-filter",
        `id~="${opts.videoIds.join("|")}"`,
        opts.url,
      ]
    : [
        "-f",
        MOBILE_SAFE_FALLBACK_FORMAT,
        "--no-playlist-reverse",
        "--print",
        "after_move:%(filepath)s",
        "-o",
        outputTemplate,
        ...(cookiesPath ? ["--cookies", cookiesPath] : []),
        "--match-filter",
        `id~="${opts.videoIds.join("|")}"`,
        opts.url,
      ];

  const process = spawn(resolveYtDlpBinary(), args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutReader = createInterface({ input: process.stdout });
  const stderrReader = createInterface({ input: process.stderr });

  const parseAndEmitProgress = (line: string) => {
    const match = line.match(PROGRESS_REGEX);
    if (!match?.[1]) {
      return;
    }
    process.emit("ytDlpProgress", Number.parseFloat(match[1]));
  };

  stdoutReader.on("line", parseAndEmitProgress);
  stderrReader.on("line", parseAndEmitProgress);

  process.on("close", () => {
    stdoutReader.close();
    stderrReader.close();
  });

  return process;
}
