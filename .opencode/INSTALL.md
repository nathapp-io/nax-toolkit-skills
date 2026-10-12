# Installing nax-toolkit for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed

## OpenCode 2.0 (2.0.4 or newer)

Add the package to the plural `plugins` array in `opencode.json` (global or
project-level):

```json
{
  "plugins": ["git+https://github.com/nathapp-io/nax-toolkit-skills.git"]
}
```

For a local checkout, use its package directory containing `index.js`:

```json
{
  "plugins": ["file:///absolute/path/to/nax-toolkit-skills"]
}
```

The default definition registers all bundled skills through `ctx.skill.transform`.
Skill paths point to the installed `SKILL.md` files so references remain available.

## OpenCode 1.x

For **1.18.29 and newer**, the same package exposes a `server()` implementation.
Use the singular `plugin` key:

```json
{
  "plugin": ["nax-toolkit@git+https://github.com/nathapp-io/nax-toolkit-skills.git"]
}
```

For **older 1.x releases**, clone this repository and point directly at the
legacy function entry (requires a release with native `skills.paths` support):

```json
{
  "plugin": ["file:///absolute/path/to/nax-toolkit-skills/.opencode/plugins/nax-toolkit.js"]
}
```

This entry remains available as the package subpath `nax-toolkit/v1`.
The V1 config hook adds the bundled skills directory while preserving existing
skill paths and URLs.

Restart OpenCode after installing. Ask it to load `nax-setup` using its native
skill tool to verify discovery. Install separately for Claude Code, Codex, or Cursor.

## Usage

Use OpenCode's native `skill` tool:

```
use skill tool to list skills
use skill tool to load nax-setup
```

Or just say "set up nax for this repo" / "configure nax for this project".

## Updating

OpenCode installs git-backed plugins through a package spec. Some OpenCode/Bun
versions pin the resolved git dependency in a lockfile or cache, so a restart
may not pick up the newest commit. If updates do not appear, clear OpenCode's
package cache or reinstall the plugin.

To pin a specific version on V2 (use `plugin` on V1):

```json
{
  "plugins": ["git+https://github.com/nathapp-io/nax-toolkit-skills.git#<tag-or-commit>"]
}
```

## Troubleshooting

### Plugin not loading

1. Check logs: `opencode run --print-logs "hello" 2>&1 | grep -i toolkit`
2. Verify the plugin line in your `opencode.json`
3. Make sure you're running a recent version of OpenCode

### Skills not found

1. Use the `skill` tool to list what's discovered
2. Confirm the plugin is loading (see above)

### Tool mapping

When skills reference Claude Code tools, substitute OpenCode equivalents:
- `TodoWrite` → `todowrite`
- `Task` with subagents → OpenCode's subagent system (`@mention`)
- `Skill` tool → OpenCode's native `skill` tool
- `Read`, `Write`, `Edit`, `Bash` → your native tools

## Compatibility checks

Run `npm run test:opencode` to verify V2 registration, transform replay, and both
V1 entrypoints. The shared default export follows the
[official V1/V2 migration pattern](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1).
These are API contract checks; validate a release in each target OpenCode runtime
before publishing.

The dependency-free named V1 export and default V2 definition follow
[Superpowers](https://github.com/obra/superpowers/blob/main/.opencode/plugins/superpowers.js).
