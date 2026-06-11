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
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};
