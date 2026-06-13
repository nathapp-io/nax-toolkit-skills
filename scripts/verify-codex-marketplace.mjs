import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
const pluginEntry = marketplace.plugins.find((plugin) => plugin.name === "nax-toolkit");

assert(pluginEntry, "Expected nax-toolkit to be present in .agents/plugins/marketplace.json");
assert.equal(pluginEntry.source?.source, "local", "Expected a local plugin source");
assert.equal(
  pluginEntry.source?.path,
  "./plugins/nax-toolkit",
  "Expected Codex marketplace source path to point at a plugin subdirectory",
);

const sourceRoot = path.resolve(repoRoot, pluginEntry.source.path);
const manifestPath = path.join(sourceRoot, ".codex-plugin", "plugin.json");

assert(fs.existsSync(manifestPath), `Expected plugin manifest at ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const skillsPath = path.resolve(sourceRoot, manifest.skills);
const relativeSkillsPath = path.relative(sourceRoot, skillsPath);

assert(
  relativeSkillsPath && !relativeSkillsPath.startsWith("..") && !path.isAbsolute(relativeSkillsPath),
  `Expected skills path to stay inside plugin source root, got ${manifest.skills}`,
);

assert(fs.existsSync(skillsPath), `Expected skills directory at ${skillsPath}`);

const stats = fs.lstatSync(skillsPath);
assert(!stats.isSymbolicLink(), `Expected skills path to be a real directory, got symlink at ${skillsPath}`);

console.log("Codex marketplace layout is self-contained.");
