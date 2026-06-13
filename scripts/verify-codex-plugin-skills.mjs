import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceDir = path.join(repoRoot, "skills");
const targetDir = path.join(repoRoot, "plugins", "nax-toolkit", "skills");

function collectFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        throw new Error(`Unsupported entry in skills tree: ${fullPath}`);
      }

      files.push(path.relative(rootDir, fullPath));
    }
  }

  walk(rootDir);
  files.sort();
  return files;
}

assert(fs.existsSync(sourceDir), `Expected source skills directory at ${sourceDir}`);
assert(fs.existsSync(targetDir), `Expected packaged skills directory at ${targetDir}`);

const sourceFiles = collectFiles(sourceDir);
const targetFiles = collectFiles(targetDir);

assert.deepEqual(
  targetFiles,
  sourceFiles,
  "Packaged Codex skills tree does not match the canonical skills tree",
);

for (const relativeFile of sourceFiles) {
  const sourceContents = fs.readFileSync(path.join(sourceDir, relativeFile), "utf8");
  const targetContents = fs.readFileSync(path.join(targetDir, relativeFile), "utf8");

  assert.equal(
    targetContents,
    sourceContents,
    `Packaged Codex skill file is out of sync: ${relativeFile}`,
  );
}

console.log("Packaged Codex skills match the canonical skills tree.");
