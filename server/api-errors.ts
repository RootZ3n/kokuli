import type { NextFunction, Request, Response } from "express";

type ApiErrorWithStatus = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
};

function isApiRequest(req: Request): boolean {
  return req.path === "/api" || req.path.startsWith("/api/");
}

function isMalformedJsonError(err: ApiErrorWithStatus): boolean {
  return err instanceof SyntaxError && err.type === "entity.parse.failed";
}

function statusFromError(err: ApiErrorWithStatus): number {
  const status = err.statusCode ?? err.status ?? 500;
  if (!Number.isInteger(status) || status < 400 || status > 599) return 500;
  return status;
}

function clientErrorPayload(err: ApiErrorWithStatus): { status: number; error: string; message: string } {
  if (isMalformedJsonError(err)) {
    return {
      status: 400,
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    };
  }

  const status = statusFromError(err);
  if (status === 413 || err.type === "entity.too.large") {
    return {
      status: 413,
      error: "payload_too_large",
      message: "Request body is too large.",
    };
  }

  if (status >= 500) {
    return {
      status,
      error: "internal_error",
      message: "The request could not be completed.",
    };
  }

  return {
    status,
    error: "request_error",
    message: "The request could not be processed.",
  };
}

export function apiErrorHandler(err: ApiErrorWithStatus, req: Request, res: Response, next: NextFunction): void {
  if (!isApiRequest(req)) {
    next(err);
    return;
  }

  if (res.headersSent) {
    next(err);
    return;
  }

  const payload = clientErrorPayload(err);
  if (payload.status >= 500) {
    console.error("[verum-api] request failed", {
      method: req.method,
      path: req.path,
      status: payload.status,
      type: err.type || err.name,
    });
  }

  res.status(payload.status).json({
    ok: false,
    error: payload.error,
    message: payload.message,
  });
}
