import { Request, Response } from "express";

export function isLoopbackAddress(value?: string): boolean {
  if (!value) return false;
  const normalized = value.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function isLocalRequest(req: Request): boolean {
  return isLoopbackAddress(req.ip) || isLoopbackAddress(req.socket.remoteAddress);
}

export function apiTokenMatches(headers: Pick<Request, "headers">["headers"], expectedToken = process.env.VERUM_API_TOKEN): boolean {
  if (!expectedToken) return true;
  const headerToken = headers["x-verum-api-token"];
  const candidate = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (candidate === expectedToken) return true;
  const auth = headers.authorization;
  if (typeof auth === "string" && auth === `Bearer ${expectedToken}`) return true;
  return false;
}

export function requireLocalAccess(req: Request, res: Response, label: string): boolean {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: `${label} is only available from localhost.` });
    return false;
  }

  if (!apiTokenMatches(req.headers)) {
    res.status(403).json({ error: `${label} requires a valid VERUM_API_TOKEN.` });
    return false;
  }

  return true;
}
