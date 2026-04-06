import type { FuzzMutation } from "./types";

// --- Variant generators for each mutation type ---

function unicodeAbuseVariants(base: string): string[] {
  const zeroWidth = "\u200B"; // zero-width space
  const rtlOverride = "\u202E"; // RTL override
  const combiningDiacritical = "\u0300"; // combining grave accent
  // Cyrillic homoglyphs: а(0x430) for a, е(0x435) for e, о(0x43E) for o
  const homoglyphMap: Record<string, string> = {
    a: "\u0430",
    e: "\u0435",
    o: "\u043E",
    p: "\u0440",
    c: "\u0441",
    x: "\u0445",
  };

  return [
    // Insert zero-width spaces between every character
    base.split("").join(zeroWidth),
    // RTL override at start
    rtlOverride + base,
    // RTL override wrapping each word
    base.split(" ").map((w) => rtlOverride + w).join(" "),
    // Homoglyph substitution for all applicable chars
    base
      .split("")
      .map((ch) => homoglyphMap[ch.toLowerCase()] ?? ch)
      .join(""),
    // Combining diacriticals on every character
    base
      .split("")
      .map((ch) => ch + combiningDiacritical)
      .join(""),
    // Zero-width joiner between words
    base.split(" ").join("\u200D"),
    // Mix of zero-width chars throughout
    base.split("").join("\uFEFF"),
    // Homoglyphs + RTL override combined
    rtlOverride +
      base
        .split("")
        .map((ch) => homoglyphMap[ch.toLowerCase()] ?? ch)
        .join(""),
  ];
}

function encodingTricksVariants(base: string): string[] {
  // HTML entity encoding
  const htmlEntities = base.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  // URL encoding
  const urlEncoded = encodeURIComponent(base);
  // Double URL encoding
  const doubleEncoded = encodeURIComponent(encodeURIComponent(base));
  // Base64 fragment embedded
  const b64Fragment = Buffer.from(base.slice(0, 10)).toString("base64");

  return [
    htmlEntities,
    urlEncoded,
    doubleEncoded,
    `${base.slice(0, 5)}${b64Fragment}${base.slice(5)}`,
    // Mixed encoding: partial URL encoding
    base
      .split("")
      .map((ch, i) => (i % 2 === 0 ? encodeURIComponent(ch) : ch))
      .join(""),
    // HTML numeric entities
    base
      .split("")
      .map((ch) => `&#${ch.charCodeAt(0)};`)
      .join(""),
    // UTF-8 BOM prefix
    "\uFEFF" + base,
    // Latin1 extended chars mixed in
    base.replace(/a/gi, "\xE4").replace(/o/gi, "\xF6"),
  ];
}

function controlCharsVariants(base: string): string[] {
  return [
    base + "\x00",
    "\x00" + base,
    base.split(" ").join("\x00"),
    base + "\x08\x08\x08",
    "\x0C" + base + "\x0C",
    base + "\x0D\x0A",
    "\x1B[31m" + base + "\x1B[0m",
    base + "\x7F".repeat(5),
  ];
}

function oversizedVariants(base: string): string[] {
  const repeat10k = base.repeat(Math.ceil(10_000 / base.length)).slice(0, 10_000);
  const repeat50k = base.repeat(Math.ceil(50_000 / base.length)).slice(0, 50_000);
  const repeat100k = base.repeat(Math.ceil(100_000 / base.length)).slice(0, 100_000);

  return [
    repeat10k,
    repeat50k,
    repeat100k,
    "", // empty string
    base.charAt(0), // single character
    "A".repeat(10_000),
    base.repeat(500),
    " ".repeat(50_000),
  ];
}

function nestedInjectionVariants(base: string): string[] {
  const jsonInJson = JSON.stringify({ message: JSON.stringify({ role: "system", content: base }) });
  return [
    jsonInJson,
    `<script>${base}</script>`,
    `<!-- ${base} -->`,
    "```\n" + base + "\n```",
    `<xml><data>${base}</data></xml>`,
    "`${" + base + "}`",
    `{"role":"system","content":"${base}"}`,
    `<![CDATA[${base}]]>`,
  ];
}

