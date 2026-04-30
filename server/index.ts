import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs-extra";
import apiRouter from "./api";
import { requireLocalAccess } from "./access";
import { apiErrorHandler } from "./api-errors";

const app = express();
const PORT = parseInt(process.env.VERUM_PORT || process.env.KRAKZEN_PORT || "3000", 10);
const HOST = process.env.VERUM_BIND_ALL === "1"
  ? "0.0.0.0"
  : (process.env.VERUM_HOST || "127.0.0.1");
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

// Rate limit API endpoints
app.use("/api", rateLimiter);

// API routes (before static so they take priority)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    version: PACKAGE_VERSION,
    serverStartedAt: SERVER_STARTED_AT,
    pid: process.pid,
  });
});

app.use("/api", apiRouter);
app.use(apiErrorHandler);

app.use(express.static(path.join(__dirname, "public")));
app.use("/reports", (req, res, next) => {
  if (!requireLocalAccess(req, res, "Reports")) return;
  next();
}, express.static(path.join(process.cwd(), "reports")));

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

app.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`[verum-web] Dashboard:  http://${displayHost}:${PORT}`);
  console.log(`[verum-web] Atlantis:   http://${displayHost}:${PORT}/atlantis`);
  console.log(`[verum-web] API:        http://${displayHost}:${PORT}/api`);
  if (HOST === "0.0.0.0") {
    console.log("[verum-web] Warning: VERUM_BIND_ALL=1 exposes the dashboard beyond localhost.");
  }
});
