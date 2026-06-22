// ══════════════════════════════════════════════════════════════════════
// KOKULI · ui/onboarding.js — Peh's first-launch onboarding overlay
// ──────────────────────────────────────────────────────────────────────
// Detects first visit via localStorage('pehverse-onboarded'). If unset,
// shows a modal overlay with Peh's greeting and two paths:
//   • "Let's Get Started" — a guided tour that walks through every
//     hotspot, calling pehSayGreeting() at each stop (1-8 s delays).
//   • "Skip Tour" — dismisses the overlay and sets the onboarded flag.
//
// After the tour completes (or is skipped), the flag is set and the
// overlay won't appear again. A help-button click calls
// pehOnboarding.reTrigger() to replay the experience.
//
// Depends on (load order in index.html): the inline world engine
// (pehSayGreeting, pehScenes, etc.) is already available.
// ══════════════════════════════════════════════════════════════════════
(function initPehOnboarding(global) {
  "use strict";

  var ONBOARDED_KEY = "pehverse-onboarded";
  var doc = global.document;

  // ── Persistence ────────────────────────────────────────────────────
  function isOnboarded() {
    try { return localStorage.getItem(ONBOARDED_KEY) === "1"; }
    catch (_) { return true; }
  }
  function setOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch (_) {}
  }
  function clearOnboarded() {
    try { localStorage.removeItem(ONBOARDED_KEY); } catch (_) {}
  }

  // ── HTML escaping (self-contained; no dependency on engine esc()) ──
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ── Overlay markup ─────────────────────────────────────────────────
  function overlayHTML() {
    var p = (typeof pehActiveProduct === "function") ? pehActiveProduct() : null;
    var mascot = (p && p.mascotArt) ? p.mascotArt : "assets/peh-kokuli.png";
    return '<div class="peh-onboard" id="peh-onboard" role="dialog" aria-modal="true" aria-label="Welcome to Kokuli">' +
      '<div class="peh-onboard-card">' +
        '<img class="peh-onboard-img" src="' + esc(mascot) + '" alt="Pehlichi — your guide">' +
        '<div class="peh-onboard-bubble">' +
          '<span class="peh-onboard-name">Pehlichi</span>' +
          '<p class="peh-onboard-text">Halito! My name is Pehlichi, but my friends call me Peh. ' +
            'I will be joining you on this new adventure. Would you like to get started?</p>' +
        '</div>' +
        '<div class="peh-onboard-actions">' +
          '<button class="peh-onboard-btn primary" type="button" id="peh-onboard-start">Let\'s Get Started</button>' +
          '<button class="peh-onboard-btn secondary" type="button" id="peh-onboard-skip">Skip Tour</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Show / dismiss overlay ─────────────────────────────────────────
  function showOverlay() {
    dismissOverlay();
    var wrap = doc.createElement("div");
    wrap.id = "peh-onboard-wrap";
    wrap.innerHTML = overlayHTML();
    doc.body.appendChild(wrap);

    doc.getElementById("peh-onboard-start").addEventListener("click", function () {
      dismissOverlay();
      startTour();
    });
    doc.getElementById("peh-onboard-skip").addEventListener("click", function () {
      dismissOverlay();
      setOnboarded();
    });
  }

  function dismissOverlay() {
    var wrap = doc.getElementById("peh-onboard-wrap");
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  // ── Guided tour — walk every hotspot ───────────────────────────────
  var tourTimers = [];

  function clearTourTimers() {
    for (var i = 0; i < tourTimers.length; i++) clearTimeout(tourTimers[i]);
    tourTimers = [];
  }

  function getAllHotspots() {
    var pid = (typeof pehActiveProductId === "function") ? pehActiveProductId() : "kokuli";
    var scenes = (typeof pehScenes === "function") ? pehScenes(pid) : [];
    var list = [];
    for (var si = 0; si < scenes.length; si++) {
      var scene = scenes[si];
      if (!scene.hotspots) continue;
      for (var hi = 0; hi < scene.hotspots.length; hi++) {
        list.push({ scene: scene, hotspot: scene.hotspots[hi] });
      }
    }
    return list;
  }

  function startTour() {
    clearTourTimers();
    var stops = getAllHotspots();
    if (!stops.length) { setOnboarded(); return; }

    var i = 0;
    function visitNext() {
      if (i >= stops.length) { setOnboarded(); return; }
      var stop = stops[i];
      i++;

      // Navigate to the scene if it's different from the current one.
      if (typeof pehSetScene === "function" && stop.scene) {
        pehSetScene(stop.scene.id);
      }

      // Peh speaks at the hotspot — reuses the engine's speech-bubble.
      if (typeof pehSayGreeting === "function") {
        pehSayGreeting(stop.hotspot, stop.scene);
      }

      // Random delay between 1 000 – 8 000 ms before the next stop.
      var delay = 1000 + Math.floor(Math.random() * 7000);
      tourTimers.push(setTimeout(visitNext, delay));
    }

    // Brief pause so the overlay has faded before the first greeting.
    tourTimers.push(setTimeout(visitNext, 400));
  }

  // ── Re-trigger (help button) ───────────────────────────────────────
  function reTrigger() {
    clearTourTimers();
    clearOnboarded();
    if (typeof pehDismissBubble === "function") pehDismissBubble();
    showOverlay();
  }

  // ── Expose API for the help button ─────────────────────────────────
  global.pehOnboarding = {
    show: showOverlay,
    dismiss: dismissOverlay,
    reTrigger: reTrigger,
    startTour: startTour,
    clearTourTimers: clearTourTimers
  };

  // ── Escape key dismisses the overlay ───────────────────────────────
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var overlay = doc.getElementById("peh-onboard");
      if (!overlay) return;
      dismissOverlay();
      setOnboarded();
      clearTourTimers();
    }
  });

  // ── Boot: show overlay on first visit ──────────────────────────────
  function boot() {
    if (!isOnboarded()) showOverlay();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();

})(typeof window !== "undefined" ? window : globalThis);
