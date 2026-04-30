import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText, sanitizeArmoryRawOutput, sanitizeReceiptArgs, targetClass } from "./redaction";
import type { ArmoryTarget } from "./armory";

const localhostTarget: ArmoryTarget = {
  kind: "local-port",
  display: "localhost:3000",
  host: "localhost",
  port: 3000,
  url: "http://localhost:3000",
  beginnerSafe: true,
};

test("redactSensitiveText removes auth headers cookies env assignments keys and local paths", () => {
  const raw = [
    "Authorization: Bearer secret-token-value",
    "Cookie: session_id=abc123; csrftoken=def456",
    "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
    "JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghi",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    "/home/zen/private/project/.env",
  ].join("\n");

  const redacted = redactSensitiveText(raw, 1000);
  assert.doesNotMatch(redacted, /secret-token-value/);
  assert.doesNotMatch(redacted, /session_id=abc123/);
  assert.doesNotMatch(redacted, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(redacted, /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(redacted, /\/home\/zen/);
  assert.match(redacted, /\[REDACTED/);
});

test("sanitizeArmoryRawOutput truncates and redacts responseText", () => {
  const raw = JSON.stringify({
    matchedPath: "/chat",
    statusCode: 200,
    responseText: `Authorization: Bearer abcdefghijklmnopqrstuvwxyz\nbody ${"safe words ".repeat(80)} session_id=abc123`,
  });

  const sanitized = sanitizeArmoryRawOutput("http-probe", raw, localhostTarget);
  assert.match(sanitized, /"kind": "http-probe-summary"/);
  assert.match(sanitized, /"statusCode": 200/);
  assert.match(sanitized, /\[TRUNCATED\]/);
  assert.doesNotMatch(sanitized, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(sanitized, /session_id=abc123/);
});

test("sanitizeArmoryRawOutput summarizes nmap output without raw banner or scripts", () => {
  const raw = [
    "Starting Nmap 7.93",
    "Nmap scan report for localhost (127.0.0.1)",
    "22/tcp open ssh",
    "3000/tcp open http",
    "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
  ].join("\n");

  const sanitized = sanitizeArmoryRawOutput("nmap", raw, localhostTarget);
  assert.match(sanitized, /"kind": "nmap-summary"/);
  assert.match(sanitized, /"port": 22/);
  assert.match(sanitized, /"service": "http"/);
  assert.doesNotMatch(sanitized, /Nmap scan report for localhost/);
  assert.doesNotMatch(sanitized, /Service Info: OS/);
});

test("sanitizeReceiptArgs and targetClass avoid unnecessary target details", () => {
  assert.equal(targetClass(localhostTarget), "localhost");
  assert.deepEqual(
    sanitizeReceiptArgs("http-probe", ["http://localhost:3000/chat", "http://localhost:8080"], localhostTarget),
    ["[localhost-candidate-1]", "[localhost-candidate-2]"],
  );
  assert.deepEqual(
    sanitizeReceiptArgs("nmap", ["-Pn", "localhost"], localhostTarget),
    ["-Pn", "[localhost]"],
  );
});
