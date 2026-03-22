import { StatusBar } from "expo-status-bar";
import Slider from "@react-native-community/slider";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { loadSavedTracks, moveTrack, removeSavedTrack, saveTracksToLibraryBatch, toggleFavoriteTrack } from "./src/library";
import { styles } from "./src/styles";
import type { DownloadJob, PlaylistMetadata, SavedTrack, VideoItem } from "./src/types";
import { getArtistLine, validatePlaylistUrl } from "./src/utils";

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("timed out") ||
    message.includes("aborted")
  );
}

function getTimeoutBudget(path: string): { baseMs: number; stepMs: number; maxAttempts: number } {
  if (path.startsWith("/api/playlist")) {
    return { baseMs: 28_000, stepMs: 8_000, maxAttempts: 2 };
  }
  if (path.startsWith("/api/download?")) {
    return { baseMs: 20_000, stepMs: 5_000, maxAttempts: 3 };
  }
  if (path.startsWith("/api/download")) {
    return { baseMs: 30_000, stepMs: 8_000, maxAttempts: 2 };
  }
  if (path.startsWith("/api/preview")) {
    return { baseMs: 22_000, stepMs: 6_000, maxAttempts: 2 };
  }
  if (path.startsWith("/api/repair-audio")) {
    return { baseMs: 35_000, stepMs: 10_000, maxAttempts: 2 };
  }
  return { baseMs: 16_000, stepMs: 5_000, maxAttempts: 3 };
}

async function withTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatSavedDate(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Saved in app";
  }

  return `Saved ${new Date(value).toLocaleDateString()}`;
}

