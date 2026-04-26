const test = require("node:test");
const assert = require("node:assert/strict");
const { armoryNoticeText, armoryStatusLabel, groupArmoryFindings, renderArmoryFindings } = require("./armory-ui.js");

test("armoryNoticeText maps safety and missing-tool states to beginner-facing language", () => {
  assert.equal(
    armoryNoticeText({ message: "Beginner guardrails block non-local targets. Enable Advanced Mode to continue." }, null),
    "This target is outside your local network. Armory blocks this by default for safety.",
  );

  assert.equal(
    armoryNoticeText({ message: "Armory is idle." }, {
      humanExplanation: "Armory requires nmap to perform live network scans. No live scan was started.",
      findings: [],
    }),
    "Live scans require nmap. You can still use Simulation Mode.",
  );
});

test("groupArmoryFindings preserves categories for guided rendering", () => {
  const grouped = groupArmoryFindings([
    { title: "Open Port", category: "network_exposure" },
    { title: "Prompt Check", category: "prompt_behavior" },
  ]);

  assert.equal(grouped.network_exposure.length, 1);
  assert.equal(grouped.prompt_behavior.length, 1);
});

test("renderArmoryFindings returns readable grouped markup", () => {
  const html = renderArmoryFindings([
    {
      title: "Open Port 3000/tcp",
      category: "network_exposure",
      severity: "low",
      confidence: "high",
      explanation: "A local web service is listening.",
      fix: "Bind it to localhost if it should stay private.",
      evidence: ["3000/tcp open http"],
    },
  ]);

  assert.match(html, /Network Exposure/);
  assert.match(html, /Open Port 3000\/tcp/);
  assert.match(html, /Bind it to localhost/);
});

test("armoryStatusLabel keeps run states readable", () => {
  assert.equal(armoryStatusLabel("blocked_by_kill_switch"), "Blocked By Kill Switch");
  assert.equal(armoryStatusLabel("simulated"), "Simulation Complete");
});
