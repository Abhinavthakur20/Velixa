import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { env } from "@/lib/env";

const logDir = path.resolve(process.cwd(), env.LOGS_DIR);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = pino(
  {
    level: "info",
    redact: ["req.headers.authorization"],
  },
  pino.destination(path.join(logDir, "app.log")),
);
