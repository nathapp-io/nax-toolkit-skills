# Installing nax-toolkit for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed

## Installation

Add nax-toolkit to the `plugin` array in your `opencode.json` (global or
project-level):

```json
{
  "plugin": ["nax-toolkit@git+https://github.com/nathapp-io/nax-toolkit-skills.git"]
}
```

Restart OpenCode. The plugin installs through OpenCode's plugin manager and
registers the nax-toolkit skills (currently nax-setup).

Verify by asking: "use skill tool to list skills" — you should see
`nax-setup`.

> OpenCode uses its own plugin install. If you also use Claude Code, Codex, or
> Cursor, install nax-toolkit separately for each one.

## Local development install

Point OpenCode at a local checkout instead of a git URL:

```json
{
  "plugin": ["/home/<you>/path/to/nax-toolkit"]
}
```

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

To pin a specific version:

```json
{
  "plugin": ["nax-toolkit@git+https://github.com/nathapp-io/nax-toolkit-skills.git#v0.1.0"]
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
