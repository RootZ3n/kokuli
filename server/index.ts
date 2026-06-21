import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs-extra";
import { velumExpress } from "velum-ai/adapters/express";
import apiRouter from "./api";
import pingRouter from "./kokuli-ping";
import { apiErrorHandler } from "./api-errors";
import { logger, tailLog } from "../engine/logger";
import { loadLedger } from "../engine/ledger";
import { recoverStaleArmoryRuns } from "./ops/armory";

const app = express();
const PORT = parseInt(process.env.KOKULI_PORT || process.env.VERUM_PORT || process.env.KRAKZEN_PORT || "3000", 10);
const BIND_ALL = (process.env.KOKULI_BIND_ALL || process.env.VERUM_BIND_ALL) === "1";
const HOSTS = BIND_ALL
  ? ["0.0.0.0"]
  : (process.env.KOKULI_HOST || process.env.VERUM_HOST || "127.0.0.1")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
const SERVER_STARTED_AT = new Date().toISOString();
const PACKAGE_VERSION = (() => {
  try {
    const pkg = fs.readJsonSync(path.join(process.cwd(), "package.json")) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// --- Security middleware ---

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Remove X-Powered-By
  res.removeHeader("X-Powered-By");

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:;"
  );
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // CORS — same-origin only (no Access-Control-Allow-Origin header = no cross-origin access)
  // Explicitly block CORS preflight requests
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

// --- Rate limiter ---

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_READ = 120;
const RATE_LIMIT_WRITE = 60;

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const isWrite = ["POST", "PUT", "DELETE", "PATCH"].includes(req.method);
  const limit = isWrite ? RATE_LIMIT_WRITE : RATE_LIMIT_READ;
  const bucketKey = `${ip}:${isWrite ? "write" : "read"}`;

  const now = Date.now();
  let bucket = rateBuckets.get(bucketKey);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(bucketKey, bucket);
  }

  bucket.count++;

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > limit) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  next();
}

// Clean up stale rate limit buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60_000).unref();

// --- App setup ---

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use(apiErrorHandler);

// Velum: AI privacy/injection defense middleware.
// velumExpress uses zero-dep structural req/res/next types; cast to Express's
// RequestHandler (shapes match at runtime) so app.use type-checks.
app.use(velumExpress({ defaultPiiLevel: 2 }) as unknown as express.RequestHandler);

// Rate limit API endpoints
app.use("/api", rateLimiter);

// API routes (before static so they take priority)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// GET /kokuli/ping — simple liveness check
app.use("/", pingRouter);

app.get("/api/meta", (_req, res) => {
  res.json({
    version: PACKAGE_VERSION,
    serverStartedAt: SERVER_STARTED_AT,
    pid: process.pid,
  });
});

// GET /api/meta/logs — tail of the server log file (last 100 lines).
// Gives operators visibility into a detached background process (C1).
app.get("/api/meta/logs", (req, res) => {
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
  try {
    res.json({ entries: tailLog(n) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.use("/api", apiRouter);
app.use(apiErrorHandler);

app.use(express.static(path.join(__dirname, "public")));
app.use("/reports", express.static(path.join(process.cwd(), "reports")));

// The Investigation — Pehverse world engine (noir private-investigator UI).
// Served straight from the repo's ui/ directory (it is NOT bundled into
// dist/server/public). Same-origin with /api, so ui/api.js stays inside the
// server's connect-src 'self' CSP. Reach it at /world (run on port 18800).
app.use("/world", express.static(path.join(process.cwd(), "ui")));

// HTML page routes
app.get("/atlantis", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "atlantis.html"));
});

app.get("/bridge/runs", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "bridge-runs.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Startup reconciliation ---
// In-memory state does not survive a restart, so reconcile persisted state
// before serving traffic:
//   - hydrate the ledger (legacy array -> JSONL + retention caps) (H1/H2)
//   - mark any Armory run left "running" by a previous process as failed (H4)
// The bridge's activeRuns map is purely in-memory, so a restart already clears
// any leaked sweep lock — no disk reconciliation needed there (C3).
void (async () => {
  try {
    await loadLedger();
  } catch (err) {
    logger.error("kokuli-web", "Ledger initialization failed", err);
  }
  try {
    const recovered = await recoverStaleArmoryRuns();
    if (recovered.recovered) {
      logger.warn("kokuli-web", `Recovered stale Armory run ${recovered.runId} left by a previous process.`);
    }
  } catch (err) {
    logger.error("kokuli-web", "Armory stale-run recovery failed", err);
  }
})();

for (const host of HOSTS) {
  app.listen(PORT, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    logger.info("kokuli-web", `Dashboard:     http://${displayHost}:${PORT}`);
    logger.info("kokuli-web", `Investigation: http://${displayHost}:${PORT}/world`);
    logger.info("kokuli-web", `Atlantis:      http://${displayHost}:${PORT}/atlantis`);
    logger.info("kokuli-web", `API:           http://${displayHost}:${PORT}/api`);
  });
}
if (BIND_ALL) {
  logger.warn("kokuli-web", "KOKULI_BIND_ALL=1 (or VERUM_BIND_ALL=1) exposes the dashboard beyond localhost.");
}
