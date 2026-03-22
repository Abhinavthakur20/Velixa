import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

const downloadsDir = path.resolve(process.cwd(), env.DOWNLOADS_DIR);
const DOWNLOADABLE_EXTENSIONS = new Set([".m4a", ".webm", ".mp3", ".opus", ".ogg", ".wav", ".aac"]);

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".m4a":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".webm":
      return "audio/webm";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".aac":
      return "audio/aac";
    case ".opus":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

async function findFileByVideoId(videoId: string): Promise<string | null> {
  const stack = [downloadsDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.includes(`[${videoId}]`) &&
        DOWNLOADABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        return fullPath;
      }
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  const filePath = request.nextUrl.searchParams.get("path");

  let resolvedPath: string | null = null;

  if (videoId) {
    resolvedPath = await findFileByVideoId(videoId);
  } else if (filePath) {
    const candidatePath = path.resolve(downloadsDir, filePath);
    if (!candidatePath.startsWith(`${downloadsDir}${path.sep}`)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }
    resolvedPath = candidatePath;
  } else {
    return NextResponse.json({ error: "Missing file identifier" }, { status: 400 });
  }

  if (!resolvedPath) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const file = await fs.readFile(resolvedPath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": getContentType(resolvedPath),
        "Content-Disposition": `attachment; filename="${path.basename(resolvedPath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
