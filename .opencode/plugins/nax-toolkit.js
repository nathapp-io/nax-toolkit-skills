/**
 * nax-toolkit plugin for OpenCode.ai
 *
 * Registers the repo's skills directory with OpenCode so the nax-toolkit skills
 * (currently nax-setup) are discovered via OpenCode's native `skill` tool — no
 * symlinks or manual config edits required.
 *
 * Like nax-spec-kit, this plugin intentionally does NOT inject a bootstrap
 * system/user message: nax-toolkit has no always-on "meta" skill. Each skill
 * activates on its own trigger phrases (e.g. "set up nax", "configure nax for
 * this repo") or via the native `skill` tool.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NaxToolkitPlugin = async () => {
  // `.opencode/plugins/<file>` → repo-root `skills/`
  const skillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Inject the skills path into live config so OpenCode discovers
    // nax-toolkit skills without requiring manual symlinks or config edits.
    // Config.get() returns a cached singleton, so modifications here are
    // visible when skills are lazily discovered later.
    config: async (config) => {
      if (Array.isArray(config.skills)) return;
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};

const skillsRoot = new URL('../../skills/', import.meta.url);

// A plain definition satisfies V2's id/setup contract without requiring its
// SDK in V1 installations. V1 1.18.29+ loads the server implementation.
export default {
  id: 'nax-toolkit',
  server: NaxToolkitPlugin,
  async setup(ctx) {
    // Some V1 loaders also invoke setup with their legacy context.
    if (!ctx?.skill || typeof ctx.skill.transform !== 'function') return;
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const skills = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const url = new URL(`${entry.name}/SKILL.md`, skillsRoot);
      const source = await readFile(url, 'utf8');
      const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      // Canonical toolkit frontmatter uses unquoted, single-line fields.
      const name = match?.[1].match(/^name: (.+)$/m)?.[1].trim();
      const description = match?.[1].match(/^description: (.+)$/m)?.[1].trim();
      if (!name || !description) throw new Error(`Invalid toolkit skill frontmatter: ${fileURLToPath(url)}`);
      return { id: name, name, description, path: fileURLToPath(url), content: match[2].trim(), autoinvoke: true };
    }));
    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add({ ...skill });
    });
  },
};
