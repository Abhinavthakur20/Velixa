import { NextRequest } from "next/server";
import { env } from "@/lib/env";

interface RateBucket {
  count: number;
  resetAt: number;
}

const requestBuckets = new Map<string, RateBucket>();

interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

export function applyRateLimit(
  request: NextRequest,
  keyPrefix: string,
  options: RateLimitOptions = {},
): boolean {
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();

  const current = requestBuckets.get(key);
  if (!current || now > current.resetAt) {
    requestBuckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count += 1;
  requestBuckets.set(key, current);
  return true;
}
