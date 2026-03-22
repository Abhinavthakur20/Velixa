import { z } from "zod";
import type { DownloadRequest } from "@/types";

const allowedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

function isValidYouTubePlaylistUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return false;
    if (!allowedHosts.has(url.hostname.toLowerCase())) return false;
    const list = url.searchParams.get("list");
    return Boolean(list && /^[\w-]+$/.test(list));
  } catch {
    return false;
  }
}

const downloadRequestSchema = z.object({
  playlistUrl: z.string().refine(isValidYouTubePlaylistUrl, "Invalid YouTube playlist URL"),
  videoIds: z.array(z.string().min(1)).min(1),
});

export function validatePlaylistUrl(url: string): boolean {
  return isValidYouTubePlaylistUrl(url);
}

export function validateDownloadRequest(body: unknown): DownloadRequest {
  const parsed = downloadRequestSchema.safeParse(body);

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new Error(message || "Invalid download request");
  }

  return parsed.data;
}
