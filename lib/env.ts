import { z } from "zod";

const envSchema = z.object({
  DOWNLOADS_DIR: z.string().default("./downloads"),
  LOGS_DIR: z.string().default("./logs"),
  YTDLP_COOKIES_PATH: z.string().optional(),
  YTDLP_COOKIES_CONTENT: z.string().optional(),
  MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().positive().default(2),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
  );
}

export const env = parsed.data;
