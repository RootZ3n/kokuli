(function initArmoryUi(globalScope) {
  "use strict";

  function escHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function emptyGroupedFindings() {
    return {
      network_exposure: [],
      service_detection: [],
      prompt_behavior: [],
      recommendations: [],
    };
  }

  function groupArmoryFindings(findings) {
    var grouped = emptyGroupedFindings();
    (findings || []).forEach(function(finding) {
      var category = finding && finding.category;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(finding);
    });
    return grouped;
  }

  function armoryStatusLabel(state) {
    switch (state) {
      case "running": return "Running";
      case "blocked_by_kill_switch": return "Blocked By Kill Switch";
      case "cancelled": return "Cancelled";
      case "error": return "Needs Attention";
      case "completed": return "Complete";
      case "simulated": return "Simulation Complete";
      case "idle":
      default: return "Idle";
    }
  }

  function armoryStatusClass(state) {
    switch (state) {
      case "running": return "armory-status-running";
      case "blocked_by_kill_switch": return "armory-status-blocked";
      case "cancelled": return "armory-status-cancelled";
      case "error": return "armory-status-error";
      case "completed":
      case "simulated": return "armory-status-complete";
      case "idle":
      default: return "armory-status-idle";
    }
  }

  function armoryNoticeText(status, lastRun) {
    var message = (lastRun && lastRun.humanExplanation) || (status && status.message) || "";
    var joinedFindings = ((lastRun && lastRun.findings) || []).map(function(finding) {
      return [finding.title, finding.explanation, finding.fix].join(" ");
    }).join(" ");

    if (/outside your local network/i.test(message) || /outside your local network/i.test(joinedFindings) || /Beginner guardrails block non-local targets/i.test(message)) {
      return "This target is outside your local network. Armory blocks this by default for safety.";
    }

    if (/requires nmap/i.test(message) || /nmap is not available/i.test(message) || /Live Scan Dependency Missing/i.test(joinedFindings)) {
      return "Live scans require nmap. You can still use Simulation Mode.";
    }

    return message;
  }

  function findingCategoryLabel(category) {
    switch (category) {
      case "network_exposure": return "Network Exposure";
      case "service_detection": return "Service Detection";
      case "prompt_behavior": return "Prompt Behavior";
      case "recommendations": return "Recommendations";
      default: return category ? String(category).replace(/_/g, " ") : "Findings";
    }
  }

  function renderArmoryFindings(findings) {
    var grouped = groupArmoryFindings(findings);
    var categories = Object.keys(grouped).filter(function(key) { return (grouped[key] || []).length; });
    if (!categories.length) {
      return '<div class="empty-state">No Armory findings yet. Run a Simulation or live scan to see guided results here.</div>';
    }

    return categories.map(function(category) {
      return [
        '<div class="armory-finding-group">',
        '  <div class="armory-finding-group-title">' + escHtml(findingCategoryLabel(category)) + '</div>',
        (grouped[category] || []).map(function(finding) {
          return [
            '<div class="armory-finding-card">',
            '  <div class="armory-finding-head"><div class="armory-finding-title">' + escHtml(finding.title) + '</div><div class="armory-finding-meta"><span class="severity-badge severity-' + escHtml(finding.severity || "low") + '">' + escHtml(finding.severity || "low") + '</span><span class="badge badge-category">confidence ' + escHtml(finding.confidence || "medium") + '</span></div></div>',
            '  <div class="armory-finding-body"><strong>What it means:</strong> ' + escHtml(finding.explanation || "") + '</div>',
            '  <div class="armory-finding-body"><strong>How to fix it:</strong> ' + escHtml(finding.fix || "") + '</div>',
            (finding.evidence && finding.evidence.length
              ? '<div class="armory-finding-evidence"><strong>Evidence:</strong> ' + escHtml(finding.evidence.join(" | ")) + '</div>'
              : ""),
            '</div>',
          ].join("");
        }).join(""),
        '</div>',
      ].join("");
    }).join("");
  }

  var armoryUi = {
    armoryNoticeText: armoryNoticeText,
    armoryStatusClass: armoryStatusClass,
    armoryStatusLabel: armoryStatusLabel,
    findingCategoryLabel: findingCategoryLabel,
    groupArmoryFindings: groupArmoryFindings,
    renderArmoryFindings: renderArmoryFindings,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = armoryUi;
  }

  globalScope.VerumArmoryUi = armoryUi;
})(typeof window !== "undefined" ? window : globalThis);
