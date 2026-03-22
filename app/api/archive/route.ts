import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createZipBuffer } from "@/lib/zip";
import { getJobDownloadFiles } from "@/services/downloadService";

function sanitizeArchiveName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "velixa-downloads";
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  const title = request.nextUrl.searchParams.get("title") ?? "velixa-downloads";

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const files = getJobDownloadFiles(jobId);
  if (files.length === 0) {
    return NextResponse.json({ error: "No completed files available for this job" }, { status: 404 });
  }

  const entries = await Promise.all(
    files.map(async (file) => ({
      name: path.basename(file.filePath),
      data: await fs.readFile(file.filePath),
    })),
  );

  const archive = createZipBuffer(entries);
  const fileName = `${sanitizeArchiveName(title)}.zip`;

  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
