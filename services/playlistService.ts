import { fetchPlaylistMetadata } from "@/lib/ytDlp";
import { logger } from "@/lib/logger";
import { validatePlaylistUrl } from "@/utils/validators";
import type { PlaylistMetadata } from "@/types";

export class PlaylistValidationError extends Error {}
export class PlaylistFetchError extends Error {}

export async function getPlaylistMetadata(url: string): Promise<PlaylistMetadata> {
  if (!validatePlaylistUrl(url)) {
    throw new PlaylistValidationError("Invalid YouTube playlist URL");
  }

  try {
    const metadata = await fetchPlaylistMetadata(url);
    logger.info({ playlistId: metadata.id, videoCount: metadata.videoCount }, "Playlist fetched");
    return metadata;
  } catch (error) {
    logger.error({ error }, "Failed to fetch playlist metadata");
    if (error instanceof Error && /yt-dlp is not installed/i.test(error.message)) {
      throw new PlaylistFetchError("yt-dlp is not installed or not available in PATH");
    }
    throw new PlaylistFetchError("Unable to fetch playlist metadata");
  }
}
