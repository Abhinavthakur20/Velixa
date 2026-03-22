import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimit } from "@/lib/rateLimit";
import {
  getPlaylistMetadata,
  PlaylistFetchError,
  PlaylistValidationError,
} from "@/services/playlistService";

const schema = z.object({ url: z.string() });

function sanitizeErrorMessage(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s"]+|\/[^\s"]+/g, "[path]");
}

export async function POST(request: NextRequest) {
  if (!applyRateLimit(request, "playlist")) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const data = await getPlaylistMetadata(parsed.data.url);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof PlaylistValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PlaylistFetchError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: sanitizeErrorMessage(error instanceof Error ? error.message : "Unexpected error") },
      { status: 500 },
    );
  }
}