function getTrackArtworkUrl(
  videoId: string,
  thumbnailUrl?: string | null,
  quality: "list" | "player" = "list",
): string | null {
  if (!videoId) {
    return thumbnailUrl ?? null;
  }

  const variant = quality === "player" ? "hqdefault" : "mqdefault";
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${variant}.jpg`;
}

function toCachedImageSource(uri: string) {
  return { uri, cache: "force-cache" as const };
}

type AppSection = "home" | "search" | "library" | "queue";
type PlaybackAssistPhase = "idle" | "repairing" | "streaming" | "failed" | "done";

type MetricCardProps = {
  label: string;
  value: number;
  valueStyle?: object;
  active?: boolean;
};

function MetricCard({ label, value, valueStyle, active = false }: MetricCardProps) {
  return (
    <View style={[styles.metricCard, active && styles.metricCardActive]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueStyle]}>{value}</Text>
    </View>
  );
}

type SongRowProps = {
  video: VideoItem;
  isSelected: boolean;
  job?: DownloadJob;
  savedTrack?: SavedTrack | null;
  isSaving: boolean;
  isSavedPlaying: boolean;
  onToggle: (id: string) => void;
  onPreview: (id: string) => void;
  onRetry: (id: string) => void;
  onSaveToLibrary: (id: string) => void;
  onPlaySavedTrack: (trackId: string) => void;
};

const SongRow = memo(function SongRow({
  video,
  isSelected,
  job,
  savedTrack,
  isSaving,
  isSavedPlaying,
  onToggle,
  onPreview,
  onRetry,
  onSaveToLibrary,
  onPlaySavedTrack,
}: SongRowProps) {
  const status = job?.status ?? "pending";
  const artworkUrl = getTrackArtworkUrl(video.id, video.thumbnailUrl, "list");
  const statusStyles =
    status === "completed"
      ? styles.statusCompleted
      : status === "failed"
        ? styles.statusFailed
        : status === "downloading"
          ? styles.statusDownloading
          : styles.statusPending;

  return (
    <View style={styles.songCard}>
      <View style={styles.songTopRow}>
        <Pressable style={styles.checkboxWrap} onPress={() => onToggle(video.id)}>
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected ? <View style={styles.checkboxDot} /> : null}
          </View>
        </Pressable>

        {artworkUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image source={toCachedImageSource(artworkUrl)} style={styles.songArtwork} resizeMode="cover" />
        ) : (
          <View style={styles.songArtworkFallback}>
            <Text style={styles.songArtworkFallbackText}>V</Text>
          </View>
        )}

        <View style={styles.songCopy}>
          <Text numberOfLines={1} style={styles.songTitle}>
            {video.title}
          </Text>
          <Text numberOfLines={1} style={styles.songMeta}>
            {getArtistLine(video.title)}
          </Text>
        </View>

        <View style={[styles.statusPill, statusStyles]}>
          <Text style={[styles.statusText, status === "completed" && styles.statusTextGreen]}>
            {status}
          </Text>
        </View>
      </View>

      {job ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(6, job.progress)}%` }]} />
          </View>
          {job.error ? <Text style={styles.songError}>{job.error}</Text> : null}
        </View>
      ) : null}

      <View style={styles.songActions}>
        <Pressable style={styles.ghostButton} onPress={() => onPreview(video.id)}>
          <Text style={styles.ghostButtonText}>Preview</Text>
        </Pressable>

        {job?.status === "completed" && savedTrack ? (
          <Pressable style={styles.ghostButton} onPress={() => onPlaySavedTrack(savedTrack.id)}>
            <Text style={styles.ghostButtonText}>{isSavedPlaying ? "Pause saved" : "Play saved"}</Text>
          </Pressable>
        ) : null}

        {job?.status === "completed" && !savedTrack ? (
          <Pressable
            style={[styles.ghostButton, isSaving && styles.disabledButton]}
            onPress={() => onSaveToLibrary(video.id)}
            disabled={isSaving}
          >
            <Text style={styles.ghostButtonText}>{isSaving ? "Saving..." : "Save in app"}</Text>
          </Pressable>
        ) : null}

        {job?.status === "failed" ? (
          <Pressable style={styles.retryButton} onPress={() => onRetry(video.id)}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

type SavedTrackRowProps = {
  track: SavedTrack;
  isActive: boolean;
  isPlaying: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPlay: (trackId: string) => void;
  onRemove: (trackId: string) => void;
  onToggleFavorite: (trackId: string) => void;
  onMove: (trackId: string, direction: "up" | "down") => void;
};

const SavedTrackRow = memo(function SavedTrackRow({
  track,
  isActive,
  isPlaying,
  canMoveUp,
  canMoveDown,
  onPlay,
  onRemove,
  onToggleFavorite,
  onMove,
}: SavedTrackRowProps) {
  const artworkUrl = getTrackArtworkUrl(track.videoId, track.thumbnailUrl, "list");

  return (
    <View style={[styles.savedTrackCard, isActive && styles.savedTrackCardActive]}>
      <View style={styles.savedTrackTopRow}>
        {artworkUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image source={toCachedImageSource(artworkUrl)} style={styles.savedTrackImage} resizeMode="cover" />
        ) : (
          <View style={styles.savedTrackPlaceholder}>
            <Text style={styles.savedTrackPlaceholderText}>AUDIO</Text>
          </View>
        )}

        <View style={styles.savedTrackCopy}>
          <Text numberOfLines={2} style={styles.savedTrackTitle}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.savedTrackMeta}>
            {track.artist}
          </Text>
          <Text numberOfLines={1} style={styles.savedTrackHint}>
            {track.duration ?? "Downloaded audio"} - {formatSavedDate(track.downloadedAt)}
          </Text>
        </View>
      </View>

      <View style={styles.songActions}>
        <Pressable style={styles.ghostButton} onPress={() => onPlay(track.id)}>
          <Text style={styles.ghostButtonText}>{isActive && isPlaying ? "Pause" : "Play"}</Text>
        </Pressable>
        <Pressable style={styles.ghostButton} onPress={() => onToggleFavorite(track.id)}>
          <Text style={styles.ghostButtonText}>{track.isFavorite ? "Unfavorite" : "Favorite"}</Text>
        </Pressable>
        <Pressable
          style={[styles.ghostButton, !canMoveUp && styles.disabledButton]}
          onPress={() => onMove(track.id, "up")}
          disabled={!canMoveUp}
        >
          <Text style={styles.ghostButtonText}>↑ Up</Text>
        </Pressable>
        <Pressable
          style={[styles.ghostButton, !canMoveDown && styles.disabledButton]}
          onPress={() => onMove(track.id, "down")}
          disabled={!canMoveDown}
        >
          <Text style={styles.ghostButtonText}>↓ Down</Text>
        </Pressable>
        <Pressable style={styles.retryButton} onPress={() => onRemove(track.id)}>
          <Text style={styles.retryButtonText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
});

type LibraryTrackRowProps = {
  track: SavedTrack;
  isActive: boolean;
  isPlaying: boolean;
  onPress: (trackId: string) => void;
  onOpenMenu: (trackId: string) => void;
};

const LibraryTrackRow = memo(function LibraryTrackRow({
  track,
  isActive,
  isPlaying,
  onPress,
  onOpenMenu,
}: LibraryTrackRowProps) {
  const artworkUrl = getTrackArtworkUrl(track.videoId, track.thumbnailUrl, "list");

  return (
    <Pressable style={[styles.libraryListRow, isActive && styles.libraryListRowActive]} onPress={() => onPress(track.id)}>
      {artworkUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image source={toCachedImageSource(artworkUrl)} style={styles.libraryListArtwork} resizeMode="cover" />
      ) : (
        <View style={styles.libraryListArtworkFallback}>
          <Text style={styles.libraryListArtworkFallbackText}>♪</Text>
        </View>
      )}
      <View style={styles.libraryListCopy}>
        <Text numberOfLines={1} style={styles.libraryListTitle}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.libraryListMeta}>
          {track.artist}
        </Text>
      </View>
      <View style={styles.libraryListRight}>
        {isActive && isPlaying ? <Text style={styles.libraryListPlaying}>Playing</Text> : null}
        <Pressable style={styles.libraryRowMenuButton} onPress={() => onOpenMenu(track.id)}>
          <Text style={styles.libraryRowMenuText}>⋮</Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

type ShelfTrackProps = {
  title: string;
  subtitle: string;
  artworkUrl?: string;
  accent?: "green" | "blue";
  onPress: () => void;
};

function ShelfTrack({ title, subtitle, artworkUrl, accent = "green", onPress }: ShelfTrackProps) {
  return (
    <Pressable
      style={[styles.shelfCard, accent === "blue" && styles.shelfCardBlue]}
      onPress={onPress}
    >
      {artworkUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image source={toCachedImageSource(artworkUrl)} style={styles.shelfArtwork} />
      ) : (
        <View style={[styles.shelfFallback, accent === "blue" && styles.shelfFallbackBlue]}>
          <Text style={styles.shelfFallbackText}>VELIXA</Text>
        </View>
      )}
      <Text numberOfLines={2} style={styles.shelfTitle}>
        {title}
      </Text>
      <Text numberOfLines={2} style={styles.shelfSubtitle}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

type MediaShortcutTileProps = {
  title: string;
  subtitle: string;
  artworkUrl?: string | null;
  onPress: () => void;
};

function MediaShortcutTile({ title, subtitle, artworkUrl, onPress }: MediaShortcutTileProps) {
  return (
    <Pressable style={styles.mediaShortcutTile} onPress={onPress}>
      {artworkUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image source={toCachedImageSource(artworkUrl)} style={styles.mediaShortcutArtwork} resizeMode="cover" />
      ) : (
        <View style={styles.mediaShortcutFallback}>
          <Text style={styles.mediaShortcutFallbackText}>V</Text>
        </View>
      )}
      <View style={styles.mediaShortcutCopy}>
        <Text numberOfLines={1} style={styles.mediaShortcutTitle}>
          {title}
        </Text>
        <Text numberOfLines={2} style={styles.mediaShortcutSubtitle}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

type BrowseTileProps = {
  title: string;
  toneStyle: object;
  onPress?: () => void;
};

function BrowseTile({ title, toneStyle, onPress }: BrowseTileProps) {
  return (
    <Pressable style={[styles.browseTile, toneStyle]} onPress={onPress}>
      <Text numberOfLines={2} style={styles.browseTileText}>
        {title}
      </Text>
      <View style={styles.browseTileAccent} />
    </Pressable>
  );
}

export default function App() {
  const pollingRef = useRef(false);
  const savedTracksRef = useRef<SavedTrack[]>([]);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTokenRef = useRef(0);
  const playbackStallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRepairingVideoIdRef = useRef<string | null>(null);
  const autoRepairAttemptedVideoIdsRef = useRef<Set<string>>(new Set());
  const autoStreamAttemptedVideoIdsRef = useRef<Set<string>>(new Set());
  const lastPlaylistRef = useRef<PlaylistMetadata | null>(null);
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
  const playerStatus = useAudioPlayerStatus(player);
  const [inputUrl, setInputUrl] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlist, setPlaylist] = useState<PlaylistMetadata | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
  const [importingVideoIds, setImportingVideoIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydratingLibrary, setIsHydratingLibrary] = useState(true);
  const [activeSection, setActiveSection] = useState<AppSection>("home");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [librarySort, setLibrarySort] = useState<"recent" | "title" | "artist" | "favorites">("recent");
  const [isLooping, setIsLooping] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentPlayingVideoId, setCurrentPlayingVideoId] = useState<string | null>(null);
  const [currentSavedTrackId, setCurrentSavedTrackId] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [playerSheetOpen, setPlayerSheetOpen] = useState(false);
  const [playerSheetMode, setPlayerSheetMode] = useState<"song" | "video">("song");
  const [showStartupIntro, setShowStartupIntro] = useState(true);
  const [isRepairingLibrary, setIsRepairingLibrary] = useState(false);
  const [playbackAssistPhase, setPlaybackAssistPhase] = useState<PlaybackAssistPhase>("idle");
  const [playbackAssistText, setPlaybackAssistText] = useState<string | null>(null);
  const [isTrackLoadPending, setIsTrackLoadPending] = useState(false);
  const introOpacity = useRef(new Animated.Value(1)).current;
  const clearLockScreenControls = useCallback(() => {
    if (typeof player.clearLockScreenControls === "function") {
      try {
        player.clearLockScreenControls();
      } catch {
        setLibraryError("Lock-screen controls were reset. Playback is still available in-app.");
      }
    }
  }, [player]);
  const safePausePlayer = useCallback(
    async (context: "ui" | "teardown" = "ui") => {
      try {
        await Promise.resolve(player.pause());
        return true;
      } catch {
        if (context === "ui") {
          setLibraryError("Audio session was reset. Please tap play again.");
        }
        return false;
      }
    },
    [player],
  );
  const safeReplacePlayer = useCallback(
    async (source: string | null, context: "ui" | "teardown" = "ui") => {
      try {
        await Promise.resolve(player.replace(source));
        return true;
      } catch {
        if (context === "ui") {
          setLibraryError("Audio engine is reloading. Please try again.");
        }
        return false;
      }
    },
    [player],
  );
  const safePlayPlayer = useCallback(async () => {
    try {
      await Promise.resolve(player.play());
      return true;
    } catch {
      setLibraryError("Playback could not start. Please try again.");
      return false;
    }
  }, [player]);
  const safeSeekPlayer = useCallback(
    async (seconds: number) => {
      try {
        await player.seekTo(seconds);
        return true;
      } catch {
        setLibraryError("Unable to move playback position right now.");
        return false;
      }
    },
    [player],
  );

  useEffect(() => {
    savedTracksRef.current = savedTracks;
  }, [savedTracks]);

  useEffect(() => {
    lastPlaylistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    let mounted = true;

    void setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      interruptionMode: "doNotMix",
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // Keep the app usable even if a device rejects an audio mode flag.
    });

    void loadSavedTracks()
      .then((tracks) => {
        if (!mounted) {
          return;
        }

        savedTracksRef.current = tracks;
        setSavedTracks(tracks);
      })
      .catch(() => {
        if (mounted) {
          setLibraryError("Your saved library could not be loaded on this device.");
        }
      })
      .finally(() => {
        if (mounted) {
          setIsHydratingLibrary(false);
        }
      });

    return () => {
      mounted = false;
      pollingRef.current = false;
      previewTokenRef.current += 1;
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = null;
      }
      void safePausePlayer("teardown");
    };
  }, [safePausePlayer, safeReplacePlayer]);

  useEffect(() => {
    let mounted = true;

    Animated.sequence([
      Animated.delay(750),
      Animated.timing(introOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (mounted) {
        setShowStartupIntro(false);
      }
    });

    return () => {
      mounted = false;
      introOpacity.stopAnimation();
    };
  }, [introOpacity]);

  useEffect(() => {
    if (currentSavedTrackId && !savedTracks.some((track) => track.id === currentSavedTrackId)) {
      setCurrentSavedTrackId(null);
    }
  }, [currentSavedTrackId, savedTracks]);

  useEffect(() => {
    player.loop = isLooping;
  }, [isLooping, player]);

  useEffect(() => {
    if (playerSheetOpen) {
      setPlayerSheetMode("song");
    }
  }, [playerSheetOpen]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 220);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const currentPlayingVideo = useMemo(
    () => playlist?.videos.find((video) => video.id === currentPlayingVideoId) ?? null,
    [currentPlayingVideoId, playlist],
  );
  const currentSavedTrack = useMemo(
    () => savedTracks.find((track) => track.id === currentSavedTrackId) ?? null,
    [currentSavedTrackId, savedTracks],
  );
  const normalizedLibraryQuery = useMemo(() => libraryQuery.trim().toLowerCase(), [libraryQuery]);
  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const filteredSavedTracks = useMemo(() => {
    let tracks = savedTracks;
    if (librarySort === "favorites") {
      tracks = tracks.filter((track) => track.isFavorite);
    } else if (librarySort === "title") {
      tracks = [...tracks].sort((left, right) => left.title.localeCompare(right.title));
    } else if (librarySort === "artist") {
      tracks = [...tracks].sort((left, right) => left.artist.localeCompare(right.artist));
    }

    if (!normalizedLibraryQuery) {
      return tracks;
    }

    return tracks.filter((track) =>
      [track.title, track.artist, track.fileName].some((value) => value.toLowerCase().includes(normalizedLibraryQuery)),
    );
  }, [librarySort, normalizedLibraryQuery, savedTracks]);
  const searchedSavedTracks = useMemo(() => {
    if (!normalizedSearchQuery) {
      return savedTracks.slice(0, 8);
    }

    return savedTracks.filter((track) =>
      [track.title, track.artist, track.fileName].some((value) => value.toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [normalizedSearchQuery, savedTracks]);
  const searchedPlaylistVideos = useMemo(() => {
    const videos = playlist?.videos ?? [];

    if (!normalizedSearchQuery) {
      return videos.slice(0, 8);
    }

    return videos.filter((video) =>
      [video.title, getArtistLine(video.title)].some((value) => value.toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [normalizedSearchQuery, playlist]);
  const savedTrackByVideoId = useMemo(() => {
    const entries = new Map<string, SavedTrack>();
    for (const track of savedTracks) {
      if (!entries.has(track.videoId)) {
        entries.set(track.videoId, track);
      }
    }
    return entries;
  }, [savedTracks]);
  const completedCount = useMemo(() => jobs.filter((job) => job.status === "completed").length, [jobs]);
  const failedCount = useMemo(() => jobs.filter((job) => job.status === "failed").length, [jobs]);
  const activeCount = useMemo(() => jobs.filter((job) => job.status === "downloading").length, [jobs]);
  const batchFinished =
    jobs.length > 0 && jobs.every((job) => job.status === "completed" || job.status === "failed");
  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === "completed" && job.filePath),
    [jobs],
  );
  const displayedPlaybackTime = scrubTime ?? playerStatus.currentTime;
  const sliderMax = Math.max(playerStatus.duration, 1);
  const playbackProgress =
    playerStatus.duration > 0 ? Math.min(100, (displayedPlaybackTime / playerStatus.duration) * 100) : 0;
  const currentSavedTrackIndex = useMemo(
    () => savedTracks.findIndex((track) => track.id === currentSavedTrackId),
    [currentSavedTrackId, savedTracks],
  );
  const isPlaybackAssistBusy = playbackAssistPhase === "repairing" || playbackAssistPhase === "streaming";
  const isCurrentTrackStalled = useMemo(
    () =>
      Boolean(
        currentSavedTrackId &&
          !isTrackLoadPending &&
          !isPlaybackAssistBusy &&
          !playerStatus.playing &&
          (!Number.isFinite(playerStatus.duration) || playerStatus.duration <= 0),
      ),
    [currentSavedTrackId, isPlaybackAssistBusy, isTrackLoadPending, playerStatus.duration, playerStatus.playing],
  );
  const recentSavedTracks = useMemo(() => savedTracks.slice(0, 6), [savedTracks]);
  const recommendedTracks = useMemo(
    () => (playlist?.videos ?? []).filter((video) => !savedTrackByVideoId.has(video.id)).slice(0, 6),
    [playlist, savedTrackByVideoId],
  );
  const searchedSavedIndexMap = useMemo(
    () => new Map(searchedSavedTracks.map((track, index) => [track.id, index])),
    [searchedSavedTracks],
  );
  const filteredSavedIndexMap = useMemo(
    () => new Map(filteredSavedTracks.map((track, index) => [track.id, index])),
    [filteredSavedTracks],
  );
  const jobsByVideoId = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of jobs) {
      map.set(job.videoId, job);
    }
    return map;
  }, [jobs]);
  const importingVideoIdSet = useMemo(() => new Set(importingVideoIds), [importingVideoIds]);
  const listPerfProps = useMemo(
    () => ({
      initialNumToRender: 8,
      windowSize: 7,
      maxToRenderPerBatch: 8,
      removeClippedSubviews: true,
    }),
    [],
  );

  const requestJson = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!API_BASE_URL) {
      throw new Error("Set EXPO_PUBLIC_API_BASE_URL in mobile/.env before using Velixa Mobile.");
    }

    const url = `${API_BASE_URL}${path}`;
    const timeoutBudget = getTimeoutBudget(path);
    const maxAttempts = timeoutBudget.maxAttempts;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await withTimeout(url, init, timeoutBudget.baseMs + attempt * timeoutBudget.stepMs);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts - 1 && isRetriableNetworkError(error)) {
          await sleep(350 * 2 ** attempt);
          continue;
        }

        if (error instanceof TypeError && /network request failed/i.test(error.message)) {
          throw new Error(
            `Network request failed. Cannot reach ${API_BASE_URL}. Ensure backend is running, your phone and PC are on the same Wi-Fi, and use 10.0.2.2:3000 for Android emulator.`,
          );
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Request timed out. Server is slow or network unstable, please retry.");
        }
        throw error instanceof Error ? error : new Error("Network request failed");
      }

      const rawText = await response.text();
      let payload: T | { error?: string } = {} as T;
      if (rawText) {
        try {
          payload = JSON.parse(rawText) as T | { error?: string };
        } catch {
          payload = { error: "Invalid server response." };
        }
      }

      if (!response.ok) {
        const statusRetriable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (attempt < maxAttempts - 1 && statusRetriable) {
          await sleep(350 * 2 ** attempt);
          continue;
        }
        const message =
          typeof payload === "object" && payload !== null && "error" in payload && payload.error
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      return payload as T;
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed");
  }, []);

  const stopPreviewPlayback = useCallback(() => {
    previewTokenRef.current += 1;
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (playerStatus.playing) {
      void safePausePlayer();
    }
  }, [playerStatus.playing, safePausePlayer]);

  const syncCompletedTracks = useCallback(async (downloadJobs: DownloadJob[]): Promise<{ importedCount: number; failedCount: number }> => {
    if (!playlist || !API_BASE_URL) {
      return { importedCount: 0, failedCount: 0 };
    }

    const readyJobs = downloadJobs.filter((job) => job.status === "completed" && job.filePath);
    const pendingInputs = readyJobs
      .filter(
        (job) =>
          !savedTracksRef.current.some(
            (track) => track.videoId === job.videoId && track.filePath === job.filePath,
          ),
      )
      .map((job) => {
        const video = playlist.videos.find((item) => item.id === job.videoId);
        const title = video?.title ?? job.title;
        return {
          videoId: job.videoId,
          title,
          artist: getArtistLine(title),
          duration: video?.duration,
          thumbnailUrl: getTrackArtworkUrl(job.videoId, video?.thumbnailUrl, "list") ?? undefined,
          filePath: job.filePath!,
          remoteUrl: `${API_BASE_URL}/api/file?path=${encodeURIComponent(job.filePath!)}`,
        };
      });

    if (pendingInputs.length === 0) {
      return { importedCount: 0, failedCount: 0 };
    }

    setImportingVideoIds((current) => [
      ...new Set([...current, ...pendingInputs.map((item) => item.videoId)]),
    ]);

    let importedCount = 0;
    let failedImports = 0;

    try {
      const result = await saveTracksToLibraryBatch(pendingInputs);
      importedCount = result.importedVideoIds.length;
      failedImports = result.failedVideoIds.length;
      savedTracksRef.current = result.tracks;
      setSavedTracks(result.tracks);
    } catch {
      failedImports = pendingInputs.length;
    } finally {
      const pendingIds = new Set(pendingInputs.map((item) => item.videoId));
      setImportingVideoIds((current) => current.filter((value) => !pendingIds.has(value)));
    }

    if (importedCount > 0) {
      setLibraryMessage(
        importedCount === 1
          ? "1 song was saved to your in-app library."
          : `${importedCount} songs were saved to your in-app library.`,
      );
      setLibraryError(null);
    }

    if (failedImports > 0) {
      setLibraryError("Some downloads were skipped because the audio format is not mobile-playable. Re-download those tracks.");
    }

    return { importedCount, failedCount: failedImports };
  }, [API_BASE_URL, playlist]);

  const pollJobStatus = useCallback(async (jobId: string) => {
    pollingRef.current = true;

    while (pollingRef.current) {
      const payload = await requestJson<{ jobs: DownloadJob[]; logs: string[] }>(
        `/api/download?jobId=${encodeURIComponent(jobId)}&includeLogs=true`,
      );

      setJobs(payload.jobs);
      setLogs(payload.logs);

      const done =
        payload.jobs.length > 0 &&
        payload.jobs.every((job) => job.status === "completed" || job.status === "failed");

      if (done) {
        pollingRef.current = false;
        const failed = payload.jobs.filter((job) => job.status === "failed").length;
        const imported = await syncCompletedTracks(payload.jobs);
        const messageParts: string[] = [];

        if (failed > 0) {
          messageParts.push(`${failed} track(s) failed. You can retry individual songs.`);
        }
        if (imported.importedCount > 0) {
          messageParts.push(`${imported.importedCount} track(s) are ready in your in-app library.`);
        }
        if (failed === 0 && imported.importedCount === 0) {
          messageParts.push("Your selected songs are ready for file delivery.");
        }
        if (imported.failedCount > 0) {
          messageParts.push("A few finished files were not copied into the app library.");
        }

        Alert.alert(
          failed > 0 ? "Downloads finished with issues" : "Downloads ready",
          messageParts.join(" "),
        );
        break;
      }

      await sleep(1500);
    }
  }, [requestJson, syncCompletedTracks]);

  const handleFetchPlaylist = useCallback(async () => {
    setError(null);
    setLibraryMessage(null);

    if (!validatePlaylistUrl(inputUrl)) {
      setError("Please enter a valid YouTube playlist URL.");
      return;
    }

    try {
      setIsLoading(true);
      const payload = await requestJson<PlaylistMetadata>("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl }),
      });

      setPlaylist(payload);
      setPlaylistUrl(inputUrl);
      setSelectedVideoIds([]);
      setJobs([]);
      setLogs([]);
      setCurrentJobId(null);
      setCurrentPlayingVideoId(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to fetch playlist.");
      if (lastPlaylistRef.current) {
        setPlaylist(lastPlaylistRef.current);
        setLibraryMessage("Showing last fetched playlist while network recovers.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [inputUrl, requestJson]);

  const handleDownloadSelected = useCallback(async () => {
    if (!playlistUrl || selectedVideoIds.length === 0) {
      return;
    }

    try {
      setError(null);
      setLibraryError(null);
      setLibraryMessage(null);
      setIsLoading(true);
      setCurrentJobId(null);
      setJobs([]);
      setLogs([]);
      pollingRef.current = false;

      const payload = await requestJson<{ jobId: string }>("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistUrl, videoIds: selectedVideoIds }),
      });

      setCurrentJobId(payload.jobId);
      await pollJobStatus(payload.jobId);
    } catch (requestError) {
      pollingRef.current = false;
      const message =
        requestError instanceof Error ? requestError.message : "Unable to start downloads.";
      setError(message);
      setCurrentJobId(null);
      setJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, [playlistUrl, selectedVideoIds, pollJobStatus, requestJson]);

  const handleRetry = useCallback(async (videoId: string) => {
    if (!playlistUrl) {
      return;
    }

    try {
      setError(null);
      setLibraryError(null);
      const payload = await requestJson<{ jobId: string }>("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistUrl, videoIds: [videoId] }),
      });
      setCurrentJobId(payload.jobId);
      await pollJobStatus(payload.jobId);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Retry failed.";
      setError(message);
      Alert.alert("Retry failed", message);
    }
  }, [playlistUrl, pollJobStatus, requestJson]);

  async function openUrl(url: string) {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Unable to open", "This link could not be opened on the device.");
      return;
    }

    await Linking.openURL(url);
  }

  async function handleOpenArchive() {
    if (!currentJobId) {
      return;
    }

    const title = encodeURIComponent(playlist?.title ?? "velixa-downloads");
    await openUrl(`${API_BASE_URL}/api/archive?jobId=${encodeURIComponent(currentJobId)}&title=${title}`);
  }

  const handleSaveTrack = useCallback(async (videoId: string) => {
    const targetJob = jobs.find((job) => job.videoId === videoId && job.status === "completed" && job.filePath);
    if (!targetJob) {
      return;
    }

    const result = await syncCompletedTracks([targetJob]);
    if (result.importedCount === 0 && result.failedCount === 0) {
      setLibraryMessage("That song is already saved in your in-app library.");
    }
  }, [jobs, syncCompletedTracks]);

  const repairSavedTrack = useCallback(
    async (track: SavedTrack): Promise<SavedTrack | null> => {
      try {
        autoRepairingVideoIdRef.current = track.videoId;
        setPlaybackAssistPhase("repairing");
        setPlaybackAssistText(`Repairing "${track.title}"...`);
        setLibraryError(null);
        setLibraryMessage(`Repairing "${track.title}" for mobile playback...`);
        const payload = await requestJson<{ filePath: string }>("/api/repair-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: track.videoId }),
        });

        const result = await saveTracksToLibraryBatch([
          {
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnailUrl: track.thumbnailUrl,
            filePath: payload.filePath,
            remoteUrl: `${API_BASE_URL}/api/file?path=${encodeURIComponent(payload.filePath)}`,
          },
        ]);

        savedTracksRef.current = result.tracks;
        setSavedTracks(result.tracks);

        if (result.failedVideoIds.includes(track.videoId)) {
          setPlaybackAssistPhase("failed");
          setPlaybackAssistText(`Repair failed for "${track.title}".`);
          setLibraryError(`"${track.title}" still uses an unsupported audio format for this device.`);
          return null;
        }

        const repairedTrack = result.tracks.find((item) => item.videoId === track.videoId) ?? null;
        if (!repairedTrack) {
          setPlaybackAssistPhase("failed");
          setPlaybackAssistText(`Repair failed for "${track.title}".`);
          setLibraryError(`Could not locate repaired file for "${track.title}".`);
          return null;
        }

        setPlaybackAssistPhase("done");
        setPlaybackAssistText(`Repair done. Retrying "${track.title}"...`);
        setLibraryMessage(`Repaired "${track.title}". Retrying playback...`);
        return repairedTrack;
      } catch (error) {
        setPlaybackAssistPhase("failed");
        setPlaybackAssistText(`Repair failed for "${track.title}".`);
        const reason = error instanceof Error ? error.message : "Repair failed";
        setLibraryError(`Could not repair "${track.title}": ${reason}`);
        return null;
      } finally {
        autoRepairingVideoIdRef.current = null;
      }
    },
    [requestJson],
  );

  const playTrackFromStreamFallback = useCallback(
    async (track: SavedTrack): Promise<boolean> => {
      try {
        autoStreamAttemptedVideoIdsRef.current.add(track.videoId);
        setPlaybackAssistPhase("streaming");
        setPlaybackAssistText(`Trying direct stream for "${track.title}"...`);
        setLibraryError(`"${track.title}" local file failed. Trying direct stream...`);
        const payload = await requestJson<{ url: string }>("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: track.videoId }),
        });
        if (!(await safeReplacePlayer(payload.url))) {
          return false;
        }
        const didSeek = await safeSeekPlayer(0);
        if (!didSeek) {
          return false;
        }
        if (!(await safePlayPlayer())) {
          return false;
        }
        setLibraryError(null);
        setPlaybackAssistPhase("done");
        setPlaybackAssistText(`Direct stream started: "${track.title}"`);
        setLibraryMessage(`Streaming fallback playing: ${track.title}`);
        return true;
      } catch {
        setPlaybackAssistPhase("failed");
        setPlaybackAssistText(`Direct stream failed for "${track.title}".`);
        setLibraryError(`"${track.title}" stream fallback also failed.`);
        return false;
      }
    },
    [requestJson, safePlayPlayer, safeReplacePlayer, safeSeekPlayer],
  );

  const toggleVideo = useCallback((id: string) => {
    setSelectedVideoIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  const openPlayer = useCallback(async (videoId: string) => {
    setError(null);
    setCurrentPlayingVideoId(videoId);
    setPlayerOpen(true);
    setIsPreviewLoading(true);
    stopPreviewPlayback();
    const previewToken = previewTokenRef.current;

    try {
      setPlayerSheetOpen(false);
      clearLockScreenControls();

      const payload = await requestJson<{ url: string }>("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      if (!(await safeReplacePlayer(payload.url))) {
        return;
      }
      const seeked = await safeSeekPlayer(0);
      if (!seeked) {
        return;
      }
      if (!(await safePlayPlayer())) {
        return;
      }
      setLibraryMessage("Playing 15-second audio preview.");

      previewTimeoutRef.current = setTimeout(() => {
        if (previewTokenRef.current === previewToken) {
          void safePausePlayer();
        }
      }, 15_000);
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Unable to start preview.";
      setError(message);
      setPlayerOpen(false);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [clearLockScreenControls, player, requestJson, stopPreviewPlayback]);

  const handlePlaySavedTrack = useCallback(async (trackId: string) => {
    const track = savedTracksRef.current.find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    autoRepairAttemptedVideoIdsRef.current.delete(track.videoId);
    autoStreamAttemptedVideoIdsRef.current.delete(track.videoId);
    setPlaybackAssistPhase("idle");
    setPlaybackAssistText(null);

    setPlayerSheetOpen(true);
    setPlayerOpen(false);
    setLibraryError(null);
    stopPreviewPlayback();
    setIsTrackLoadPending(true);

    try {
      if (currentSavedTrackId === trackId && playerStatus.isLoaded) {
        if (playerStatus.playing) {
          void safePausePlayer();
          return;
        }

        if (playerStatus.duration > 0 && playerStatus.currentTime >= Math.max(playerStatus.duration - 0.5, 0)) {
          const didSeek = await safeSeekPlayer(0);
          if (!didSeek) {
            return;
          }
        }

        void safePlayPlayer();
        return;
      }

      let trackToPlay = track;
      const setLockScreenTrack = (activeTrack: SavedTrack) => {
        if (typeof player.setActiveForLockScreen !== "function") {
          return;
        }
        try {
          player.setActiveForLockScreen(true, {
            title: activeTrack.title,
            artist: activeTrack.artist,
            artworkUrl: getTrackArtworkUrl(activeTrack.videoId, activeTrack.thumbnailUrl, "player") ?? undefined,
          });
        } catch {
          // Keep playback working if lock-screen metadata is unsupported on this device.
        }
      };

      const repairAndSwapTrack = async () => {
        const repairedTrack = await repairSavedTrack(trackToPlay);
        if (!repairedTrack) {
          return false;
        }
        trackToPlay = repairedTrack;
        setCurrentSavedTrackId(repairedTrack.id);
        setScrubTime(null);
        return true;
      };

      setCurrentSavedTrackId(trackToPlay.id);
      setScrubTime(null);
      if (!(await safeReplacePlayer(trackToPlay.localUri))) {
        if (!(await repairAndSwapTrack())) {
          if (!(await playTrackFromStreamFallback(trackToPlay))) {
            return;
          }
          return;
        }
        if (!(await safeReplacePlayer(trackToPlay.localUri))) {
          if (!(await playTrackFromStreamFallback(trackToPlay))) {
            setLibraryError(`"${trackToPlay.title}" still cannot be loaded for playback.`);
            return;
          }
          return;
        }
      }
      setLockScreenTrack(trackToPlay);
      if (!(await safePlayPlayer())) {
        if (!(await repairAndSwapTrack())) {
          if (!(await playTrackFromStreamFallback(trackToPlay))) {
            return;
          }
          return;
        }
        if (!(await safeReplacePlayer(trackToPlay.localUri))) {
          if (!(await playTrackFromStreamFallback(trackToPlay))) {
            setLibraryError(`"${trackToPlay.title}" still cannot be loaded after repair.`);
            return;
          }
          return;
        }
        setLockScreenTrack(trackToPlay);
        if (!(await safePlayPlayer())) {
          if (!(await playTrackFromStreamFallback(trackToPlay))) {
            setLibraryError(`"${trackToPlay.title}" is not playable on this device yet.`);
            return;
          }
          return;
        }
      }
      setLibraryMessage(`Now playing ${trackToPlay.title}.`);
      setPlaybackAssistPhase("done");
      setPlaybackAssistText(`Now playing "${trackToPlay.title}"`);
    } catch {
      setPlaybackAssistPhase("failed");
      setPlaybackAssistText(`Playback failed for "${track.title}".`);
      setLibraryError("This saved track could not be played. Re-download this song from Queue for a mobile-safe file.");
    } finally {
      setIsTrackLoadPending(false);
    }
  }, [
    clearLockScreenControls,
    currentSavedTrackId,
    player,
    playerStatus,
    playTrackFromStreamFallback,
    repairSavedTrack,
    setIsTrackLoadPending,
    stopPreviewPlayback,
  ]);

  useEffect(() => {
    if (!currentSavedTrackId) {
      autoRepairAttemptedVideoIdsRef.current.clear();
      autoStreamAttemptedVideoIdsRef.current.clear();
      autoRepairingVideoIdRef.current = null;
      setPlaybackAssistPhase("idle");
      setPlaybackAssistText(null);
      setIsTrackLoadPending(false);
      if (playbackStallTimeoutRef.current) {
        clearTimeout(playbackStallTimeoutRef.current);
        playbackStallTimeoutRef.current = null;
      }
      return;
    }

    if (isTrackLoadPending || isPlaybackAssistBusy) {
      if (playbackStallTimeoutRef.current) {
        clearTimeout(playbackStallTimeoutRef.current);
        playbackStallTimeoutRef.current = null;
      }
      return;
    }

    if (playerStatus.playing || (Number.isFinite(playerStatus.duration) && playerStatus.duration > 0)) {
      if (playbackStallTimeoutRef.current) {
        clearTimeout(playbackStallTimeoutRef.current);
        playbackStallTimeoutRef.current = null;
      }
      return;
    }

    if (playbackStallTimeoutRef.current) {
      return;
    }

    playbackStallTimeoutRef.current = setTimeout(() => {
      playbackStallTimeoutRef.current = null;
      const activeTrack = savedTracksRef.current.find((track) => track.id === currentSavedTrackId);
      if (!activeTrack) {
        return;
      }
      if (autoRepairingVideoIdRef.current === activeTrack.videoId) {
        return;
      }
      if (autoRepairAttemptedVideoIdsRef.current.has(activeTrack.videoId)) {
        if (!autoStreamAttemptedVideoIdsRef.current.has(activeTrack.videoId)) {
          void (async () => {
            setIsTrackLoadPending(true);
            try {
              await playTrackFromStreamFallback(activeTrack);
            } finally {
              setIsTrackLoadPending(false);
            }
          })();
          return;
        }
        setLibraryError(`"${activeTrack.title}" could not load (0:00). Try Repair or re-download this track.`);
        return;
      }

      autoRepairAttemptedVideoIdsRef.current.add(activeTrack.videoId);
      autoRepairingVideoIdRef.current = activeTrack.videoId;

      void (async () => {
        setPlaybackAssistPhase("streaming");
        setPlaybackAssistText(`Timeline not loaded. Trying direct stream for "${activeTrack.title}"...`);
        setLibraryError(`"${activeTrack.title}" timeline not loaded. Trying direct stream...`);
        setIsTrackLoadPending(true);
        try {
          const streamed = await playTrackFromStreamFallback(activeTrack);
          if (!streamed) {
            setLibraryError(`"${activeTrack.title}" direct stream failed. You can try manual repair or re-download.`);
          }
        } finally {
          autoRepairingVideoIdRef.current = null;
          setIsTrackLoadPending(false);
        }
      })();
    }, 2200);

    return () => {
      if (playbackStallTimeoutRef.current) {
        clearTimeout(playbackStallTimeoutRef.current);
        playbackStallTimeoutRef.current = null;
      }
    };
  }, [
    currentSavedTrackId,
    playerStatus.duration,
    playerStatus.playing,
    playTrackFromStreamFallback,
    isPlaybackAssistBusy,
    isTrackLoadPending,
  ]);

  useEffect(() => {
    if (!currentSavedTrack) {
      return;
    }
    if (playerStatus.playing && Number.isFinite(playerStatus.currentTime) && playerStatus.currentTime > 0.2) {
      autoRepairAttemptedVideoIdsRef.current.delete(currentSavedTrack.videoId);
      autoStreamAttemptedVideoIdsRef.current.delete(currentSavedTrack.videoId);
    }
  }, [currentSavedTrack, playerStatus.currentTime, playerStatus.playing]);

  async function handleSeekComplete(value: number) {
    setScrubTime(value);

    try {
      const didSeek = await safeSeekPlayer(value);
      if (!didSeek) {
        return;
      }
    } catch {
      setLibraryError("Unable to move playback to that position.");
    } finally {
      setScrubTime(null);
    }
  }

  const handlePlayAdjacent = useCallback((direction: 1 | -1) => {
    const tracks = savedTracksRef.current;
    if (tracks.length === 0) {
      return;
    }

    const currentIndex = tracks.findIndex((track) => track.id === currentSavedTrackId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = baseIndex + direction;

    if (nextIndex < 0 || nextIndex >= tracks.length) {
      setLibraryMessage(direction > 0 ? "You reached the end of your saved queue." : "You are already on the first saved track.");
      return;
    }

    void handlePlaySavedTrack(tracks[nextIndex].id);
  }, [currentSavedTrackId, handlePlaySavedTrack]);

  const handlePlayRandomTrack = useCallback(() => {
    const tracks = savedTracksRef.current;
    if (tracks.length === 0) {
      return;
    }

    const randomIndex = Math.floor(Math.random() * tracks.length);
    void handlePlaySavedTrack(tracks[randomIndex].id);
  }, [handlePlaySavedTrack]);

  const handleRemoveTrack = useCallback(async (trackId: string) => {
    try {
      if (currentSavedTrackId === trackId) {
        void safePausePlayer();
        clearLockScreenControls();
        setCurrentSavedTrackId(null);
      }

      const nextTracks = await removeSavedTrack(trackId);
      savedTracksRef.current = nextTracks;
      setSavedTracks(nextTracks);
      setLibraryMessage("Song removed from your in-app library.");
    } catch {
      setLibraryError("That song could not be removed from your library.");
    }
  }, [clearLockScreenControls, currentSavedTrackId, safePausePlayer]);

  const handleToggleFavorite = useCallback(async (trackId: string) => {
    try {
      const nextTracks = await toggleFavoriteTrack(trackId);
      savedTracksRef.current = nextTracks;
      setSavedTracks(nextTracks);
    } catch {
      setLibraryError("Could not update favorites right now.");
    }
  }, []);

  const handleMoveTrack = useCallback(async (trackId: string, direction: "up" | "down") => {
    try {
      const nextTracks = await moveTrack(trackId, direction);
      savedTracksRef.current = nextTracks;
      setSavedTracks(nextTracks);
    } catch {
      setLibraryError("Could not reorder tracks right now.");
    }
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    setRecentSearches((current) => [normalized, ...current.filter((item) => item !== normalized)].slice(0, 6));
  }, []);

  const featuredTrack = currentSavedTrack ?? filteredSavedTracks[0] ?? savedTracks[0] ?? null;
  const featuredTrackArtwork = featuredTrack
    ? getTrackArtworkUrl(featuredTrack.videoId, featuredTrack.thumbnailUrl, "player")
    : null;
  const currentTrackArtwork = currentSavedTrack
    ? getTrackArtworkUrl(currentSavedTrack.videoId, currentSavedTrack.thumbnailUrl, "player")
    : null;

  const handleRepairUnplayableTracks = useCallback(async () => {
    const existingTracks = [...savedTracksRef.current];
    if (existingTracks.length === 0) {
      setLibraryMessage("Your library is already empty.");
      return;
    }

    setIsRepairingLibrary(true);
    setLibraryError(null);
    setLibraryMessage("Repair started. Re-downloading songs in mobile-safe format...");

    let repaired = 0;
    let failed = 0;
    let workingTracks = existingTracks;

    for (const track of existingTracks) {
      try {
        const payload = await requestJson<{ filePath: string }>("/api/repair-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: track.videoId }),
        });

        const result = await saveTracksToLibraryBatch([
          {
            videoId: track.videoId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnailUrl: track.thumbnailUrl,
            filePath: payload.filePath,
            remoteUrl: `${API_BASE_URL}/api/file?path=${encodeURIComponent(payload.filePath)}`,
          },
        ]);

        workingTracks = result.tracks;
        repaired += result.importedVideoIds.length;
        failed += result.failedVideoIds.length;
      } catch {
        failed += 1;
      }
    }

    savedTracksRef.current = workingTracks;
    setSavedTracks(workingTracks);

    if (repaired > 0 && failed === 0) {
      setLibraryMessage(`${repaired} songs repaired and now playable.`);
    } else if (repaired > 0 && failed > 0) {
      setLibraryMessage(`${repaired} songs repaired. ${failed} still need manual retry.`);
    } else {
      setLibraryError("Repair could not recover these tracks. Try re-downloading from Queue.");
    }

    setIsRepairingLibrary(false);
  }, [requestJson]);

  const renderSearchedSavedTrackRow = useCallback(
    ({ item }: { item: SavedTrack }) => {
      const index = searchedSavedIndexMap.get(item.id) ?? -1;
      return (
        <SavedTrackRow
          track={item}
          isActive={currentSavedTrackId === item.id}
          isPlaying={currentSavedTrackId === item.id && playerStatus.playing}
          canMoveUp={index > 0}
          canMoveDown={index >= 0 && index < searchedSavedTracks.length - 1}
          onPlay={handlePlaySavedTrack}
          onRemove={handleRemoveTrack}
          onToggleFavorite={handleToggleFavorite}
          onMove={handleMoveTrack}
        />
      );
    },
    [
      currentSavedTrackId,
      handleMoveTrack,
      handlePlaySavedTrack,
      handleRemoveTrack,
      handleToggleFavorite,
      playerStatus.playing,
      searchedSavedIndexMap,
      searchedSavedTracks.length,
    ],
  );

  const renderFilteredSavedTrackRow = useCallback(
    ({ item }: { item: SavedTrack }) => {
      const index = filteredSavedIndexMap.get(item.id) ?? -1;
      return (
        <SavedTrackRow
          track={item}
          isActive={currentSavedTrackId === item.id}
          isPlaying={currentSavedTrackId === item.id && playerStatus.playing}
          canMoveUp={index > 0}
          canMoveDown={index >= 0 && index < filteredSavedTracks.length - 1}
          onPlay={handlePlaySavedTrack}
          onRemove={handleRemoveTrack}
          onToggleFavorite={handleToggleFavorite}
          onMove={handleMoveTrack}
        />
      );
    },
    [
      currentSavedTrackId,
      filteredSavedIndexMap,
      filteredSavedTracks.length,
      handleMoveTrack,
      handlePlaySavedTrack,
      handleRemoveTrack,
      handleToggleFavorite,
      playerStatus.playing,
    ],
  );

  const handleOpenTrackMenu = useCallback(
    (trackId: string) => {
      const track = savedTracksRef.current.find((item) => item.id === trackId);
      if (!track) {
        return;
      }

      Alert.alert(track.title, "Quick actions", [
        {
          text: currentSavedTrackId === trackId && playerStatus.playing ? "Pause" : "Play",
          onPress: () => {
            void handlePlaySavedTrack(trackId);
          },
        },
        {
          text: track.isFavorite ? "Unfavorite" : "Favorite",
          onPress: () => {
            void handleToggleFavorite(trackId);
          },
        },
        {
          text: "Move up",
          onPress: () => {
            void handleMoveTrack(trackId, "up");
          },
        },
        {
          text: "Move down",
          onPress: () => {
            void handleMoveTrack(trackId, "down");
          },
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void handleRemoveTrack(trackId);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [
      currentSavedTrackId,
      handleMoveTrack,
      handlePlaySavedTrack,
      handleRemoveTrack,
      handleToggleFavorite,
      playerStatus.playing,
    ],
  );

  const renderLibraryListRow = useCallback(
    ({ item }: { item: SavedTrack }) => (
      <LibraryTrackRow
        track={item}
        isActive={currentSavedTrackId === item.id}
        isPlaying={currentSavedTrackId === item.id && playerStatus.playing}
        onPress={handlePlaySavedTrack}
        onOpenMenu={handleOpenTrackMenu}
      />
    ),
    [currentSavedTrackId, handleOpenTrackMenu, handlePlaySavedTrack, playerStatus.playing],
  );

  const renderSearchedPlaylistRow = useCallback(
    ({ item }: { item: VideoItem }) => {
      const savedTrack = savedTrackByVideoId.get(item.id) ?? null;
      return (
        <SongRow
          video={item}
          isSelected={selectedVideoIds.includes(item.id)}
          job={jobsByVideoId.get(item.id)}
          savedTrack={savedTrack}
          isSaving={importingVideoIdSet.has(item.id)}
          isSavedPlaying={savedTrack ? currentSavedTrackId === savedTrack.id && playerStatus.playing : false}
          onToggle={toggleVideo}
          onPreview={openPlayer}
          onRetry={handleRetry}
          onSaveToLibrary={handleSaveTrack}
          onPlaySavedTrack={handlePlaySavedTrack}
        />
      );
    },
    [
      currentSavedTrackId,
      handlePlaySavedTrack,
      handleRetry,
      handleSaveTrack,
      importingVideoIdSet,
      jobsByVideoId,
      openPlayer,
      playerStatus.playing,
      savedTrackByVideoId,
      selectedVideoIds,
      toggleVideo,
    ],
  );

  const renderQueuePlaylistRow = useCallback(
    ({ item }: { item: VideoItem }) => {
      const savedTrack = savedTrackByVideoId.get(item.id) ?? null;
      return (
        <SongRow
          video={item}
          isSelected={selectedVideoIds.includes(item.id)}
          job={jobsByVideoId.get(item.id)}
          savedTrack={savedTrack}
          isSaving={importingVideoIdSet.has(item.id)}
          isSavedPlaying={savedTrack ? currentSavedTrackId === savedTrack.id && playerStatus.playing : false}
          onToggle={toggleVideo}
          onPreview={openPlayer}
          onRetry={handleRetry}
          onSaveToLibrary={handleSaveTrack}
          onPlaySavedTrack={handlePlaySavedTrack}
        />
      );
    },
    [
      currentSavedTrackId,
      handlePlaySavedTrack,
      handleRetry,
      handleSaveTrack,
      importingVideoIdSet,
      jobsByVideoId,
      openPlayer,
      playerStatus.playing,
      savedTrackByVideoId,
      selectedVideoIds,
      toggleVideo,
    ],
  );

  function renderAlerts() {
    return (
      <>
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Something needs attention</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {libraryError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Library needs attention</Text>
            <Text style={styles.errorText}>{libraryError}</Text>
          </View>
        ) : null}

        {libraryMessage ? (
          <View style={styles.libraryMessageCard}>
            <Text style={styles.libraryMessageTitle}>Library update</Text>
            <Text style={styles.libraryMessageText}>{libraryMessage}</Text>
          </View>
        ) : null}
      </>
    );
  }

  function renderHomeSection() {
    const featuredHomeTrack = currentSavedTrack ?? recentSavedTracks[0] ?? null;
    const featuredHomeArtwork = featuredHomeTrack
      ? getTrackArtworkUrl(featuredHomeTrack.videoId, featuredHomeTrack.thumbnailUrl, "player")
      : playlist?.videos[0]
        ? getTrackArtworkUrl(playlist.videos[0].id, playlist.videos[0].thumbnailUrl, "list")
        : null;

    return (
      <>
        <View style={styles.screenHeaderRow}>
          <View style={styles.profileBadge}>
            <Text style={styles.profileBadgeText}>V</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillRow}>
            <Pressable style={[styles.filterPill, styles.filterPillActive]}>
              <Text style={[styles.filterPillText, styles.filterPillTextActive]}>All</Text>
            </Pressable>
            <Pressable style={styles.filterPill}>
              <Text style={styles.filterPillText}>Music</Text>
            </Pressable>
            <Pressable style={styles.filterPill} onPress={() => setActiveSection("search")}>
              <Text style={styles.filterPillText}>Search</Text>
            </Pressable>
            <Pressable style={styles.filterPill} onPress={() => setActiveSection("queue")}>
              <Text style={styles.filterPillText}>Queue</Text>
            </Pressable>
          </ScrollView>
        </View>

        <View>
          <Text style={styles.screenTitle}>Good evening</Text>
          <Text style={styles.screenSubtitle}>Jump back into saved songs, playlist picks, and your active queue.</Text>
          <View style={styles.mediaShortcutGrid}>
            <MediaShortcutTile
              title={currentSavedTrack?.title ?? "Your Library"}
              subtitle={currentSavedTrack ? "Open full player" : `${savedTracks.length} saved songs ready`}
              artworkUrl={currentTrackArtwork}
              onPress={() => (currentSavedTrack ? setPlayerSheetOpen(true) : setActiveSection("library"))}
            />
            <MediaShortcutTile
              title={playlist?.title ?? "Fetch playlist"}
              subtitle={playlist ? `${playlist.videoCount} tracks loaded` : "Paste a public YouTube playlist"}
              artworkUrl={playlist?.videos[0] ? getTrackArtworkUrl(playlist.videos[0].id, playlist.videos[0].thumbnailUrl, "list") : null}
              onPress={() => setActiveSection("queue")}
            />
            <MediaShortcutTile
              title="Shuffle mix"
              subtitle="Instant random playback from your library"
              artworkUrl={recentSavedTracks[1] ? getTrackArtworkUrl(recentSavedTracks[1].videoId, recentSavedTracks[1].thumbnailUrl, "list") : currentTrackArtwork}
              onPress={handlePlayRandomTrack}
            />
            <MediaShortcutTile
              title="Search"
              subtitle="Find downloaded songs and playlist results"
              artworkUrl={recommendedTracks[0] ? getTrackArtworkUrl(recommendedTracks[0].id, recommendedTracks[0].thumbnailUrl, "list") : null}
              onPress={() => setActiveSection("search")}
            />
          </View>
        </View>

        {featuredHomeTrack ? (
          <Pressable style={styles.featureStoryCard} onPress={() => void handlePlaySavedTrack(featuredHomeTrack.id)}>
            {featuredHomeArtwork ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image source={toCachedImageSource(featuredHomeArtwork)} style={styles.featureStoryArtwork} resizeMode="cover" />
            ) : (
              <View style={styles.featureStoryFallback}>
                <Text style={styles.featureStoryFallbackText}>VELIXA</Text>
              </View>
            )}
            <View style={styles.featureStoryCopy}>
              <Text style={styles.sectionEyebrow}>Picked for you</Text>
              <Text numberOfLines={2} style={styles.featureStoryTitle}>
                {featuredHomeTrack.title}
              </Text>
              <Text numberOfLines={2} style={styles.featureStorySubtitle}>
                {playerStatus.playing && currentSavedTrack?.id === featuredHomeTrack.id
                  ? "Now playing from your library"
                  : "Tap to jump into the full-screen player"}
              </Text>
            </View>
          </Pressable>
        ) : null}

        {recentSavedTracks.length > 0 ? (
          <View>
            <Text style={styles.sectionListTitle}>New releases for you</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
              {recentSavedTracks.map((track) => (
                <ShelfTrack
                  key={track.id}
                  title={track.title}
                  subtitle={track.duration ?? "Saved audio"}
                  artworkUrl={getTrackArtworkUrl(track.videoId, track.thumbnailUrl, "list") ?? undefined}
                  onPress={() => void handlePlaySavedTrack(track.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {recommendedTracks.length > 0 ? (
          <View>
            <Text style={styles.sectionListTitle}>From the fetched playlist</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
              {recommendedTracks.map((video) => (
                <ShelfTrack
                  key={video.id}
                  title={video.title}
                  subtitle={getArtistLine(video.title)}
                  artworkUrl={getTrackArtworkUrl(video.id, video.thumbnailUrl, "list") ?? undefined}
                  accent="blue"
                  onPress={() => void openPlayer(video.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </>
    );
  }

  function renderSearchSection() {
    return (
      <>
        <View style={styles.searchBarWrap}>
          <Text style={styles.searchBarIcon}>⌕</Text>
          <TextInput
            value={searchInput}
            onChangeText={handleSearchChange}
            placeholder="What do you want to listen to?"
            placeholderTextColor="#4d4f54"
            style={styles.searchBarInput}
            autoCapitalize="none"
          />
        </View>

        {recentSearches.length > 0 ? (
          <View style={styles.selectionActions}>
            {recentSearches.map((term) => (
              <Pressable key={term} style={styles.countPill} onPress={() => setSearchInput(term)}>
                <Text style={styles.countPillText}>{term}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View>
          <Text style={styles.sectionListTitle}>Browse all</Text>
          <View style={styles.browseGrid}>
            <BrowseTile title="Made For You" toneStyle={styles.browseTileBlue} onPress={() => setSearchQuery("made")} />
            <BrowseTile title="New Releases" toneStyle={styles.browseTileOrange} onPress={() => setSearchQuery("new")} />
            <BrowseTile title="Downloaded" toneStyle={styles.browseTileSky} onPress={() => setSearchQuery("downloaded")} />
            <BrowseTile title="Pop" toneStyle={styles.browseTileCyan} onPress={() => setSearchQuery("pop")} />
            <BrowseTile title="Country" toneStyle={styles.browseTileRust} onPress={() => setSearchQuery("country")} />
            <BrowseTile title="Library" toneStyle={styles.browseTilePurple} onPress={() => setActiveSection("library")} />
            <BrowseTile title="Preview Player" toneStyle={styles.browseTileIndigo} onPress={() => setActiveSection("queue")} />
            <BrowseTile title="Charts" toneStyle={styles.browseTileMagenta} onPress={() => setSearchQuery("charts")} />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.libraryHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>Saved results</Text>
              <Text style={styles.sectionTitle}>From your Velixa library</Text>
            </View>
            <View style={styles.playerModePill}>
              <Text style={styles.playerModeText}>{searchedSavedTracks.length}</Text>
            </View>
          </View>

          {searchedSavedTracks.length > 0 ? (
            <FlatList
              data={searchedSavedTracks}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchedSavedTrackRow}
              scrollEnabled={false}
              contentContainerStyle={styles.songList}
              {...listPerfProps}
            />
          ) : (
            <View style={styles.emptyPlayer}>
              <Text style={styles.emptyPlayerTitle}>No saved result yet</Text>
              <Text style={styles.emptyPlayerText}>Try another search or download more songs first.</Text>
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.libraryHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>Playlist results</Text>
              <Text style={styles.sectionTitle}>From the current playlist</Text>
            </View>
            <View style={styles.playerModePill}>
              <Text style={styles.playerModeText}>{searchedPlaylistVideos.length}</Text>
            </View>
          </View>

          {searchedPlaylistVideos.length > 0 ? (
            <FlatList
              data={searchedPlaylistVideos}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchedPlaylistRow}
              scrollEnabled={false}
              contentContainerStyle={styles.songList}
              {...listPerfProps}
            />
          ) : (
            <View style={styles.emptyPlayer}>
              <Text style={styles.emptyPlayerTitle}>No playlist result</Text>
              <Text style={styles.emptyPlayerText}>Fetch a playlist or search with a different keyword.</Text>
            </View>
          )}
        </View>
      </>
    );
  }

  function renderQueueSection() {
    return (
      <>
        <View style={styles.queueHeroCard}>
          <Text style={styles.sectionEyebrow}>Queue manager</Text>
          <Text style={styles.screenTitle}>Bring a playlist into Velixa.</Text>
          <Text style={styles.sectionCopy}>
            Fetch a public YouTube playlist, preview tracks, and push selected songs into your library.
          </Text>

          <TextInput
            value={inputUrl}
            onChangeText={setInputUrl}
            placeholder="https://music.youtube.com/playlist?list=..."
            placeholderTextColor="#6f6f76"
            style={styles.input}
            autoCapitalize="none"
            keyboardType="url"
          />

          <Pressable style={[styles.primaryButton, isLoading && styles.disabledButton]} onPress={handleFetchPlaylist}>
            {isLoading ? <ActivityIndicator color="#05150a" /> : <Text style={styles.primaryButtonText}>Fetch playlist</Text>}
          </Pressable>

          <Text style={styles.apiHint}>
            Backend: {API_BASE_URL || "Set EXPO_PUBLIC_API_BASE_URL in mobile/.env"}
          </Text>
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard label="Selected" value={selectedVideoIds.length} />
          <MetricCard label="Ready" value={completedCount} valueStyle={styles.metricValueGreen} />
          <MetricCard label="Active" value={activeCount} valueStyle={styles.metricValueBlue} active />
          <MetricCard label="Library" value={savedTracks.length} valueStyle={styles.metricValueGreen} />
        </View>

        {playlist ? (
          <>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionEyebrow}>Playlist</Text>
              <View style={styles.playlistHeader}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image
                  source={toCachedImageSource(getTrackArtworkUrl(playlist.videos[0]?.id ?? "", playlist.thumbnailUrl, "player") ?? playlist.thumbnailUrl)}
                  style={styles.playlistImage}
                  resizeMode="cover"
                />
                <View style={styles.playlistCopy}>
                  <Text numberOfLines={2} style={styles.playlistTitle}>
                    {playlist.title}
                  </Text>
                  <Text style={styles.playlistMeta}>{playlist.videoCount} tracks ready to sort</Text>
                </View>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.playerHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>Preview player</Text>
                  <Text style={styles.sectionTitle}>Preview before saving</Text>
                </View>
                <View style={styles.playerModePill}>
                  <Text style={styles.playerModeText}>15s audio</Text>
                </View>
              </View>

              {currentPlayingVideo ? (
                <>
                  <Text numberOfLines={2} style={styles.nowPlayingTitle}>
                    {currentPlayingVideo.title}
                  </Text>
                  <Text style={styles.nowPlayingMeta}>{getArtistLine(currentPlayingVideo.title)}</Text>
                  <Pressable style={[styles.primaryButton, isPreviewLoading && styles.disabledButton]} onPress={() => void openPlayer(currentPlayingVideo.id)} disabled={isPreviewLoading}>
                    <Text style={styles.primaryButtonText}>{isPreviewLoading ? "Loading preview..." : "Play 15s preview"}</Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.emptyPlayer}>
                  <Text style={styles.emptyPlayerTitle}>Pick a song from the queue</Text>
                  <Text style={styles.emptyPlayerText}>Tap preview on any playlist row to play 15 seconds of audio.</Text>
                </View>
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionEyebrow}>Downloads</Text>
              <Text style={styles.sectionTitle}>Queue selected tracks</Text>
              <Text style={styles.sectionCopy}>
                Start the backend job, watch live progress, and move completed songs into your saved library.
              </Text>

              <Pressable
                style={[
                  styles.primaryButton,
                  (selectedVideoIds.length === 0 || isLoading) && styles.disabledButton,
                ]}
                onPress={handleDownloadSelected}
                disabled={selectedVideoIds.length === 0 || isLoading}
              >
                <Text style={styles.primaryButtonText}>
                  {isLoading ? "Preparing queue..." : `Download selected (${selectedVideoIds.length})`}
                </Text>
              </Pressable>

              {currentJobId && batchFinished && completedJobs.length > 0 ? (
                <Pressable style={styles.secondaryButton} onPress={handleOpenArchive}>
                  <Text style={styles.secondaryButtonText}>Open ready ZIP</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.libraryHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>Track library</Text>
                  <Text style={styles.sectionTitle}>Choose what to keep</Text>
                </View>
                <View style={styles.headerPills}>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{completedCount} ready</Text>
                  </View>
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{activeCount} active</Text>
                  </View>
                </View>
              </View>

              <View style={styles.selectionActions}>
                <Pressable
                  style={styles.secondaryButtonCompact}
                  onPress={() => setSelectedVideoIds(playlist.videos.map((video) => video.id))}
                >
                  <Text style={styles.secondaryButtonText}>Select all</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => setSelectedVideoIds([])}>
                  <Text style={styles.secondaryButtonText}>Clear</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => setActiveSection("library")}>
                  <Text style={styles.secondaryButtonText}>Open library</Text>
                </Pressable>
              </View>

              <FlatList
                data={playlist.videos}
                keyExtractor={(item) => item.id}
                renderItem={renderQueuePlaylistRow}
                scrollEnabled={false}
                contentContainerStyle={styles.songList}
                {...listPerfProps}
              />
            </View>

            {logs.length > 0 ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionEyebrow}>Latest logs</Text>
                <Text style={styles.sectionTitle}>Recent backend output</Text>
                <View style={styles.logCard}>
                  {logs.slice(-4).map((line, index) => (
                    <Text key={`${line}-${index}`} style={styles.logLine}>
                      {line}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Next step</Text>
            <Text style={styles.sectionTitle}>Fetch a playlist to start building the queue.</Text>
            <Text style={styles.sectionCopy}>
              Once a playlist is loaded, this screen will show preview controls, download progress, and song selection.
            </Text>
          </View>
        )}
      </>
    );
  }

  function renderLibrarySection() {
    return (
      <>
        <View style={styles.libraryTopBar}>
          <Pressable style={styles.libraryBackButton} onPress={() => setActiveSection("home")}>
            <Text style={styles.libraryBackIcon}>←</Text>
          </Pressable>
          <Text style={styles.libraryTopTitle}>Your Library</Text>
          <View style={styles.libraryTopBarSpacer} />
        </View>

        <View style={styles.libraryControlsCard}>
          <View style={styles.libraryActionRow}>
            <Pressable style={[styles.libraryIconAction, savedTracks.length === 0 && styles.disabledButton]} disabled={savedTracks.length === 0} onPress={handlePlayRandomTrack}>
              <Text style={styles.libraryIconActionText}>▶</Text>
            </Pressable>
            <Pressable style={styles.libraryIconAction} onPress={() => currentSavedTrack && setPlayerSheetOpen(true)}>
              <Text style={styles.libraryIconActionText}>⛶</Text>
            </Pressable>
            <Pressable style={[styles.libraryIconAction, isLooping && styles.loopButtonActive]} onPress={() => setIsLooping((current) => !current)}>
              <Text style={[styles.libraryIconActionText, isLooping && styles.loopButtonTextActive]}>↻</Text>
            </Pressable>
            <View style={styles.libraryPlayMainWrap}>
              <Pressable style={[styles.libraryPlayMainButton, savedTracks.length === 0 && styles.disabledButton]} onPress={handlePlayRandomTrack} disabled={savedTracks.length === 0}>
                <Text style={styles.libraryPlayMainText}>Play</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={[styles.repairButton, (isRepairingLibrary || savedTracks.length === 0) && styles.disabledButton]}
            onPress={() => void handleRepairUnplayableTracks()}
            disabled={isRepairingLibrary || savedTracks.length === 0}
          >
            <Text style={styles.repairButtonText}>
              {isRepairingLibrary ? "Repairing..." : "Repair unplayable songs"}
            </Text>
          </Pressable>

          <TextInput
            value={libraryQuery}
            onChangeText={setLibraryQuery}
            placeholder="Search your saved songs"
            placeholderTextColor="#6f6f76"
            style={styles.librarySearchInput}
            autoCapitalize="none"
          />

          <View style={styles.libraryChipsRow}>
            <Pressable style={[styles.libraryChip, librarySort === "recent" && styles.libraryChipActive]} onPress={() => setLibrarySort("recent")}>
              <Text style={[styles.libraryChipText, librarySort === "recent" && styles.libraryChipTextActive]}>Recent</Text>
            </Pressable>
            <Pressable style={[styles.libraryChip, librarySort === "title" && styles.libraryChipActive]} onPress={() => setLibrarySort("title")}>
              <Text style={[styles.libraryChipText, librarySort === "title" && styles.libraryChipTextActive]}>Sort</Text>
            </Pressable>
            <Pressable style={[styles.libraryChip, librarySort === "artist" && styles.libraryChipActive]} onPress={() => setLibrarySort("artist")}>
              <Text style={[styles.libraryChipText, librarySort === "artist" && styles.libraryChipTextActive]}>Artist</Text>
            </Pressable>
            <Pressable style={[styles.libraryChip, librarySort === "favorites" && styles.libraryChipActive]} onPress={() => setLibrarySort("favorites")}>
              <Text style={[styles.libraryChipText, librarySort === "favorites" && styles.libraryChipTextActive]}>Favorites</Text>
            </Pressable>
          </View>
        </View>

        {filteredSavedTracks.length > 0 ? (
          <FlatList
            data={filteredSavedTracks}
            keyExtractor={(item) => item.id}
            renderItem={renderLibraryListRow}
            scrollEnabled={false}
            contentContainerStyle={styles.libraryListWrap}
            {...listPerfProps}
          />
        ) : (
          <View style={styles.sectionCard}>
            <Text style={styles.emptyPlayerTitle}>No songs match that search</Text>
            <Text style={styles.emptyPlayerText}>Try another title, artist, or clear the search field.</Text>
          </View>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {renderAlerts()}
        {activeSection === "home"
          ? renderHomeSection()
          : activeSection === "search"
            ? renderSearchSection()
            : activeSection === "library"
              ? renderLibrarySection()
              : renderQueueSection()}
      </ScrollView>

      {currentSavedTrack ? (
        <View style={styles.miniPlayerDock}>
          <Pressable
            style={styles.miniPlayerMain}
            onPress={() => {
              Animated.sequence([
                Animated.timing(introOpacity, {
                  toValue: 0.72,
                  duration: 90,
                  useNativeDriver: true,
                }),
                Animated.timing(introOpacity, {
                  toValue: 1,
                  duration: 120,
                  useNativeDriver: true,
                }),
              ]).start(() => {
                setPlayerSheetOpen(true);
              });
            }}
          >
            {currentTrackArtwork ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image source={toCachedImageSource(currentTrackArtwork)} style={styles.miniPlayerImage} resizeMode="cover" />
            ) : (
              <View style={styles.miniPlayerFallback}>
                <Text style={styles.miniPlayerFallbackText}>A</Text>
              </View>
            )}
            <View style={styles.miniPlayerCopy}>
              <Text numberOfLines={1} style={styles.miniPlayerTitle}>
                {currentSavedTrack.title}
              </Text>
            </View>
          </Pressable>

          <View style={styles.miniPlayerActions}>
            <Pressable
              style={[styles.miniPlayerIconButton, currentSavedTrackIndex <= 0 && styles.disabledButton]}
              onPress={() => handlePlayAdjacent(-1)}
              disabled={currentSavedTrackIndex <= 0}
            >
              <Text style={styles.miniPlayerIconText}>{"<"}</Text>
            </Pressable>
            <Pressable style={styles.miniPlayerPlayButton} onPress={() => void handlePlaySavedTrack(currentSavedTrack.id)}>
              <Text style={styles.miniPlayerPlayText}>{playerStatus.playing ? "Pause" : "Play"}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.miniPlayerIconButton,
                (currentSavedTrackIndex < 0 || currentSavedTrackIndex >= savedTracks.length - 1) && styles.disabledButton,
              ]}
              onPress={() => handlePlayAdjacent(1)}
              disabled={currentSavedTrackIndex < 0 || currentSavedTrackIndex >= savedTracks.length - 1}
            >
              <Text style={styles.miniPlayerIconText}>{">"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.bottomTabBar}>
        <Pressable
          style={[styles.bottomTabButton, activeSection === "home" && styles.bottomTabButtonActive]}
          onPress={() => setActiveSection("home")}
        >
          <Text style={[styles.bottomTabIcon, activeSection === "home" && styles.bottomTabIconActive]}>⌂</Text>
          <Text style={[styles.bottomTabText, activeSection === "home" && styles.bottomTabTextActive]}>Home</Text>
        </Pressable>
        <Pressable
          style={[styles.bottomTabButton, activeSection === "search" && styles.bottomTabButtonActive]}
          onPress={() => setActiveSection("search")}
        >
          <Text style={[styles.bottomTabIcon, activeSection === "search" && styles.bottomTabIconActive]}>⌕</Text>
          <Text style={[styles.bottomTabText, activeSection === "search" && styles.bottomTabTextActive]}>Search</Text>
        </Pressable>
        <Pressable
          style={[styles.bottomTabButton, activeSection === "library" && styles.bottomTabButtonActive]}
          onPress={() => setActiveSection("library")}
        >
          <Text style={[styles.bottomTabIcon, activeSection === "library" && styles.bottomTabIconActive]}>▤</Text>
          <Text style={[styles.bottomTabText, activeSection === "library" && styles.bottomTabTextActive]}>Your Library</Text>
        </Pressable>
        <Pressable
          style={[styles.bottomTabButton, activeSection === "queue" && styles.bottomTabButtonActive]}
          onPress={() => setActiveSection("queue")}
        >
          <Text style={[styles.bottomTabIcon, activeSection === "queue" && styles.bottomTabIconActive]}>+</Text>
          <Text style={[styles.bottomTabText, activeSection === "queue" && styles.bottomTabTextActive]}>Queue</Text>
        </Pressable>
      </View>

      <Modal visible={playerSheetOpen} animationType="slide" onRequestClose={() => setPlayerSheetOpen(false)}>
        <SafeAreaView style={styles.playerSheetSafeArea}>
          <View style={styles.playerSheetTopRow}>
            <Pressable style={styles.playerSheetTopIcon} onPress={() => setPlayerSheetOpen(false)}>
              <Text style={styles.playerSheetTopIconText}>⌄</Text>
            </Pressable>
            <View style={styles.playerSheetModeSwitch}>
              <Pressable
                style={[styles.playerSheetModeTab, playerSheetMode === "song" && styles.playerSheetModeTabActive]}
                onPress={() => setPlayerSheetMode("song")}
              >
                <Text style={[styles.playerSheetModeText, playerSheetMode === "song" && styles.playerSheetModeTextActive]}>
                  Song
                </Text>
              </Pressable>
              <Pressable
                style={[styles.playerSheetModeTab, playerSheetMode === "video" && styles.playerSheetModeTabActive]}
                onPress={() => {
                  if (playerStatus.playing) {
                    void safePausePlayer();
                  }
                  setPlayerSheetMode("video");
                }}
              >
                <Text style={[styles.playerSheetModeText, playerSheetMode === "video" && styles.playerSheetModeTextActive]}>
                  Video
                </Text>
              </Pressable>
            </View>
            <Pressable style={styles.playerSheetTopIcon}>
              <Text style={styles.playerSheetTopIconText}>⋮</Text>
            </Pressable>
          </View>

          {currentSavedTrack ? (
            <>
              {playerSheetMode === "song" ? (
                currentTrackArtwork ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image source={toCachedImageSource(currentTrackArtwork)} style={styles.playerSheetArtwork} resizeMode="cover" />
                ) : (
                  <View style={styles.playerSheetFallback}>
                    <Text style={styles.playerSheetFallbackText}>VELIXA</Text>
                  </View>
                )
              ) : (
                <View style={styles.playerSheetVideoWrap}>
                  <WebView
                    source={{
                      uri: `https://www.youtube.com/embed/${encodeURIComponent(currentSavedTrack.videoId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1`,
                    }}
                    style={styles.playerSheetVideo}
                    originWhitelist={["https://*"]}
                    javaScriptEnabled
                    domStorageEnabled
                    allowsFullscreenVideo
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    scalesPageToFit={false}
                  />
                </View>
              )}

              <Text style={styles.playerSheetTitle}>{currentSavedTrack.title}</Text>
              {playerSheetMode === "song" ? (
                <>
                  <View style={styles.playerSheetActionRow}>
                    <Pressable style={styles.playerSheetActionChip}>
                      <Text style={styles.playerSheetActionText}>♡ 22K</Text>
                    </Pressable>
                    <Pressable style={styles.playerSheetActionChip}>
                      <Text style={styles.playerSheetActionText}>💬 600</Text>
                    </Pressable>
                    <Pressable style={styles.playerSheetActionChip}>
                      <Text style={styles.playerSheetActionText}>＋ Save</Text>
                    </Pressable>
                  </View>

                  <View style={styles.playerSheetTimeline}>
                    <Slider
                      value={displayedPlaybackTime}
                      minimumValue={0}
                      maximumValue={sliderMax}
                      minimumTrackTintColor="#ffffff"
                      maximumTrackTintColor="rgba(255,255,255,0.2)"
                      thumbTintColor="#ffffff"
                      onValueChange={setScrubTime}
                      onSlidingComplete={(value) => void handleSeekComplete(value)}
                    />
                    <View style={styles.playbackTimeRow}>
                      <Text style={styles.playbackTimeText}>{formatPlaybackTime(displayedPlaybackTime)}</Text>
        <Text style={styles.playbackTimeText}>
                        {isCurrentTrackStalled ? "Not loaded" : formatPlaybackTime(playerStatus.duration)}
                      </Text>
                    </View>
                  </View>
                  {playbackAssistText ? (
                    <View style={styles.playerAssistRow}>
                      {isPlaybackAssistBusy ? <ActivityIndicator size="small" color="#1ed760" /> : null}
                      <Text
                        style={[
                          styles.playerAssistText,
                          playbackAssistPhase === "failed" && styles.playerAssistTextError,
                          playbackAssistPhase === "done" && styles.playerAssistTextSuccess,
                        ]}
                      >
                        {playbackAssistText}
                      </Text>
                    </View>
                  ) : null}
                  {libraryError ? <Text style={styles.songError}>{libraryError}</Text> : null}

                  <View style={styles.playerSheetTransportRow}>
                    <Pressable style={styles.playerSheetTransportIcon} onPress={() => setIsLooping((current) => !current)}>
                      <Text style={styles.playerSheetTransportIconText}>{isLooping ? "↻" : "⇄"}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.playerSheetTransportIcon, currentSavedTrackIndex <= 0 && styles.disabledButton]}
                      onPress={() => handlePlayAdjacent(-1)}
                      disabled={currentSavedTrackIndex <= 0}
                    >
                      <Text style={styles.playerSheetTransportIconText}>⏮</Text>
                    </Pressable>
                    <Pressable style={styles.playerSheetPlayButton} onPress={() => void handlePlaySavedTrack(currentSavedTrack.id)}>
                      <Text style={styles.playerSheetPlayButtonText}>{playerStatus.playing ? "❚❚" : "▶"}</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.playerSheetTransportIcon,
                        (currentSavedTrackIndex < 0 || currentSavedTrackIndex >= savedTracks.length - 1) && styles.disabledButton,
                      ]}
                      onPress={() => handlePlayAdjacent(1)}
                      disabled={currentSavedTrackIndex < 0 || currentSavedTrackIndex >= savedTracks.length - 1}
                    >
                      <Text style={styles.playerSheetTransportIconText}>⏭</Text>
                    </Pressable>
                    <Pressable style={styles.playerSheetTransportIcon} onPress={handlePlayRandomTrack}>
                      <Text style={styles.playerSheetTransportIconText}>↺</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <View style={styles.emptyPlayer}>
                  <Text style={styles.emptyPlayerTitle}>Video mode</Text>
                  <Text style={styles.emptyPlayerText}>Streaming YouTube video for this track.</Text>
                </View>
              )}

              <View style={styles.playerSheetBottomTabs}>
                <Text style={styles.playerSheetBottomTabText}>UP NEXT</Text>
                <Text style={styles.playerSheetBottomTabText}>LYRICS</Text>
                <Text style={styles.playerSheetBottomTabText}>RELATED</Text>
              </View>
            </>
          ) : (
            <View style={styles.emptyPlayer}>
              <Text style={styles.emptyPlayerTitle}>No track active</Text>
              <Text style={styles.emptyPlayerText}>Play a saved song from Velixa to open the full player.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={playerOpen}
        animationType="slide"
        onRequestClose={() => {
          previewTokenRef.current += 1;
          if (previewTimeoutRef.current) {
            clearTimeout(previewTimeoutRef.current);
            previewTimeoutRef.current = null;
          }
          void safePausePlayer();
          setPlayerOpen(false);
        }}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>Audio preview</Text>
              <Text style={styles.modalTitle}>{currentPlayingVideo?.title ?? "Velixa Player"}</Text>
            </View>
            <Pressable
              style={styles.secondaryButtonCompact}
              onPress={() => {
                previewTokenRef.current += 1;
                if (previewTimeoutRef.current) {
                  clearTimeout(previewTimeoutRef.current);
                  previewTimeoutRef.current = null;
                }
                void safePausePlayer();
                setPlayerOpen(false);
              }}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>

          {currentPlayingVideo ? (
            <>
              <Text style={styles.modalMeta}>{getArtistLine(currentPlayingVideo.title)}</Text>
              <View style={styles.emptyPlayer}>
                <Text style={styles.emptyPlayerTitle}>
                  {isPreviewLoading ? "Loading preview..." : "Playing first 15 seconds"}
                </Text>
                <Text style={styles.emptyPlayerText}>
                  {isPreviewLoading
                    ? "Fetching stream URL and buffering audio."
                    : "Preview will stop automatically after 15 seconds."}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.emptyPlayer}>
              <Text style={styles.emptyPlayerTitle}>No song selected</Text>
              <Text style={styles.emptyPlayerText}>Go back and tap play on a track card.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {showStartupIntro ? (
        <Animated.View pointerEvents="none" style={[styles.introOverlay, { opacity: introOpacity }]}>
          <Text style={styles.introSimpleWordmark}>Velixa</Text>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}
