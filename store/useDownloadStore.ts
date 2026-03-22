"use client";

import { create } from "zustand";
import type { DownloadJob, PlaylistMetadata } from "@/types";

interface DownloadStoreState {
  playlist: PlaylistMetadata | null;
  playlistUrl: string;
  currentJobId: string | null;
  selectedVideoIds: string[];
  jobs: DownloadJob[];
  isLoading: boolean;
  error: string | null;
  logs: string[];
  setPlaylist: (p: PlaylistMetadata, playlistUrl: string) => void;
  setCurrentJobId: (jobId: string | null) => void;
  toggleVideoSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setJobs: (jobs: DownloadJob[]) => void;
  updateJob: (videoId: string, update: Partial<DownloadJob>) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  setLogs: (logs: string[]) => void;
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  playlist: null,
  playlistUrl: "",
  currentJobId: null,
  selectedVideoIds: [],
  jobs: [],
  isLoading: false,
  error: null,
  logs: [],
  setPlaylist: (playlist, playlistUrl) =>
    set({ playlist, playlistUrl, currentJobId: null, selectedVideoIds: [], jobs: [], logs: [], error: null }),
  setCurrentJobId: (currentJobId) => set({ currentJobId }),
  toggleVideoSelection: (id) =>
    set((state) => ({
      selectedVideoIds: state.selectedVideoIds.includes(id)
        ? state.selectedVideoIds.filter((item) => item !== id)
        : [...state.selectedVideoIds, id],
    })),
  selectAll: () => {
    const playlist = get().playlist;
    if (!playlist) return;
    set({ selectedVideoIds: playlist.videos.map((video) => video.id) });
  },
  deselectAll: () => set({ selectedVideoIds: [] }),
  setJobs: (jobs) => set({ jobs: Array.isArray(jobs) ? jobs : [] }),
  updateJob: (videoId, update) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.videoId === videoId ? { ...job, ...update } : job)),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setLogs: (logs) => set({ logs }),
}));
