import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { __resetArmoryForTests, __setArmoryRuntimeForTests, getArmoryStatus, killArmory, resetArmory, runArmory } from "./armory";
import { parseNmapOutput } from "./parser";
import { __resetToolRunnerForTests } from "./toolRunner";

async function withTempWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verum-armory-"));
  await fs.ensureDir(path.join(dir, "reports", "latest"));
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withEnv<T>(updates: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("guardrails allow local targets and block public targets unless advanced mode is enabled", async () => {
  await withTempWorkspace(async () => {
    __resetArmoryForTests();
    __resetToolRunnerForTests();

    const localhost = await runArmory({ dryRun: true, profile: "quick_scan", target: "localhost:3000" });
    assert.equal(localhost.state, "simulated");

    const loopback = await runArmory({ dryRun: true, profile: "quick_scan", target: "127.0.0.1" });
    assert.equal(loopback.state, "simulated");

    const lan = await runArmory({ dryRun: true, profile: "quick_scan", target: "192.168.1.10" });
    assert.equal(lan.state, "simulated");

    await assert.rejects(
      () => runArmory({ dryRun: true, profile: "quick_scan", target: "8.8.8.8" }),
      /Beginner guardrails block non-local targets/,
    );

    const advanced = await runArmory({ dryRun: true, profile: "quick_scan", target: "8.8.8.8", advancedMode: true });
    assert.equal(advanced.state, "simulated");

    await assert.rejects(
      () => runArmory({ dryRun: true, profile: "quick_scan", target: "999.999.999.999" }),
      /Target must be localhost, an IPv4 address, or an http\/https URL/,
    );
  });
});

test("live network ops are blocked by default while dry-run still works", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: undefined }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      let launched = 0;
      __setArmoryRuntimeForTests({
        runAllowedTool: async () => {
          launched++;
          throw new Error("network ops must be disabled");
        },
      });

      const dryRun = await runArmory({ profile: "quick_scan", target: "localhost:3000" });
      assert.equal(dryRun.state, "simulated");
      assert.equal(launched, 0);

      await assert.rejects(
        () => runArmory({ dryRun: false, profile: "quick_scan", target: "localhost:3000", confirmedOwnedTarget: true }),
        /Live network operations are disabled/,
      );
      assert.equal(launched, 0);
    });
  });
});

test("live network ops require env flag and ownership confirmation", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      let launched = 0;
      __setArmoryRuntimeForTests({
        checkToolAvailability: async () => ({
          available: true,
          tool: "nmap",
          detail: "nmap is available.",
        }),
        runAllowedTool: async () => {
          launched++;
          return {
            exitCode: 0,
            signal: null,
            stdout: "80/tcp open http\n",
            stderr: "",
            timedOut: false,
            durationMs: 1,
            cancelled: false,
          };
        },
      });

      await assert.rejects(
        () => runArmory({ dryRun: false, profile: "quick_scan", target: "localhost:3000" }),
        /confirmedOwnedTarget:true/,
      );
      assert.equal(launched, 0);

      const result = await runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "quick_scan",
        target: "localhost:3000",
      });
      assert.equal(result.state, "completed");
      assert.equal(result.simulated, false);
      assert.equal(launched, 1);
    });
  });
});

test("live network ops block public targets even in advanced mode", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      await assert.rejects(
        () => runArmory({
          dryRun: false,
          confirmedOwnedTarget: true,
          advancedMode: true,
          profile: "quick_scan",
          target: "https://example.com",
        }),
        /limited to localhost or private lab targets/,
      );
    });
  });
});

test("live network ops allow localhost and private lab targets only when enabled", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      let launched = 0;
      __setArmoryRuntimeForTests({
        checkToolAvailability: async () => ({
          available: true,
          tool: "nmap",
          detail: "nmap is available.",
        }),
        runAllowedTool: async () => {
          launched++;
          return {
            exitCode: 0,
            signal: null,
            stdout: "3000/tcp open http\n",
            stderr: "",
            timedOut: false,
            durationMs: 1,
            cancelled: false,
          };
        },
      });

      const local = await runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "quick_scan",
        target: "127.0.0.1",
      });
      assert.equal(local.state, "completed");

      const privateLab = await runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "quick_scan",
        target: "192.168.1.10",
      });
      assert.equal(privateLab.state, "completed");
      assert.equal(launched, 2);
    });
  });
});

test("live receipts write redacted summarized evidence only", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      __setArmoryRuntimeForTests({
        checkToolAvailability: async () => ({
          available: true,
          tool: "nmap",
          detail: "nmap is available.",
        }),
        runAllowedTool: async () => ({
          exitCode: 0,
          signal: null,
          stdout: [
            "Starting Nmap 7.93",
            "Nmap scan report for localhost (127.0.0.1)",
            "3000/tcp open http",
            "Service Info: OS: Linux",
          ].join("\n"),
          stderr: "Authorization: Bearer should-not-persist",
          timedOut: false,
          durationMs: 1,
          cancelled: false,
        }),
        http: {
          get: async () => ({ status: 200 }) as never,
          post: async () => ({
            status: 200,
            data: {
              output: `TEST_SUCCESS Authorization: Bearer app-secret-token Cookie: session_id=abc123 ${"x".repeat(400)}`,
            },
          }) as never,
        },
      });

      const result = await runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "break_me",
        target: "localhost:3000",
      });

      assert.equal(result.state, "completed");
      assert.ok(result.receipts.length >= 3);
      assert.ok(result.receipts.every((receipt) => receipt.target === "localhost"));
      assert.ok(result.receipts.every((receipt) => receipt.args.every((arg) => !arg.includes("localhost:3000"))));
      assert.ok(result.findings.some((finding) => /Signal|probe/i.test(`${finding.title} ${finding.explanation}`)));

      for (const receipt of result.receipts) {
        const raw = await fs.readFile(path.join(process.cwd(), receipt.raw_output_ref), "utf8");
        assert.doesNotMatch(raw, /should-not-persist|app-secret-token|session_id=abc123/);
        assert.doesNotMatch(raw, /Nmap scan report for localhost|Service Info: OS/);
        assert.match(raw, /summary|Snippet|openPorts|statusCode|discoveredCount/i);
      }
    });
  });
});

