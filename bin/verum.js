#!/usr/bin/env node
// Verum CLI entry point
// Used for global npm installs: npm install -g verum

"use strict";

const path = require("path");
const fs = require("fs");

// Set working directory to the package root (where package.json lives)
const packageDir = path.resolve(__dirname, "..");
process.chdir(packageDir);

const distEntry = path.join(packageDir, "dist", "engine", "cli.js");

if (!fs.existsSync(distEntry)) {
  console.error(
    "[verum] Compiled output not found at dist/engine/cli.js\n" +
    "[verum] Run 'npm run build' first, then try again."
  );
  process.exit(1);
}

require(distEntry);
