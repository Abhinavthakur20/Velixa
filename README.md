# Velixa

Velixa is a Next.js full-stack app that fetches playlist metadata and downloads selected YouTube playlist items as mobile-safe audio files using `yt-dlp` with a bundled `ffmpeg` binary.

## Prerequisites

- Node.js 18+
- `yt-dlp`

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Mobile App

A React Native version now lives in [`mobile/`](./mobile).

From the repo root you can use:

```bash
npm run mobile:start
```

The mobile app expects the web backend to be running and reachable from your phone or emulator.
Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to your machine's LAN IP, for example:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:3000
```

## Environment

Copy `.env.example` to `.env.local` and adjust values if needed.
If you want to use a custom ffmpeg binary instead of the bundled one, set `FFMPEG_PATH`.

## Notes

- Downloads are written to `downloads/`.
- Downloads are converted to `.mp3` so the mobile player can play the full queue reliably.
- Structured logs are written to `logs/app.log`.
- API requests are rate limited in-memory per IP.
- The mobile app opens single-file and ZIP delivery through the same backend endpoints.
