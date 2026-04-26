import { spawn, ChildProcessByStdio } from "child_process";
import { Readable } from "stream";

export type AllowedToolName = "nmap";

export type ToolExecutionResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  cancelled: boolean;
};

export type ToolAvailabilityResult = {
  available: boolean;
  tool: AllowedToolName;
  detail: string;
};

type ActiveProcess = {
  runId: string;
  proc: ChildProcessByStdio<null, Readable, Readable>;
};

type ToolAvailabilityOverride = Partial<Record<AllowedToolName, ToolAvailabilityResult>>;

const activeProcesses = new Set<ActiveProcess>();
let toolAvailabilityOverride: ToolAvailabilityOverride = {};

export const KRAKZEN_KILL_SWITCH = {
  active: false,
};

const TOOL_ALLOWLIST: Record<AllowedToolName, readonly string[]> = {
  nmap: ["-Pn", "-T3", "--top-ports", "-oN"],
};

function assertArgsAreAllowed(tool: AllowedToolName, args: string[]): void {
  const allowedFlags = TOOL_ALLOWLIST[tool];
  for (const arg of args) {
    if (arg.startsWith("-") && !allowedFlags.includes(arg)) {
      throw new Error(`Disallowed ${tool} flag: ${arg}`);
    }
    if (/[|;&$><`]/.test(arg)) {
      throw new Error("Shell metacharacters are not allowed.");
    }
  }
}

export function isKillSwitchEnabled(): boolean {
  return KRAKZEN_KILL_SWITCH.active;
}

export function triggerKillSwitch(): void {
  KRAKZEN_KILL_SWITCH.active = true;
  for (const entry of activeProcesses) {
    try {
      entry.proc.kill("SIGTERM");
    } catch {
      // best effort
    }
  }
}

export function resetKillSwitch(): void {
  KRAKZEN_KILL_SWITCH.active = false;
}

export function getActiveProcessCount(): number {
  return activeProcesses.size;
}

export async function checkToolAvailability(tool: AllowedToolName): Promise<ToolAvailabilityResult> {
  const overridden = toolAvailabilityOverride[tool];
  if (overridden) return overridden;

  return await new Promise<ToolAvailabilityResult>((resolve) => {
    const proc = spawn(tool, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({
          available: false,
          tool,
          detail: `${tool} is not installed or not available on PATH.`,
        });
        return;
      }
      resolve({
        available: false,
        tool,
        detail: `${tool} could not be checked: ${error.message}`,
      });
    });

    proc.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve({
          available: true,
          tool,
          detail: stdout.trim() || `${tool} is available.`,
        });
        return;
      }
      resolve({
        available: false,
        tool,
        detail: stderr.trim() || `${tool} returned exit code ${exitCode ?? "unknown"} during availability check.`,
      });
    });
  });
}

export async function runAllowedTool(params: {
  runId: string;
  tool: AllowedToolName;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<ToolExecutionResult> {
  if (KRAKZEN_KILL_SWITCH.active) {
    throw new Error("KRAKZEN_KILL_SWITCH is active. Reset before running Armory again.");
  }

  assertArgsAreAllowed(params.tool, params.args);

  const startedAt = Date.now();

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    const proc = spawn(params.tool, params.args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const activeEntry: ActiveProcess = { runId: params.runId, proc };
    activeProcesses.add(activeEntry);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finalize = (result: ToolExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcesses.delete(activeEntry);
      resolve(result);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcesses.delete(activeEntry);
      reject(error);
    };

    const onData = (kind: "stdout" | "stderr", chunk: Buffer): void => {
      const next = chunk.toString("utf8");
      if (kind === "stdout") stdout += next;
      else stderr += next;

      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") > params.maxOutputBytes) {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // best effort
        }
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk));
    proc.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk));
    proc.on("error", fail);
    proc.on("close", (exitCode, signal) => {
      finalize({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
        cancelled: KRAKZEN_KILL_SWITCH.active && signal === "SIGTERM",
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // best effort
      }
    }, params.timeoutMs);
  });
}

export function __setToolAvailabilityOverrideForTests(override: ToolAvailabilityOverride): void {
  toolAvailabilityOverride = { ...override };
}

export function __resetToolRunnerForTests(): void {
  toolAvailabilityOverride = {};
  KRAKZEN_KILL_SWITCH.active = false;
}