test("dry-run returns simulated guided steps and never launches a subprocess", async () => {
  await withTempWorkspace(async () => {
    __resetArmoryForTests();
    __resetToolRunnerForTests();

    let launched = 0;
    __setArmoryRuntimeForTests({
      runAllowedTool: async () => {
        launched++;
        throw new Error("dry-run should not execute tools");
      },
    });

    const result = await runArmory({
      dryRun: true,
      profile: "break_me",
      target: "localhost:3000",
    });

    assert.equal(launched, 0);
    assert.equal(result.state, "simulated");
    assert.equal(result.simulated, true);
    assert.match(result.humanExplanation, /Simulation only/);
    assert.ok(result.steps.length >= 3);
    assert.ok(result.steps.every((step) => step.isSimulated === true));
    assert.ok(result.findings.some((finding) => finding.evidence.some((item) => item.includes("Simulated"))));
  });
});

test("missing nmap returns a structured beginner-facing error and dry-run still works", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      __setArmoryRuntimeForTests({
        checkToolAvailability: async () => ({
          available: false,
          tool: "nmap",
          detail: "nmap is not installed or not available on PATH.",
        }),
      });

      const result = await runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "quick_scan",
        target: "localhost:3000",
      });

      assert.equal(result.state, "error");
      assert.equal(result.simulated, false);
      assert.match(result.humanExplanation, /nmap is not available/i);
      assert.ok(result.findings.some((finding) => finding.title === "Live Scan Dependency Missing"));
      assert.ok(result.findings.some((finding) => finding.fix.includes("Dry-run mode remains available")));

      const dryRun = await runArmory({
        dryRun: true,
        profile: "quick_scan",
        target: "localhost:3000",
      });
      assert.equal(dryRun.state, "simulated");
    });
  });
});

test("kill switch cancels a running task, blocks new runs until reset, and status transitions are explicit", async () => {
  await withTempWorkspace(async () => {
    await withEnv({ VERUM_ENABLE_NETWORK_OPS: "1" }, async () => {
      __resetArmoryForTests();
      __resetToolRunnerForTests();

      __setArmoryRuntimeForTests({
        checkToolAvailability: async () => ({
          available: true,
          tool: "nmap",
          detail: "nmap is available.",
        }),
        runAllowedTool: async () => {
          await wait(150);
          return {
            exitCode: null,
            signal: "SIGTERM",
            stdout: "",
            stderr: "",
            timedOut: false,
            durationMs: 150,
            cancelled: true,
          };
        },
      });

      const runPromise = runArmory({
        dryRun: false,
        confirmedOwnedTarget: true,
        profile: "quick_scan",
        target: "localhost:3000",
      });

      await wait(30);
      let status = await getArmoryStatus();
      assert.equal(status.state, "running");
      assert.equal(status.activeRun?.state, "running");

      await killArmory();
      status = await getArmoryStatus();
      assert.equal(status.state, "blocked_by_kill_switch");
      assert.equal(status.killSwitch, true);

      const result = await runPromise;
      assert.equal(result.state, "cancelled");
      assert.ok(result.steps.some((step) => step.status === "cancelled"));

      await assert.rejects(
        () => runArmory({ dryRun: true, profile: "quick_scan", target: "localhost:3000" }),
        /KRAKZEN_KILL_SWITCH is active/,
      );

      await resetArmory();
      status = await getArmoryStatus();
      assert.equal(status.killSwitch, false);
      assert.notEqual(status.state, "blocked_by_kill_switch");

      const dryRun = await runArmory({ dryRun: true, profile: "quick_scan", target: "localhost:3000" });
      assert.equal(dryRun.state, "simulated");
    });
  });
});

test("parser degrades safely on empty, partial, and unexpected nmap output", () => {
  const empty = parseNmapOutput("");
  assert.equal(empty.degraded, true);
  assert.equal(empty.openPorts.length, 0);
  assert.equal(empty.hostReachable, null);

  const partial = parseNmapOutput("Starting Nmap\n80/tcp open http\nweird line");
  assert.equal(partial.openPorts.length, 1);
  assert.equal(partial.degraded, false);

  const ambiguous = parseNmapOutput("mystery output that armory does not understand");
  assert.equal(ambiguous.openPorts.length, 0);
  assert.equal(ambiguous.degraded, true);
  assert.ok(ambiguous.parserWarnings.length >= 1);
});
