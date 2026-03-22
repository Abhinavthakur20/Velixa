# Velixa Mobile

Expo-based React Native app for the Velixa backend.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and set:

```bash
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:3000
```

Use your computer's LAN IP, not `localhost`, when testing on a phone.

3. Start the app:

```bash
npm run start
```

This project now targets Expo SDK 54, so it should open in the current Expo Go app.
If you still see an SDK mismatch on a device, update Expo Go and restart the Metro server.
For a clean restart that clears old Metro state, run:

```bash
npm run start:clear
```

## What it does

- Fetches playlist metadata from the existing Velixa backend
- Lets you select tracks and queue downloads
- Saves finished downloads into an on-device in-app library
- Plays saved songs back inside the app
- Separates downloading and listening into distinct app sections
- Uses a Spotify-inspired Home, Search, and Library shell for playback-first navigation
- Polls job progress
- Streams track previews in-app with a YouTube web player
- Opens ZIP and single-file downloads through the backend

## Backend requirement

The existing Next.js app must be running and reachable from the mobile device.
