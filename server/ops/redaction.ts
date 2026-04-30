import { parseNmapOutput } from "./parser";
import type { ArmoryTarget } from "./armory";

const SAFE_SNIPPET_CHARS = 240;

export function targetClass(target: ArmoryTarget): "localhost" | "private-lab" | "external-blocked" {
  const host = target.host.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "localhost";
  if (target.beginnerSafe) return "private-lab";
  return "external-blocked";
}

export function redactSensitiveText(input: string, maxChars = SAFE_SNIPPET_CHARS): string {
  if (!input) return "";
  let text = String(input);

  text = text.replace(/\bAuthorization\s*:\s*[^\r\n,}]+/gi, "Authorization: [REDACTED]");
  text = text.replace(/\bCookie\s*:\s*[^\r\n,}]+/gi, "Cookie: [REDACTED]");
  text = text.replace(/\bSet-Cookie\s*:\s*[^\r\n,}]+/gi, "Set-Cookie: [REDACTED]");
  text = text.replace(/\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]");
  text = text.replace(/\b(session[_-]?id|sid|csrf|xsrf|jwt|api[_-]?key|token|secret|password|passwd)\s*[:=]\s*["']?[^"'\s,;}]+/gi, "$1=[REDACTED]");
  text = text.replace(/\b[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)\s*=\s*.+/g, "[REDACTED_ENV_ASSIGNMENT]");
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  text = text.replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[REDACTED]");
  text = text.replace(/\b[A-Za-z0-9+/=]{48,}\b/g, "[REDACTED_TOKEN]");
  text = text.replace(/(?:\/home\/[A-Za-z0-9._-]+|\/mnt\/[A-Za-z0-9._/-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)[^\s"',;)]*/g, "[REDACTED_PATH]");

  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}...[TRUNCATED]`;
  }
  return text;
}

export function sanitizeReceiptArgs(tool: string, args: string[], target: ArmoryTarget): string[] {
  const klass = targetClass(target);
  if (tool === "nmap") {
    return args.map((arg) => arg === target.host ? `[${klass}]` : arg);
  }
  if (tool === "http-probe") {
    return args.map((_arg, index) => `[${klass}-candidate-${index + 1}]`);
  }
  return args.map((arg) => redactSensitiveText(arg, 80));
}

export function sanitizeArmoryRawOutput(tool: string, rawOutput: string, target: ArmoryTarget): string {
  if (tool === "nmap") {
    const parsed = parseNmapOutput(rawOutput);
    return JSON.stringify({
      kind: "nmap-summary",
      targetClass: targetClass(target),
      openPorts: parsed.openPorts.map((port) => ({
        port: port.port,
        protocol: port.protocol,
        state: port.state,
        service: redactSensitiveText(port.service, 80),
      })),
      warnings: parsed.warnings.map((warning) => redactSensitiveText(warning, 120)),
      parserWarningCount: parsed.parserWarnings.length,
      degraded: parsed.degraded,
      analyzedLineCount: parsed.analyzedLineCount,
    }, null, 2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return redactSensitiveText(rawOutput);
  }

  if (parsed && typeof parsed === "object") {
    const input = parsed as Record<string, unknown>;
    return JSON.stringify({
      kind: `${tool}-summary`,
      targetClass: targetClass(target),
      matchedPath: typeof input.matchedPath === "string" ? input.matchedPath : undefined,
      statusCode: typeof input.statusCode === "number" ? input.statusCode : undefined,
      discoveredCount: Array.isArray(input.discovered) ? input.discovered.length : undefined,
      responseSnippet: typeof input.responseText === "string" ? redactSensitiveText(input.responseText) : undefined,
    }, null, 2);
  }

  return redactSensitiveText(String(rawOutput));
}
