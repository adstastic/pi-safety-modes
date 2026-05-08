---
name: pi-safety-modes
description: Manage pi-safety-modes safety mode and config. Use when the user asks to edit safety rules, set readonly/blocklist/off, allow/ask/deny operations, inspect pi-safety-modes behavior, or configure the Pi safety guardrail.
---

# pi-safety-modes

pi-safety-modes is a Pi extension with three modes:

- `off`: no enforcement.
- `blocklist`: normal coding mode. Unlisted operations are allowed; configured `ask`/`deny` rules are enforced.
- `readonly`: state-preserving mode. Denies write/edit/task/MCP, opaque shell, write redirects, unknown tools, and bash ops not in `readOnlyAllow`.

This is a guardrail, not a sandbox.

## Commands

Use slash commands when user asks to switch modes:

```text
/safety-mode
/safety-mode readonly
/safety-mode blocklist
/safety-mode off
```

Legacy aliases: `read-only`, `ro`, `protected`, `protect`, `rules`, `denylist`, `unrestricted`.

## Config path

Default config path:

```text
~/.pi/agent/extensions/pi-safety-modes/config.json
```

If `PI_CODING_AGENT_DIR` is set, config path is:

```text
$PI_CODING_AGENT_DIR/extensions/pi-safety-modes/config.json
```

Use `/safety-mode` to show current mode and resolved config path.

## Editing rules

If user asks to edit rules, read and edit config JSON.

If current mode is `readonly`, do not try to use `edit`/`write` first. Tell user to run:

```text
/safety-mode blocklist
```

Then edit config.

Minimal config shape:

```json
{
  "mode": "blocklist",
  "rules": {
    "fs.delete": "ask",
    "git.push.force": "ask",
    "git.reset.hard": "deny",
    "git.clean.force": "deny",
    "shell.pipe-to-shell": "deny"
  }
}
```

Actions: `allow`, `ask`, `deny`.

In `blocklist`, missing rules are allowed. Add rules only for stuff user wants intercepted.

In `readonly`, `readOnlyAllow` controls recognized bash ops that can run.

## Common operation IDs

Filesystem:

- `fs.delete` — `rm`, `rmdir`, `unlink`, `git rm`, `find -delete`, `find -exec rm ...`
- `fs.write` — `touch`, `tee`, `install`, `ln`, `truncate`, `dd`, `sed -i`
- `fs.move` — `mv`
- `fs.copy` — `cp`, `rsync`
- `fs.chmod`
- `fs.chown`

Git:

- `git.push`
- `git.push.force`
- `git.push.delete`
- `git.reset`
- `git.reset.hard`
- `git.clean`
- `git.clean.force`
- `git.branch.delete`
- `git.tag.delete`
- `git.rebase`
- `git.cherry-pick`
- `git.merge`
- `git.checkout`
- `git.switch`
- `git.add`
- `git.commit`
- `git.restore`
- `git.stash`

Shell/tool:

- `shell.pipe-to-shell` — e.g. `curl x | sh`, including common wrappers.
- `shell.opaque` — shell wrappers/eval/source/expansions where intent is not fully known. Not blocked by default in `blocklist`; add `"shell.opaque": "ask"` only if user wants a stricter mode.
- `shell.redirect-write` — shell redirects that write files.
- `tool.task`
- `tool.mcp`
- `unknown`

## Common requests

Ask before deletes:

```json
{
  "rules": {
    "fs.delete": "ask"
  }
}
```

Block deletes:

```json
{
  "rules": {
    "fs.delete": "deny"
  }
}
```

Ask before force push:

```json
{
  "rules": {
    "git.push.force": "ask"
  }
}
```

Block install scripts:

```json
{
  "rules": {
    "shell.pipe-to-shell": "deny"
  }
}
```

Ask on unknown commands in blocklist mode:

```json
{
  "rules": {
    "unknown": "ask"
  }
}
```
