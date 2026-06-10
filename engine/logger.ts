/**
 * Kokuli — file logger (C1)
 *
 * The web server runs as a detached background process with no controlling
 * terminal, so everything written to stdout/stderr is discarded. Operators had
 * zero visibility into startup warnings, test-execution errors, crash traces,
 * Armory progress, or bridge failures.
 *
 * This module mirrors every log call to BOTH the console (for interactive /
 * foreground use) and an append-only JSON-lines file at `reports/server.log`.
 *
 * Each line is a self-contained JSON object:
 *   { "timestamp": ISO8601, "level": "info", "component": "kokuli-web", "message": "..." }
 *
 * Secrets are redacted before anything is written. The file is rotated to
 * `server.log.1` once it crosses 10 MB so a long-lived server cannot fill the
 * disk. The logger never throws — a logging failure must not take down a request.
 */

import fs from "fs";
import path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
}

/** Rotate once the active log file crosses this size. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB

function logPath(): string {
  return path.join(process.cwd(), "reports", "server.log");
}

function rotatedPath(): string {
  // Audit spec: rename to `.log.1`. server.log -> server.log.1
  return `${logPath()}.1`;
}

// --- Secret redaction ---
//
// Best-effort masking of credentials that might end up in a log line (e.g. a
// stringified request, an axios error, an env dump). Conservative: it would
// rather over-redact a token-looking string than leak a real one.

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>  /  "authorization": "<token>"
  [/(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._\-]{6,}/gi, "$1$2[REDACTED]"],
  // Bearer <token> anywhere
  [/(bearer\s+)[A-Za-z0-9._\-]{6,}/gi, "$1[REDACTED]"],
  // OpenAI-style keys: sk-..., sk-proj-...
  [/\bsk-(?:proj-)?[A-Za-z0-9]{8,}\b/g, "[REDACTED]"],
  // key/token/secret/password = <value>  (quoted or bare)
  [/((?:api[_-]?key|apikey|token|secret|password|passwd|auth[_-]?token)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1[REDACTED]"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function stringifyDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? detail.message;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size >= MAX_LOG_BYTES) {
      // Overwrites any previous .log.1 — single-generation rotation.
      fs.renameSync(file, rotatedPath());
    }
  } catch {
    // File does not exist yet, or stat/rename failed — nothing to rotate.
  }
}

export interface WriteLogOptions {
  /** Extra detail (Error, object, string) folded into the message. */
  detail?: unknown;
  /** Mirror to the console. Defaults to true. */
  console?: boolean;
}

/** Core entry point. Mirrors to console (unless disabled) and appends to the file. */
export function writeLog(
  level: LogLevel,
  component: string,
  message: string,
  options: WriteLogOptions = {},
): void {
  const detailStr = options.detail !== undefined ? ` ${stringifyDetail(options.detail)}` : "";
  const fullMessage = redactSecrets(`${message}${detailStr}`);
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message: fullMessage,
  };

  if (options.console !== false) {
    const line = `[${entry.timestamp}] [${level.toUpperCase()}] [${component}] ${fullMessage}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file);
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never let a logging failure escape into the request path.
  }
}

export const logger = {
  debug: (component: string, message: string, detail?: unknown) =>
    writeLog("debug", component, message, { detail }),
  info: (component: string, message: string, detail?: unknown) =>
    writeLog("info", component, message, { detail }),
  warn: (component: string, message: string, detail?: unknown) =>
    writeLog("warn", component, message, { detail }),
  error: (component: string, message: string, detail?: unknown) =>
    writeLog("error", component, message, { detail }),
  /** File-only variant: persist without echoing to the console. */
  fileOnly: (level: LogLevel, component: string, message: string, detail?: unknown) =>
    writeLog(level, component, message, { detail, console: false }),
};

/**
 * Read back the last `n` parsed log entries (newest last). Malformed lines are
 * skipped. Used by GET /api/meta/logs. Reads both the rotated `.log.1` and the
 * active `server.log` so a recent rotation does not hide the latest history.
 */
export function tailLog(n = 100): LogEntry[] {
  const files = [rotatedPath(), logPath()];
  const lines: string[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      for (const line of raw.split("\n")) {
        if (line.trim()) lines.push(line);
      }
    } catch {
      // Missing file — skip.
    }
  }
  const tail = lines.slice(-n);
  const entries: LogEntry[] = [];
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip malformed line.
    }
  }
  return entries;
}
