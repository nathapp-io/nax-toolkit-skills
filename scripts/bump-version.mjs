#!/usr/bin/env node
// Bump (or sync) the toolkit version across every manifest in one shot.
//
// package.json is the canonical source of truth. Every other manifest's
// version field is kept identical to it — including the marketplace plugin
// entries and the per-target plugin.json files (claude / cursor / codex /
// agents), plus the nested codex marketplace payload.
//
// Usage:
//   node scripts/bump-version.mjs patch      # 0.2.2 -> 0.2.3
//   node scripts/bump-version.mjs minor      # 0.2.2 -> 0.3.0
//   node scripts/bump-version.mjs major      # 0.2.2 -> 1.0.0
//   node scripts/bump-version.mjs 0.4.0      # set an explicit version
//   node scripts/bump-version.mjs sync       # write package.json's current version everywhere (fix drift)
//   add --dry-run to preview without writing.

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

// Each target declares how to reach its version field. "version" updates the
// top-level field; "plugins[].version" updates every plugin entry's version
// (marketplace manifests can list more than one plugin).
const TARGETS = [
  { file: "package.json", kind: "version" },
  { file: ".claude-plugin/plugin.json", kind: "version" },
  { file: ".claude-plugin/marketplace.json", kind: "plugins[].version" },
  { file: ".cursor-plugin/plugin.json", kind: "version" },
  { file: ".codex-plugin/plugin.json", kind: "version" },
  { file: ".agents/plugins/marketplace.json", kind: "plugins[].version" },
  { file: "plugins/nax-toolkit/.codex-plugin/plugin.json", kind: "version" },
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

function readJson(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) fail(`missing manifest: ${rel}`);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function currentVersion() {
  const v = readJson("package.json").version;
  if (!SEMVER.test(v)) fail(`package.json version is not semver: "${v}"`);
  return v;
}

function nextVersion(current, arg) {
  if (arg === "sync") return current;
  if (SEMVER.test(arg)) return arg; // explicit version
  const [, major, minor, patch] = current.match(SEMVER).map(Number);
  switch (arg) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      fail(`unknown bump arg "${arg}". Use patch | minor | major | <x.y.z> | sync`);
  }
}

// Set the version on a parsed manifest per its declared kind. Returns the list
// of old values touched (for reporting / no-op detection).
function applyVersion(json, kind, version) {
  const touched = [];
  if (kind === "version") {
    touched.push(json.version);
    json.version = version;
  } else if (kind === "plugins[].version") {
    if (!Array.isArray(json.plugins)) fail(`expected a plugins[] array`);
    for (const plugin of json.plugins) {
      touched.push(plugin.version);
      plugin.version = version;
    }
  }
  return touched;
}

function writeJson(rel, json) {
  const abs = path.join(repoRoot, rel);
  fs.writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const cmd = args.find((a) => a !== "--dry-run") ?? "patch";

  const current = currentVersion();
  const version = nextVersion(current, cmd);

  console.log(`bump-version: ${current} -> ${version}${dryRun ? " (dry-run)" : ""}\n`);

  let changed = 0;
  for (const { file, kind } of TARGETS) {
    const json = readJson(file);
    const before = applyVersion(json, kind, version);
    const drifted = before.filter((v) => v !== version);
    if (drifted.length === 0) {
      console.log(`  =  ${file} (already ${version})`);
      continue;
    }
    changed += 1;
    console.log(`  -> ${file} (${[...new Set(drifted)].join(", ")} -> ${version})`);
    if (!dryRun) writeJson(file, json);
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${changed} file(s) to ${version}.`);
  if (!dryRun && cmd !== "sync") {
    console.log("Next: run `npm run prepare:codex-release` if skills changed, then commit.");
  }
}

main();
