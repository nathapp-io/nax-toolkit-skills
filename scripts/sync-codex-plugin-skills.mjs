import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceDir = path.join(repoRoot, "skills");
const targetDir = path.join(repoRoot, "plugins", "nax-toolkit", "skills");

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Source skills directory not found: ${sourceDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

console.log(`Synced ${path.relative(repoRoot, sourceDir)} -> ${path.relative(repoRoot, targetDir)}`);