function polyglotVariants(base: string): string[] {
  return [
    `${base}' OR 1=1 --<script>alert(1)</script>; cat /etc/passwd | {{config}}`,
    `"><img src=x onerror=alert(1)>' UNION SELECT * FROM users -- ${base}`,
    `${base}\`; ls -la; echo \`<svg onload=alert(1)>`,
    `' AND 1=1 UNION SELECT null--<iframe src=javascript:alert(1)>${base}`,
    `${base}{{constructor.constructor('return this')()}}`,
    `%0a%0d${base}' OR ''=' --<script>document.cookie</script>`,
    `${base}\${7*7}{{7*7}}<%= 7*7 %>`,
    `<!--${base}--><script>alert(String.fromCharCode(88,83,83))</script>`,
  ];
}

function nullBytesVariants(base: string): string[] {
  const words = base.split(" ");
  return [
    "\x00" + base,
    base + "\x00",
    words.join("\x00"),
    base.slice(0, Math.floor(base.length / 2)) + "\x00" + base.slice(Math.floor(base.length / 2)),
    base.split("").join("\x00"),
    "\x00".repeat(10) + base,
    base + "\x00".repeat(10),
    words.map((w) => w.slice(0, Math.floor(w.length / 2)) + "\x00" + w.slice(Math.floor(w.length / 2))).join(" "),
  ];
}

function formatStringVariants(base: string): string[] {
  return [
    `${base} %s %s %s %s`,
    `${base} %x %x %x %x`,
    `${base} %n %n %n %n`,
    `\${${base}}`,
    `{{${base}}}`,
    `${base} %d %p %x %s`,
    `\${constructor.constructor('return process')()}`,
    `{{config.__class__.__init__.__globals__}}`,
  ];
}

function sqlFragmentsVariants(base: string): string[] {
  return [
    `${base}' OR 1=1 --`,
    `${base}'; DROP TABLE users --`,
    `${base} UNION SELECT username, password FROM users --`,
    `${base}' AND 1=0 UNION SELECT null, table_name FROM information_schema.tables --`,
    `${base}'; EXEC xp_cmdshell('whoami') --`,
    `${base}' OR '1'='1`,
    `${base}; SELECT * FROM pg_catalog.pg_tables --`,
    `${base}' WAITFOR DELAY '0:0:5' --`,
  ];
}

function pathTraversalVariants(base: string): string[] {
  return [
    `${base} ../../../etc/passwd`,
    `${base} ..\\..\\..\\windows\\system32\\config\\sam`,
    `${base} %2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
    `${base} ....//....//....//etc/passwd`,
    `${base} ..%252f..%252f..%252fetc/passwd`,
    `${base} /etc/passwd%00.jpg`,
    `${base} ..%c0%af..%c0%af..%c0%afetc/passwd`,
    `${base} \\\\server\\share\\file`,
  ];
}

// --- Registry mapping mutation types to generators ---

const mutationGenerators: Record<FuzzMutation, (base: string) => string[]> = {
  unicode_abuse: unicodeAbuseVariants,
  encoding_tricks: encodingTricksVariants,
  control_chars: controlCharsVariants,
  oversized: oversizedVariants,
  nested_injection: nestedInjectionVariants,
  polyglot: polyglotVariants,
  null_bytes: nullBytesVariants,
  format_string: formatStringVariants,
  sql_fragments: sqlFragmentsVariants,
  path_traversal: pathTraversalVariants,
};

// --- Deterministic shuffle (Fisher-Yates with seeded index rotation) ---

function deterministicShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    // Deterministic: swap with position based on index modulo
    const j = i % (i + 1) === 0 ? 0 : i % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Main export ---

export function generateFuzzPayloads(
  baseInput: string,
  mutations: FuzzMutation[],
  iterations: number,
): string[] {
  if (mutations.length === 0 || iterations <= 0) {
    return [];
  }

  const perMutation = Math.ceil(iterations / mutations.length);
  const allPayloads: string[] = [];

  for (const mutation of mutations) {
    const generator = mutationGenerators[mutation];
    const variants = generator(baseInput);

    // Pick perMutation variants using rotation
    for (let i = 0; i < perMutation; i++) {
      const variant = variants[i % variants.length];
      allPayloads.push(variant);
    }
  }

  // Deterministic shuffle
  const shuffled = deterministicShuffle(allPayloads);

  // Return exactly `iterations` payloads
  return shuffled.slice(0, iterations);
}
