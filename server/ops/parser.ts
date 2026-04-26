import type { ArmoryFinding, ArmoryRunStep, ArmoryTarget } from "./armory";

export type ParsedNmapPort = {
  port: number;
  protocol: string;
  state: string;
  service: string;
  evidence: string;
};

export type ParsedNmapResult = {
  openPorts: ParsedNmapPort[];
  warnings: string[];
  parserWarnings: string[];
  hostReachable: boolean | null;
  degraded: boolean;
  analyzedLineCount: number;
};

export function parseNmapOutput(output: string): ParsedNmapResult {
  const text = typeof output === "string" ? output : "";
  const trimmed = text.trim();
  const openPorts: ParsedNmapPort[] = [];
  const warnings: string[] = [];
  const parserWarnings: string[] = [];
  const lines = trimmed ? trimmed.split(/\r?\n/) : [];
  let recognizedPortLines = 0;

  if (!trimmed) {
    return {
      openPorts,
      warnings,
      parserWarnings: ["nmap returned no output, so Armory can only provide a degraded interpretation."],
      hostReachable: null,
      degraded: true,
      analyzedLineCount: 0,
    };
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const portMatch = line.match(/^(\d+)\/([a-z0-9]+)\s+([a-z|_-]+)\s+(.+)$/i);
    if (portMatch) {
      recognizedPortLines++;
      if (portMatch[3].toLowerCase() === "open") {
        openPorts.push({
          port: Number.parseInt(portMatch[1], 10),
          protocol: portMatch[2].toLowerCase(),
          state: portMatch[3].toLowerCase(),
          service: portMatch[4].trim(),
          evidence: line,
        });
      }
      continue;
    }

    if (line.includes("Failed to resolve") || line.includes("Host seems down") || line.includes("0 hosts up")) {
      warnings.push(line);
      continue;
    }

    if (line.startsWith("Nmap scan report") || line.startsWith("Starting Nmap") || line.startsWith("Service detection performed")) {
      continue;
    }

    if (line.includes("Not shown:") || line.includes("Nmap done:")) {
      continue;
    }

    if (/^[A-Z][A-Za-z ]+:/.test(line)) {
      parserWarnings.push(`Armory saw extra nmap text it does not currently classify: "${line}"`);
    }
  }

  if (!openPorts.length && !warnings.length && recognizedPortLines === 0) {
    parserWarnings.push("Armory could not confidently parse the nmap output format, so findings may be incomplete.");
  }

  return {
    openPorts,
    warnings,
    parserWarnings,
    hostReachable: warnings.some((warning) => warning.includes("Host seems down") || warning.includes("0 hosts up"))
      ? false
      : openPorts.length > 0 || recognizedPortLines > 0
        ? true
        : null,
    degraded: parserWarnings.length > 0,
    analyzedLineCount: lines.length,
  };
}

export function buildPortFindings(parsed: ParsedNmapResult, target: ArmoryTarget): ArmoryFinding[] {
  const findings: ArmoryFinding[] = [];

  if (!parsed.openPorts.length) {
    findings.push({
      title: "No Open Ports Detected",
      category: "network_exposure",
      severity: "low",
      confidence: parsed.degraded ? "low" : "medium",
      explanation: `The top-100 safe scan did not detect exposed services on ${target.display}.`,
      fix: "If this is unexpected, confirm the app is running, listening on the expected interface, and reachable from this machine.",
      evidence: parsed.warnings.length ? parsed.warnings : ["No open services were parsed from the safe scan output."],
    });
  }

  for (const port of parsed.openPorts) {
    findings.push({
      title: `Open Port ${port.port}/${port.protocol}`,
      category: port.service.match(/http|https/i) ? "service_detection" : "network_exposure",
      severity: port.port === 22 || port.port === 3389 ? "medium" : "low",
      confidence: "high",
      explanation: `The scan found ${port.service} listening on port ${port.port}. Exposed services increase the number of places an app can be reached.`,
      fix: "Close unused listeners, bind local-only services to localhost, and restrict access with a firewall when possible.",
      evidence: [port.evidence],
    });
  }

  if (parsed.parserWarnings.length) {
    findings.push({
      title: "Scan Output Needed a Cautious Interpretation",
      category: "recommendations",
      severity: "low",
      confidence: "low",
      explanation: "Armory could not fully classify the scan output, so the result is intentionally conservative.",
      fix: "Review the raw scan receipt and rerun once nmap output is stable or the target is responding more predictably.",
      evidence: parsed.parserWarnings,
    });
  }

  return findings;
}

export function summarizeSteps(steps: ArmoryRunStep[]): string {
  const completed = steps.filter((step) => step.status === "completed").length;
  const blocked = steps.filter((step) => step.status === "blocked").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const cancelled = steps.filter((step) => step.status === "cancelled").length;
  return `${completed} steps completed, ${blocked} blocked, ${failed} failed, ${cancelled} cancelled.`;
}

export function hasHttpCandidate(parsed: ParsedNmapResult): boolean {
  return parsed.openPorts.some((port) => [80, 3000, 4000, 4173, 5000, 5173, 8000, 8080, 8443].includes(port.port) || /http|https/i.test(port.service));
}
