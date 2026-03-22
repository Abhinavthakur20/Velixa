import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { applyRateLimit } from "@/lib/rateLimit";
import { DownloadDependencyError, ensureDownloadDependencies } from "@/lib/ytDlp";
import { getJobLogs, getJobStatus, queueDownloads } from "@/services/downloadService";
import { validateDownloadRequest } from "@/utils/validators";

function sanitizeErrorMessage(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s"]+|\/[^\s"]+/g, "[path]");
}

export async function POST(request: NextRequest) {
  if (!applyRateLimit(request, "download:post")) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const data = validateDownloadRequest(body);
    ensureDownloadDependencies();
    const jobId = queueDownloads(data);
    return NextResponse.json({ jobId });
  } catch (error) {
    if (error instanceof DownloadDependencyError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: sanitizeErrorMessage(error instanceof Error ? error.message : "Invalid request") },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  // Polling happens frequently; keep limits, but use a higher threshold for status checks.
  if (
    !applyRateLimit(request, "download:get", {
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS * 20,
    })
  ) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const includeLogs = searchParams.get("includeLogs") === "true";
  const jobs = getJobStatus(jobId);

  if (includeLogs) {
    return NextResponse.json({ jobs, logs: getJobLogs(jobId) });
  }

  return NextResponse.json(jobs);
}
