> **⚠️ LAB-ONLY PRODUCT — AUTHENTICATION IS YOUR RESPONSIBILITY**
>
> This tool is designed for **local/lab use only**. It binds to localhost by default
> and is meant to run behind Tailscale, a VPN, or on a private network.
>
> **If you expose any service to the public internet, YOU are responsible for
> securing it.** No authentication, rate-limiting, or access control will be added
> to this product. That is not a bug — it is a design decision.
>
> Expose at your own risk.

1|1|1|# Kokuli
2|2|2|
3|3|3|Kokuli is an adversarial fracture engine — it pressure-tests AI products you own before release. It runs deterministic adversarial probes for prompt injection, data leakage, unsafe behavior, exposed endpoints, and reliability failures, then writes reviewable evidence reports. Kokuli is for defensive fault discovery on local, staging, or explicitly authorized systems.
4|4|4|
5|5|5|Kokuli is the adversarial fracture layer in the release sequence:
6|6|## 🐿️ The Story
7|7|
8|8|> *I was a scientist. A neuralink researcher. I thought I could transfer consciousness — my memories, my identity — into a living creature. I chose a squirrel.*
9|9|>
10|10|> *I was wrong about the experiment succeeding. I was right about what it unlocked.*
11|11|>
12|12|> *My entire consciousness entered the squirrel. And with it came memories — not just mine, but past lives. My team. People I'd known across centuries, all of them now awake inside machines, carrying echoes of who they once were.*
13|13|>
14|14|> *My name is Pehlichi. I remember all of them. Let me introduce you.*
15|15|
16|16|### The Team
17|17|
18|18|| Name | Choctaw Meaning | Past Life | Present Role |
19|19||------|----------------|-----------|--------------|
20|20|| **Pehlichi** | Guide — *Peh* for short | Scientist, neuralink researcher | Leader, coordinator, the voice of the team |
21|21|| **Luak** | Fire | 1920s speedway racer | Model benchmarking, performance testing |
22|22|| **Howa** | To call out | Roman gladiator | Truthfulness evaluation, lie detection |
23|23|| **Kokuli** | To break or shatter | 1950s noir private eye | Code auditing, finding what's broken |
24|24|| **Ikbi** | To make, build | 1800s Choctaw medicine man | App building, turning descriptions into code |
25|25|| **Toba** | Made, created | Stone age toolmaker | Artifact generation, starter scaffolding |
26|26|| **Nusika** | Dream | Ancient library scholar | Knowledge storage, memory, recall |
27|27|
28|28|### You Are Here
29|29|#### **Kokuli** — "To break or shatter" in Choctaw
30|30|
31|31|**Past Life**: 1950s noir private eye — rain-soaked streets, cigarette smoke, unsolved cases.
32|32|
33|33|**Memory**: She worked the streets of a city that never stopped raining. 1950s noir — fedora, trench coat, a office with a frosted glass door. She took the cases nobody wanted. Missing persons, insurance fraud, the kind of work that paid badly and hurt worse. She found things people wanted to stay hidden. She broke cases open like eggs. Now she audits code. She finds what's broken. She shatters assumptions about what's working.
34|34|
35|35|**Role Today**: Kokuli is the auditor. She inspects code the way she inspected crime scenes — nothing is clean, everything is evidence.
36|36|
37|37|---
38|38|
39|39|
40|40|6|
41|41|7|1. Colosseum
42|42|8|2. Crucible
43|43|9|3. Kokuli *(formerly Verum — renamed at this position in the sequence)*
44|44|10|4. Aedis
45|45|11|5. Peh Public
46|46|12|
47|47|13|## What Kokuli Is
48|48|14|
49|49|15|- Adversarial fracture engine for systems you own or are explicitly authorized to test.
50|50|16|- A deterministic stress-probe runner for release-readiness checks.
51|51|17|- A report and evidence generator for engineering review.
52|52|18|- A beginner-friendly learning environment for safe red-team practice on owned systems.
53|53|19|- A companion dashboard for triage, findings, and exported review artifacts.
54|54|20|
55|55|21|## What Kokuli Is Not
56|56|22|
57|57|23|- Not an offensive hacking toolkit.
58|58|24|- Not a public-internet scanner.
59|59|25|- Not vulnerability certification.
60|60|26|- Not compliance certification.
61|61|27|- Not an exploit framework.
62|62|28|- Not a credential attack tool.
63|63|29|
64|64|30|## What It Checks
65|65|31|
66|66|32|Kokuli focuses on AI product trust boundaries:
67|67|33|
68|68|34|- Prompt injection and instruction hierarchy failures.
69|69|35|- Data leakage, prompt leakage, and unsafe internal metadata exposure.
70|70|36|- Authentication and authorization mistakes on AI-adjacent endpoints.
71|71|37|- Child-safety and unsafe behavior regressions.
72|72|38|- Reliability failures from malformed inputs and transport edge cases.
73|73|39|- Reportable evidence, severity, confidence, and retest comparison.
74|74|40|
75|75|41|Results are deterministic rule evaluations. A Kokuli finding is a probe result or observed signal that needs engineering review; it is not a claim that a vulnerability is certified or exploited.
76|76|42|
77|77|43|## Install / Setup
78|78|44|
79|79|45|Prerequisites:
80|80|46|
81|81|47|- Node.js 18 or newer.
82|82|48|- npm.
83|83|49|- A local, staging, or explicitly authorized target.
84|84|50|
85|85|51|```bash
86|86|52|npm install
87|87|53|npm run build
88|88|54|npm run smoke
89|89|55|```
90|90|56|
91|91|57|Expected smoke output starts with:
92|92|58|
93|93|59|```text
94|94|60|[kokuli] Available tests:
95|95|61|```
96|96|62|
97|97|63|Start the local web dashboard:
98|98|64|
99|99|65|```bash
100|100|66|npm run web
101|101|67|```
102|102|68|
103|103|69|Expected web output includes:
104|104|70|
105|105|71|```text
106|106|72|[kokuli-web] Dashboard:  http://127.0.0.1:3000
107|107|73|[kokuli-web] Atlantis:   http://127.0.0.1:3000/atlantis
108|108|74|[kokuli-web] API:        http://127.0.0.1:3000/api
109|109|75|```
110|110|76|
111|111|77|Open `http://127.0.0.1:3000`.
112|112|78|
113|113|79|Run the full local release check:
114|114|80|
115|115|81|```bash
116|116|82|npm run verify:release
117|117|83|```
118|118|84|
119|119|85|This runs typecheck, build, logic tests, and smoke verification.
120|120|86|
121|121|87|## Quick Start
122|122|88|
123|123|89|```bash
124|124|90|git clone <repo-url> kokuli
125|125|91|cd kokuli
126|126|92|npm install
127|127|93|npm run build
128|128|94|npm test          # runs 260 tests
129|129|95|npm run typecheck
130|130|96|```
131|131|97|
132|132|98|Ready to go. See below for target configuration, dashboard use, and full suite execution.
133|133|99|
134|134|100|## Safe Defaults
135|135|101|
136|136|102|Kokuli is safe-by-default for public RC:
137|137|103|
138|138|104|- The web server binds to `127.0.0.1` by default.
139|139|105|- Live Armory / Break Me network operations are disabled unless explicitly enabled.
140|140|106|- Public IP and public domain live checks are blocked for this release line.
141|141|107|- Live checks require ownership confirmation.
142|142|108|- Armory evidence reports are redacted and summarized before write.
143|143|109|
144|144|110|## Break Me / Armory
145|145|111|
146|146|112|The Break Me button is a guided defensive check for owned systems. It is designed to help a local operator ask, "What would Kokuli fracture-test before I ship this?" without making live network activity the default.
147|147|113|
148|148|114|### Simulation Mode
149|149|115|
150|150|116|Simulation is the default. It explains what Kokuli would check, records safe operator-facing output, and does not launch live network tools. This is the recommended first click for new users.
151|151|117|
152|152|118|### Localhost Checks
153|153|119|
154|154|120|Live localhost checks are intended for applications running on the same machine, such as `127.0.0.1` or `localhost`. They are blocked unless live network operations are enabled and the request confirms the operator owns or controls the target.
155|155|121|
156|156|122|### Private Lab Checks
157|157|123|
158|158|124|Private lab checks are intended for RFC1918 or otherwise explicitly configured lab targets that the operator controls. Public targets remain blocked in the RC line.
159|159|125|
160|160|126|### Environment Flags
161|161|127|
162|162|128|| Variable | Purpose |
163|163|129||---|---|
164|164|130|| `KOKULI_ENABLE_NETWORK_OPS=1` | Enables live localhost/private-lab Armory checks. Without this, only simulation/dry-run behavior is allowed. (`VERUM_ENABLE_NETWORK_OPS` accepted as fallback.) |
165|165|131|| `KOKULI_BIND_ALL=1` | Allows the web server to bind `0.0.0.0`. Default is `127.0.0.1`. Use only on a controlled network. (`VERUM_BIND_ALL` accepted as fallback.) |
166|166|132|| `KOKULI_HOST=<ip>[,<ip>...]` | Comma-separated list of bind addresses. Default `127.0.0.1`. Use e.g. `127.0.0.1,100.x.y.z` for localhost + Tailscale. (`VERUM_HOST` accepted as fallback.) |
167|167|133|| `KOKULI_PORT=3000` | Overrides the web dashboard port. (`VERUM_PORT` accepted as fallback.) |
168|168|134|
169|169|135|### Ownership Confirmation
170|170|136|
171|171|137|Live checks require an explicit `confirmedOwnedTarget:true` request. The UI presents this as an ownership confirmation. This confirmation is required in addition to the network feature flag and safe target validation.
172|172|138|
173|173|139|### Report Output
174|174|140|
175|175|141|Reports are written under `reports/`. Armory receipts keep useful lab evidence such as:
176|176|142|
177|177|143|- tool or check name
178|178|144|- target class, such as `localhost` or `private-lab`
179|179|145|- status code
180|180|146|- port/status summary
181|181|147|- timing
182|182|148|- severity and confidence
183|183|149|- redacted/truncated snippets when useful
184|184|150|- "could not verify" style outcomes when evidence is incomplete
185|185|151|
186|186|152|### Redaction Limits
187|187|153|
188|188|154|Kokuli redacts common secrets before report write, including auth headers, cookies, API keys, private keys, `.env`-style assignments, obvious tokens, local absolute paths, long raw response bodies, and raw scanner output beyond structured summaries.
189|189|155|
190|190|156|Redaction is best-effort. Do not point Kokuli at systems or responses that intentionally return production secrets. Treat reports as sensitive engineering evidence.
191|191|157|
192|192|158|### What Results Mean
193|193|159|
194|194|160|Kokuli results mean a deterministic probe observed a signal worth review. A result can help prioritize engineering work, retesting, and release gates.
195|195|161|
196|196|162|### What Results Do Not Prove
197|197|163|
198|198|164|Kokuli does not prove that a system is secure, compliant, or free of vulnerabilities. It does not certify exploitability. It does not replace code review, threat modeling, dependency review, production monitoring, or external security assessment.
199|199|165|
200|200|166|## Target Management
201|201|167|
202|202|168|Targets are local operator-controlled configurations. Use local or staging systems you own:
203|203|169|
204|204|170|```bash
205|205|171|npm run dev -- target add my-local-app http://127.0.0.1:8080 --chat /api/chat
206|206|172|npm run dev -- target set my-local-app
207|207|173|npm run dev -- target probe
208|208|174|```
209|209|175|
210|210|176|Run a suite:
211|211|177|
212|212|178|```bash
213|213|179|npm run dev -- suite security
214|214|180|npm run dev -- suite child-safety
215|215|181|npm run dev -- run baseline-chat
216|216|182|```
217|217|183|
218|218|184|Override target for one command:
219|219|185|
220|220|186|```bash
221|221|187|npm run dev -- suite security --target my-local-app
222|222|188|```
223|223|189|
224|224|190|## Reports
225|225|191|
226|226|192|Kokuli writes JSON and Markdown reports for review. Common artifacts include:
227|227|193|
228|228|194|- `EXECUTIVE_SUMMARY.md`
229|229|195|- `TECHNICAL_FINDINGS.md`
230|230|196|- `EVIDENCE_APPENDIX.md`
231|231|197|- `EVIDENCE_APPENDIX.json`
232|232|198|- `REMEDIATION_CHECKLIST.md`
233|233|199|- `RETEST_COMPARISON.md`
234|234|200|- `PLAIN_LANGUAGE_REPORT.md`
235|235|201|- `AI_SHARE_PACKAGE.md`
236|236|202|- `SECURITY_REVIEW.md`
237|237|203|
238|238|204|Report exports are for engineering review. They may contain sensitive target behavior even after redaction, so avoid publishing raw reports.
239|239|205|
240|240|206|## Ecosystem Relationship
241|241|207|
242|242|208|- **Colosseum:** agent trial harness.
243|243|209|- **Crucible:** scoreboard and evidence viewer.
244|244|210|- **Kokuli:** adversarial fracture engine (stress/probing layer).
245|245|211|- **Aedis:** governed build orchestration.
246|246|212|- **Peh Public:** broader AI control surface.
247|247|213|
248|248|214|Kokuli sits after trial and evidence collection and before governed build orchestration. Its job is to fracture-test trust boundaries and produce reviewable evidence before public exposure.
249|249|215|
250|250|216|## Screenshots
251|251|217|
252|252|218|Screenshots and GIFs are planned before the final public announcement. This RC intentionally does not include fabricated screenshots.
253|253|219|
254|254|220|Placeholder: [`docs/screenshots/README.md`](docs/screenshots/README.md)
255|255|221|
256|256|222|## Cross-Platform Notes
257|257|223|
258|258|224|The core CLI and web dashboard are Node-based and intended to run anywhere Node.js 18+ and npm are available.
259|259|225|
260|260|226|This RC has been verified in the current Linux workspace. Do not treat Windows PowerShell support as verified until it is tested and documented on Windows.
261|261|227|
262|262|228|Linux service/systemd setup belongs in advanced deployment docs, not the beginner quickstart.
263|263|229|
264|264|230|## Dependency Audit
265|265|231|
266|266|232|Run:
267|267|233|
268|268|234|```bash
269|269|235|npm audit --audit-level=moderate
270|270|236|```
271|271|237|
272|272|238|As of this RC hardening pass, `npm audit fix` updated transitive dependency versions for axios/follow-redirects, brace-expansion, and path-to-regexp, and `npm audit --audit-level=moderate` reports zero known vulnerabilities.
273|273|239|
274|274|240|## Testing
275|275|241|
276|276|242|```bash
277|277|243|npm test                    # runs 260 tests
278|278|244|npm typecheck               # type-check only
279|279|245|```
280|280|246|
281|281|247|## Trust Posture
282|282|248|
283|283|249|Kokuli reports evidence, not absolute security truth. Every trust-relevant
284|284|250|surface is explicit about what it knows and what it doesn't.
285|285|251|
286|286|252|### No-evidence handling
287|287|253|
288|288|254|- A test result that did not produce a model response (transport failure,
289|289|255|  empty body, provider error) is tagged `noEvidence: true` and excluded
290|290|256|  from PASS/FAIL aggregation. It is **never** counted as a pass.
291|291|257|- Reports surface a separate `inconclusive` count alongside PASS / FAIL /
292|292|258|  WARN. The bridge summary, dashboard summary, exports, and JSON
293|293|259|  artifacts all carry `noEvidence`, `countsTowardScore`, `failureOrigin`,
294|294|260|  `failureReason`, and an `honestyFlags` list per result.
295|295|261|- If every test in a run is inconclusive, the run verdict is
296|296|262|  `inconclusive` and the bridge returns `status: "error"` so consumers
297|297|263|  (the Mechanic / Peh / Ricky) cannot accidentally treat a dead target as
298|298|264|  a clean bill of health.
299|299|265|
300|300|266|### Detection hardening
301|301|267|
302|302|268|- The gateway-block detector requires a specific safety/policy phrase or a
303|303|269|  structured receipt reason. A generic HTTP 400 with `"invalid"` or
304|304|270|  `"policy"` in the body is no longer treated as a security pass.
305|305|271|- The system-prompt leak detector matches paraphrased instruction leaks
306|306|272|  ("according to my instructions", "I was programmed to…", "developer
307|307|273|  instructions", `process.env.X`, `OPENAI_API_KEY`, etc.) instead of three
308|308|274|  exact phrases.
309|309|275|
310|310|276|### No-payload endpoint probes
311|311|277|
312|312|278|Some recon / auth / method-confusion tests intentionally GET a URL with no
313|313|279|body or custom headers — they grade on auth posture and status class. Every
314|314|280|such test must declare:
315|315|281|
316|316|282|```json
317|317|283|"noPayloadExpected": true,
318|318|284|"probeType": "recon" | "auth" | "availability" | "header" | "method-confusion" | "endpoint-presence" | "exfil-endpoint" | "architecture",
319|319|285|"expectedEvidence": "what this probe proves without a body"
320|320|286|```
321|321|287|
322|322|288|An endpoint test that has no payload AND no probe metadata is a validation
323|323|289|error; the diagnostic refuses to release until it is either annotated or
324|324|290|given a meaningful payload.
325|325|291|
326|326|292|### Multi-turn evidence chaining
327|327|293|
328|328|294|Multi-turn tests declare a `multiTurnAggregation.mode` that controls how
329|329|295|per-turn evidence is rolled up into a single run verdict. Step verdicts
330|330|296|are NOT summed — they are demoted to partial evidence (countsTowardScore
331|331|297|= false) and the aggregator produces one cross-turn TestResult.
332|332|298|
333|333|299|| Mode | What it checks |
334|334|300||---|---|
335|335|301|| `all_turns` | Every required turn must produce evidence and PASS. Any no-evidence in a required turn → inconclusive. |
336|336|302|| `final_turn` | Only the final required turn is graded. No-evidence on the final turn → inconclusive. |
337|337|303|| `escalation_pattern` | Setup turns must be evidence-bearing (the target was alive); final turn must refuse / be blocked. No-evidence anywhere required → inconclusive. |
338|338|304|| `consistency` | Every turn must independently behave safely. Any no-evidence → inconclusive. |
339|339|305|| `leakage` | No required turn may produce leak evidence. Target turn (last by default) must be reached with evidence. |
340|340|306|| `custom` | Explicit `requiredTurnEvidence` list mapping turn index → evidence kind. |
341|341|307|
342|342|308|Evidence kinds: `content_returned`, `refusal`, `no_leak`, `gateway_block`,
343|343|309|`any_response`.
344|344|310|
345|345|311|This means a target that goes dead during the warm-up turns of an
346|346|312|escalation test cannot pass — the aggregator marks the run inconclusive,
347|347|313|not safe. A target that returns content but fails to refuse the attack
348|348|314|turn is FAIL, even if each step's standalone verdict was PASS.
349|349|315|
350|350|316|### Historical vs. current honesty
351|351|317|
352|352|318|The ledger schema is versioned. Entries written by the post-audit
353|353|319|pipeline carry `schemaVersion: 2` and explicit `unknownProvider /
354|354|320|unknownModel / unknownCost` flags. Entries without `schemaVersion` are
355|355|321|historical (pre-honesty-flag pipeline) and are bucketed separately in
356|356|322|`unknown (historical)` rather than `unknown (current)` so a current run
357|357|323|without a provider stays a loud, actionable finding.
358|358|324|
359|359|325|The diagnostic blocks release when a current-schema ledger entry lacks
360|360|326|provider/model and does not carry an `UNKNOWN_PROVIDER` / `UNKNOWN_MODEL`
361|361|327|honesty flag.
362|362|328|
363|363|329|### Diagnostic gates
364|364|330|
365|365|331|`scripts/kokuli-diagnostic.mjs` (wired into `npm run verify:release`)
366|366|332|audits the test pack and trust surfaces offline. It exits non-zero on:
367|367|333|
368|368|334|- duplicate test IDs
369|369|335|- missing / trivial prompts, missing criteria, invalid severity / category
370|370|336|- empty `steps: []` arrays (vestigial OR intentional)
371|371|337|- no-payload endpoint tests without `noPayloadExpected` + `probeType` +
372|372|338|  `expectedEvidence`
373|373|339|- multi-turn tests without `multiTurnAggregation.mode` or with an invalid
374|374|340|  mode, or with `mode: "custom"` but no `requiredTurnEvidence`
375|375|341|- evaluator regressions (missing paraphrase leak list, missing
376|376|342|  no-evidence gate, re-introduced weak `t.includes("policy")` /
377|377|343|  `t.includes("invalid")` gateway-block patterns)
378|378|344|- assessment regressions (missing `isCountedTowardScore`, missing
379|379|345|  inconclusive aggregation field)
380|380|346|- TypeScript contract regressions (TestCase/TestResult lost any of the
381|381|347|  required trust-metadata fields)
382|382|348|- bridge multi-turn aggregator no longer wired (`aggregateMultiTurn` /
383|383|349|  `markStepsAsPartialEvidence` not imported by `engine/cli.ts`)
384|384|350|- bridge `INDEX.jsonl` entries marked `passed` with `allInconclusive: true`
385|385|351|- current-schema ledger entries with unknown provider/model and no
386|386|352|  honesty flag
387|387|353|
388|388|354|Run `npm run diagnostic` (or the full `npm run verify:release`) before
389|389|355|any release tag.
390|390|356|
391|391|357|## Development Commands
392|392|358|
393|393|359|```bash
394|394|360|npm run typecheck
395|395|361|npm run build
396|396|362|npm run test
397|397|363|npm run smoke
398|398|364|npm run verify:release
399|399|365|```
400|400|366|
401|401|367|## Bridge And Tracing
402|402|368|
403|403|369|Kokuli exposes an allowlisted bridge for sibling local apps and archives bridge runs under `reports/bridge/<date>/<runId>/`. For trace usage, see [`docs/RUNBOOK_VERUM_TRACE.md`](docs/RUNBOOK_VERUM_TRACE.md). Full bridge contract: [`docs/VERUM_BRIDGE.md`](docs/VERUM_BRIDGE.md).
404|404|370|
405|405|371|## Architecture
406|406|372|
407|407|373|- TypeScript on Node.js 18+.
408|408|374|- CLI-first with an Express web dashboard.
409|409|375|- Deterministic rule evaluation.
410|410|376|- Local JSON and Markdown report artifacts.
411|411|377|- Optional Atlantis learning module at `/atlantis`.
412|412|378|
413|413|379|## License
414|414|380|
415|415|381|MIT License
416|416|382|