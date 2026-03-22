import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import type { SavedTrack } from "./types";

const STORAGE_KEY = "velixa.saved-tracks.v1";
const LIBRARY_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}velixa-library/` : null;
const PERSIST_DEBOUNCE_MS = 120;
const MOBILE_PLAYABLE_EXTENSIONS = new Set([".m4a", ".mp3", ".aac", ".wav", ".mp4"]);
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSerializedTracks: string | null = null;
let pendingWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

function sortTracks(tracks: SavedTrack[]): SavedTrack[] {
  return [...tracks].sort((left, right) => {
    const leftOrder = typeof left.order === "number" ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.order === "number" ? right.order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return new Date(right.downloadedAt).getTime() - new Date(left.downloadedAt).getTime();
  });
}

function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || "track"
  );
}

function getFileExtension(filePath: string): string {
  const match = filePath.match(/\.[a-z0-9]+$/i);
  return match?.[0]?.toLowerCase() ?? ".m4a";
}

function isMobilePlayableFile(filePath: string): boolean {
  return MOBILE_PLAYABLE_EXTENSIONS.has(getFileExtension(filePath));
}

function getFileNameFromUri(localUri: string): string {
  const parts = localUri.split("/");
  return parts[parts.length - 1] ?? "track.m4a";
}

function resolveTrackId(input: Partial<SavedTrack>): string {
  if (typeof input.id === "string" && input.id.trim().length > 0) {
    return input.id.trim();
  }

  const videoId = typeof input.videoId === "string" && input.videoId.trim().length > 0 ? input.videoId : "legacy";
  const fileName =
    typeof input.fileName === "string" && input.fileName.trim().length > 0
      ? input.fileName
      : sanitizeSegment(input.title ?? "track");

  return `${videoId}:${fileName}`;
}

async function persistTracks(tracks: SavedTrack[]): Promise<SavedTrack[]> {
  const withOrder = tracks.map((track, index) => ({ ...track, id: resolveTrackId(track), order: index }));
  pendingSerializedTracks = JSON.stringify(withOrder);

  await new Promise<void>((resolve, reject) => {
    pendingWaiters.push({ resolve, reject });
    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
    persistTimeout = setTimeout(() => {
      const serialized = pendingSerializedTracks;
      const waiters = pendingWaiters;
      pendingSerializedTracks = null;
      pendingWaiters = [];
      persistTimeout = null;

      if (!serialized) {
        waiters.forEach((item) => item.resolve());
        return;
      }

      AsyncStorage.setItem(STORAGE_KEY, serialized)
        .then(() => {
          waiters.forEach((item) => item.resolve());
        })
        .catch((error) => {
          waiters.forEach((item) => item.reject(error));
        });
    }, PERSIST_DEBOUNCE_MS);
  });

  return sortTracks(withOrder);
}

async function ensureLibraryDir(): Promise<string> {
  if (!LIBRARY_DIR) {
    throw new Error("Device storage is unavailable on this build.");
  }

  const info = await FileSystem.getInfoAsync(LIBRARY_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });
  }

  return LIBRARY_DIR;
}

export async function loadSavedTracks(): Promise<SavedTrack[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SavedTrack>[];
    const hydrated: SavedTrack[] = [];
    let needsMigration = false;

    for (const track of parsed) {
      if (typeof track.localUri !== "string" || track.localUri.trim().length === 0) {
        needsMigration = true;
        continue;
      }

      const info = await FileSystem.getInfoAsync(track.localUri);
      if (info.exists) {
        const fileName =
          typeof track.fileName === "string" && track.fileName.trim().length > 0
            ? track.fileName
            : getFileNameFromUri(track.localUri);
        const resolvedVideoId =
          typeof track.videoId === "string" && track.videoId.trim().length > 0 ? track.videoId : "legacy";
        const resolvedTitle =
          typeof track.title === "string" && track.title.trim().length > 0 ? track.title : "Saved track";
        const resolvedId = resolveTrackId({ ...track, fileName, videoId: resolvedVideoId, title: resolvedTitle });
        if (resolvedId !== track.id) {
          needsMigration = true;
        }
        if (
          typeof track.fileName !== "string" ||
          track.fileName.trim().length === 0 ||
          typeof track.filePath !== "string" ||
          track.filePath.length === 0
        ) {
          needsMigration = true;
        }
        const resolvedFilePath =
          typeof track.filePath === "string" && track.filePath.length > 0 ? track.filePath : fileName;
        if (!isMobilePlayableFile(resolvedFilePath)) {
          needsMigration = true;
          continue;
        }
        hydrated.push({
          ...track,
          id: resolvedId,
          videoId: resolvedVideoId,
          title: resolvedTitle,
          artist: typeof track.artist === "string" && track.artist.trim().length > 0 ? track.artist : "Unknown artist",
          isFavorite: Boolean(track.isFavorite),
          fileName,
          filePath: resolvedFilePath,
          downloadedAt:
            typeof track.downloadedAt === "string" && track.downloadedAt.length > 0
              ? track.downloadedAt
              : new Date().toISOString(),
          order: typeof track.order === "number" ? track.order : hydrated.length,
        } as SavedTrack);
      } else {
        needsMigration = true;
      }
    }

    if (needsMigration || hydrated.length !== parsed.length) {
      await persistTracks(hydrated);
    }

    return sortTracks(hydrated);
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

type SaveTrackInput = {
  videoId: string;
  title: string;
  artist: string;
  duration?: string;
  thumbnailUrl?: string;
  filePath: string;
  remoteUrl: string;
};

async function buildSavedTrack(
  input: SaveTrackInput,
  currentTracks: SavedTrack[],
): Promise<{ savedTrack: SavedTrack; nextTracksWithoutDuplicate: SavedTrack[] }> {
  if (!isMobilePlayableFile(input.filePath)) {
    throw new Error("Downloaded format is not playable on this device. Re-download with mobile-safe audio.");
  }

  const existingTrack = currentTracks.find((track) => track.videoId === input.videoId);

  if (existingTrack) {
    const shouldReplaceFile = existingTrack.filePath !== input.filePath;
    if (shouldReplaceFile) {
      try {
        await FileSystem.deleteAsync(existingTrack.localUri);
      } catch {
        // Ignore cleanup failures so the refreshed track can still be saved.
      }
    } else {
      return {
        savedTrack: existingTrack,
        nextTracksWithoutDuplicate: currentTracks.filter((track) => track.id !== existingTrack.id),
      };
    }
  }

  const directory = await ensureLibraryDir();
  const extension = getFileExtension(input.filePath);
  const fileName = `${sanitizeSegment(input.title)}-${sanitizeSegment(input.videoId)}${extension}`;
  const localUri = `${directory}${fileName}`;

  await FileSystem.downloadAsync(input.remoteUrl, localUri);

  const savedTrack: SavedTrack = {
    id: `${input.videoId}:${fileName}`,
    videoId: input.videoId,
    title: input.title,
    artist: input.artist,
    isFavorite: existingTrack?.isFavorite ?? false,
    order: 0,
    duration: input.duration,
    thumbnailUrl: input.thumbnailUrl,
    filePath: input.filePath,
    localUri,
    fileName,
    downloadedAt: new Date().toISOString(),
  };

  return {
    savedTrack,
    nextTracksWithoutDuplicate: currentTracks.filter((track) => track.videoId !== savedTrack.videoId),
  };
}

export async function saveTrackToLibrary(input: SaveTrackInput): Promise<{ track: SavedTrack; tracks: SavedTrack[] }> {
  const currentTracks = await loadSavedTracks();
  const built = await buildSavedTrack(input, currentTracks);
  const nextTracks = await persistTracks([built.savedTrack, ...built.nextTracksWithoutDuplicate]);

  return { track: built.savedTrack, tracks: nextTracks };
}

export async function saveTracksToLibraryBatch(
  inputs: SaveTrackInput[],
): Promise<{ tracks: SavedTrack[]; importedVideoIds: string[]; failedVideoIds: string[] }> {
  if (inputs.length === 0) {
    return { tracks: await loadSavedTracks(), importedVideoIds: [], failedVideoIds: [] };
  }

  let workingTracks = await loadSavedTracks();
  const importedVideoIds: string[] = [];
  const failedVideoIds: string[] = [];

  for (const input of inputs) {
    try {
      const built = await buildSavedTrack(input, workingTracks);
      workingTracks = [built.savedTrack, ...built.nextTracksWithoutDuplicate];
      if (!importedVideoIds.includes(input.videoId)) {
        importedVideoIds.push(input.videoId);
      }
    } catch {
      if (!failedVideoIds.includes(input.videoId)) {
        failedVideoIds.push(input.videoId);
      }
    }
  }

  const persisted = await persistTracks(workingTracks);

  return { tracks: persisted, importedVideoIds, failedVideoIds };
}

export async function toggleFavoriteTrack(trackId: string): Promise<SavedTrack[]> {
  const currentTracks = await loadSavedTracks();
  const nextTracks = currentTracks.map((track) =>
    track.id === trackId ? { ...track, isFavorite: !track.isFavorite } : track,
  );
  return persistTracks(nextTracks);
}

export async function moveTrack(trackId: string, direction: "up" | "down"): Promise<SavedTrack[]> {
  const currentTracks = await loadSavedTracks();
  const index = currentTracks.findIndex((track) => track.id === trackId);
  if (index < 0) {
    return currentTracks;
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= currentTracks.length) {
    return currentTracks;
  }

  const nextTracks = [...currentTracks];
  const [picked] = nextTracks.splice(index, 1);
  if (!picked) {
    return currentTracks;
  }
  nextTracks.splice(targetIndex, 0, picked);
  return persistTracks(nextTracks);
}

export async function removeSavedTrack(trackId: string): Promise<SavedTrack[]> {
  const currentTracks = await loadSavedTracks();
  const target = currentTracks.find((track) => track.id === trackId);

  if (target) {
    try {
      await FileSystem.deleteAsync(target.localUri);
    } catch {
      // Ignore missing local files so library cleanup can still continue.
    }
  }

  return persistTracks(currentTracks.filter((track) => track.id !== trackId));
}
