import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const skillsDir = path.join(repoRoot, "skills");

// Skill description length limit enforced by the agent harness.
const MAX_DESCRIPTION_LENGTH = 1024;

if (!fs.existsSync(skillsDir)) {
  throw new Error(`Skills directory not found: ${skillsDir}`);
}

/**
 * Extract the `description:` value from a SKILL.md YAML frontmatter block.
 * Supports single-line and folded/multi-line scalars by reading until the
 * next top-level key or the closing frontmatter fence.
 */
function readDescription(contents) {
  const lines = contents.split("\n");
  if (lines[0].trim() !== "---") {
    return null;
  }

  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return null; // end of frontmatter, no description found
    }

    const match = lines[i].match(/^description:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const parts = [match[1]];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "---" || /^[A-Za-z_][\w-]*:\s/.test(line)) {
        break;
      }
      parts.push(line.trim());
    }
    return parts.join(" ").trim();
  }

  return null;
}

const failures = [];
let checked = 0;

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    failures.push(`skills/${entry.name}/SKILL.md: missing SKILL.md`);
    continue;
  }

  const contents = fs.readFileSync(skillFile, "utf8");
  const description = readDescription(contents);
  const relative = path.relative(repoRoot, skillFile);

  if (description === null) {
    failures.push(`${relative}: missing description in frontmatter`);
    continue;
  }

  checked++;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    failures.push(
      `${relative}: description is ${description.length} characters, ` +
        `exceeds maximum length of ${MAX_DESCRIPTION_LENGTH}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Skill description lint failed:");
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Skill descriptions OK: ${checked} skill(s) within ${MAX_DESCRIPTION_LENGTH} characters.`,
);
