export interface VideoItem {
  id: string;
  title: string;
  duration: string;
  thumbnailUrl: string;
}

export interface PlaylistMetadata {
  id: string;
  title: string;
  thumbnailUrl: string;
  videoCount: number;
  videos: VideoItem[];
}

export interface DownloadJob {
  videoId: string;
  title: string;
  status: "pending" | "downloading" | "completed" | "failed";
  progress: number;
  error?: string;
  filePath?: string;
}

export interface SavedTrack {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  isFavorite: boolean;
  order: number;
  duration?: string;
  thumbnailUrl?: string;
  filePath: string;
  localUri: string;
  fileName: string;
  downloadedAt: string;
}
