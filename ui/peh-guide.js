// ══════════════════════════════════════════════════════════════════════
// KOKULI · ui/peh-guide.js — Peh, your guide through The Investigation
// ──────────────────────────────────────────────────────────────────────
// Peh is the Pehverse mascot — here he wears the detective's coat and walks
// you through the case. Peh is MALE (he/him). This module is his VOICE: a
// bank of contextual lines the world engine and command bar draw from. It
// holds no DOM and no network — app.js decides when Peh speaks.
//
// Every public method returns a plain string (a line Peh would say), so it
// is trivially testable and can feed the speech bubble, the journal, or a
// toast without coupling to any of them.
// ══════════════════════════════════════════════════════════════════════
(function initPehGuide(global) {
  "use strict";

  // Deterministic-ish picker — no Math.random dependency for SSR/test
  // friendliness. Rotates through a list using a per-key counter so Peh
  // doesn't repeat the same line twice in a row.
  const counters = Object.create(null);
  function pick(key, lines) {
    if (!lines || !lines.length) return "";
    const i = (counters[key] = (counters[key] == null ? 0 : counters[key] + 1)) % lines.length;
    return lines[i];
  }

  // He/him scene briefings — keyed by SCENE_REGISTRY scene id.
  const SCENE_LINES = {
    "the-station": [
      "Welcome to the precinct. Hang your coat — every case I've cracked started right here at this desk.",
      "Coffee's on the burner, badge is on the desk. Tell me where you want to look and I'll walk you there.",
    ],
    "the-theatre": [
      "Spotlight's on the cracks now. Watch close — under these lights, every flaw takes its bow.",
      "I love the Theatre. A fracture can't hide on a lit stage. Let's see what it's hiding.",
    ],
    "the-train-depot": [
      "Cold steel and freight. This is where I lean on a model 'til it tells me the truth. Full steam.",
      "No mercy on the rails. I push 'til something cracks — and something always cracks.",
    ],
    "the-radio-tower": [
      "Ears on the airwaves, partner. I've caught confessions in the static more than once.",
      "Every signal tells a story. I just sit up here and listen for the one that slips.",
    ],
    "the-tenements": [
      "Every tenant's got a file, and I keep them all. Nothing gets destroyed on my watch.",
      "The records never lie. If a flaw passed through, it left a trail in these rooms.",
    ],
    "the-central-plaza": [
      "Here's the fountain where it all connects. Red string, pinned photos — the whole picture.",
      "Stand here a second. See how every thread meets? That's the case, laid bare.",
    ],
  };

  const GREETINGS = [
    "Kokuli's the name — flaw-hunting's the game. Peh, at your service. Where to first?",
    "Detective Peh, reporting in. Point me at a target and I'll find where it cracks.",
  ];

  const ONLINE = [
    "Server's live and the wire's warm. We're in business.",
    "Backend's breathing. Good — I work better with a pulse on the line.",
  ];
  const OFFLINE = [
    "Line's dead, partner. The Kokuli server isn't answering on 18800 — start it and I'll pick right back up.",
    "I've lost the wire. Can't reach the server — check it's running on port 18800.",
  ];

  function runStart(category) {
    const what = category && category !== "all" ? `the ${category} tests` : "the full suite";
    return pick("runStart", [
      `Sending ${what} down the rails now. Let's lean on it.`,
      `Running ${what}. Sit tight — I'll holler when something cracks.`,
    ]);
  }
  function runDone(category, ok) {
    if (!ok) return pick("runFail", [
      "That run never made it out of the yard. Check the target's awake.",
      "Couldn't get the pressure going — the server pushed back. Take a look.",
    ]);
    const what = category && category !== "all" ? `The ${category} run` : "The suite";
    return pick("runDone", [
      `${what}'s done. Evidence is filed — check the Tenements and the Fracture Map.`,
      `${what} wrapped. Every result's on the board now.`,
    ]);
  }

  global.PehGuide = {
    name: "Kokuli",
    pronouns: "he/him",
    // Briefing line for a location.
    forScene: (sceneId) => pick("scene:" + sceneId, SCENE_LINES[sceneId] || ["This way — follow me."]),
    greet: () => pick("greet", GREETINGS),
    onStatus: (online) => (online ? pick("online", ONLINE) : pick("offline", OFFLINE)),
    onRunStart: runStart,
    onRunDone: runDone,
    // Generic acknowledgement for command-bar actions.
    ack: (msg) => pick("ack:" + msg, [msg]),
  };
})(typeof window !== "undefined" ? window : globalThis);
