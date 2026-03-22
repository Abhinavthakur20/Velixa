import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimit } from "@/lib/rateLimit";
import { fetchPreviewAudioUrl } from "@/lib/ytDlp";

const schema = z.object({
  videoId: z.string().min(1),
});

function sanitizeErrorMessage(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s"]+|\/[^\s"]+/g, "[path]");
}

export async function POST(request: NextRequest) {
  if (!applyRateLimit(request, "preview")) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const url = await fetchPreviewAudioUrl(parsed.data.videoId);
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error instanceof Error ? error.message : "Unable to fetch preview audio") },
      { status: 502 },
    );
  }
}
