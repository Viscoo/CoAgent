#!/usr/bin/env node
// setup-opencode.js — Download OpenCode source and apply CoAgent branding patches.
// Runs on "npm install" via postinstall.

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, ".opencode-source");
const zipPath = path.join(__dirname, ".opencode-source.zip");

// Already set up?
if (existsSync(path.join(target, "packages", "opencode", "src", "index.ts"))) {
  console.log("✔ CoAgent: OpenCode source already downloaded.");
  process.exit(0);
}

console.log("⬇ Downloading OpenCode source (https://github.com/anomalyco/opencode)...");
mkdirSync(target, { recursive: true });

const branch = process.env.OPENCODE_BRANCH || "dev";
const url = `https://github.com/anomalyco/opencode/archive/refs/heads/${branch}.zip`;

try {
  // Download
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  writeFileSync(zipPath, buffer);
  console.log(`  Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Extract
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(target, true);

  // The zip contains a top-level dir like opencode-dev/
  const extracted = execSync(`dir /b "${target}"`, { encoding: "utf8" }).trim().split("\n")[0].trim();
  const srcDir = path.join(target, extracted);

  // Move contents up
  execSync(`move "${srcDir}\\*" "${target}\\" 2>nul`, { shell: "cmd" });
  execSync(`rd /s /q "${srcDir}"`, { shell: "cmd" });

  // Clean up zip
  try { execSync(`del "${zipPath}"`, { shell: "cmd" }); } catch {}

  console.log("✔ Source extracted.");
} catch (err) {
  console.error("✗ Failed to download OpenCode source:", err.message);
  console.log("  You can manually clone: cd CoAgent && git submodule add https://github.com/anomalyco/opencode.git .opencode-source");
  process.exit(1);
}

// Apply CoAgent patches
const patches = [
  // 1. Logo: replace OpenCode pixel art with CoAgent
  {
    file: "packages/tui/src/logo.ts",
    find: 'left: [\n    "                   ",\n    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█",\n    "█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀",\n    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",\n  ],\n  right:',
    replace: `left: [
    "                   ",
    "█▀▀▀ █▀▀█ █▀▀█ █▀▀▀ █▀▀▀ █▀  █ ▀▀█▀▀",
    "█    █  █ █▀▀▀ █  ▀ █▀▀  █▀▀▀█   █  ",
    "▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀   ▀  ",
  ],
  right:`,
  },
  // 2. Script name: change "opencode" to "coagent"
  {
    file: "packages/opencode/src/index.ts",
    find: '.scriptName("opencode")',
    replace: '.scriptName("coagent")',
  },
  {
    file: "packages/opencode/src/temporary.ts",
    find: '.scriptName("opencode")',
    replace: '.scriptName("coagent")',
  },
];

let patched = 0;
for (const p of patches) {
  const fullPath = path.join(target, p.file);
  if (!existsSync(fullPath)) {
    console.log(`  ⚠  Patch target not found: ${p.file}`);
    continue;
  }
  const content = readFileSync(fullPath, "utf8");
  if (content.includes(p.find)) {
    writeFileSync(fullPath, content.replace(p.find, p.replace));
    patched++;
    console.log(`  ✓ Patched: ${p.file}`);
  } else {
    console.log(`  ⚠  Pattern not found in ${p.file} - skipping`);
  }
}

console.log(`\n✔ CoAgent branding applied (${patched}/${patches.length} patches).`);
