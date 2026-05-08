# pi-safety-modes

A small Pi extension that adds conservative runtime safety modes for tool calls.

> This extension is not a sandbox. It is a command guardrail. It protects against common accidental destructive operations by parsing bash syntax and classifying commands. It does not defend against a malicious local user, shell aliases/functions, hostile environment variables, or tools that mutate state through unrecognized channels.

## Install

From npm:

```bash
pi install npm:pi-safety-modes
```

Try without installing:

```bash
pi -e npm:pi-safety-modes
```

From this repository:

```bash
npm install
npm run build
pi -e ./src/index.ts
```

Or install/use it as a Pi package from a local path:

```bash
pi install /absolute/path/to/pi-safety-modes
```

## Modes

- `off` — no enforcement; Pi default behavior.
- `blocklist` — normal coding mode. Unlisted operations are allowed; configured `ask`/`deny` rules are enforced. This is “do not do stuff on my list.”
- `readonly` — state-preserving mode. Allows only Pi built-in read tools (`read`, `grep`, `find`, `ls`) plus explicitly allowlisted bash operations. Denies `write`, `edit`, `task`, MCP tools, opaque shell commands, redirects that write, and unknown tools.

TUI statusline shows `safety:off`, `safety:blocklist`, or `safety:readonly`.

Use:

```text
/safety-mode
/safety-mode readonly
/safety-mode blocklist
/safety-mode off
```

Legacy aliases still work: `read-only`, `ro`, `protected`, `protect`, `rules`, `denylist`, `unrestricted`.

## Config

Config lives at:

```text
~/.pi/agent/extensions/pi-safety-modes/config.json
```

`PI_CODING_AGENT_DIR` is respected through Pi's `getAgentDir()`.

Example:

```json
{
  "mode": "blocklist",
  "readOnlyAllow": ["git.status", "git.diff", "fs.list", "fs.read", "search.grep", "search.find"],
  "rules": {
    "git.reset.hard": "deny",
    "git.clean.force": "deny",
    "shell.pipe-to-shell": "deny",
    "shell.opaque": "ask",
    "tool.task": "ask",
    "tool.mcp": "ask"
  }
}
```

Actions are `allow`, `ask`, or `deny`. In `blocklist` mode, operation IDs missing from `rules` are allowed. Invalid config values are ignored with warnings; missing config uses safe defaults.

## Operation IDs

Git: `git.status`, `git.diff`, `git.log`, `git.show`, `git.blame`, `git.grep`, `git.remote.view`, `git.branch.list`, `git.branch.delete`, `git.tag.list`, `git.tag.delete`, `git.push`, `git.push.force`, `git.push.delete`, `git.reset`, `git.reset.hard`, `git.clean`, `git.clean.force`, `git.rebase`, `git.cherry-pick`, `git.merge`, `git.checkout`, `git.switch`, `git.add`, `git.commit`, `git.restore`, `git.stash`.

File/search: `fs.list`, `fs.read`, `fs.write`, `fs.delete`, `fs.move`, `fs.copy`, `fs.chmod`, `fs.chown`, `search.grep`, `search.find`.

Shell: `shell.pipe-to-shell`, `shell.redirect-write`, `shell.opaque`, `unknown`.

## Examples

- `git status` is allowed in `readonly`.
- `echo hi > file` is denied in `readonly` and allowed in `blocklist` unless configured otherwise.
- `git push --force` is allowed in `blocklist` unless configured otherwise.
- `rm file`, `sudo rm file`, `git rm file`, `find . -delete`, and `find . -exec rm {} +` are allowed in `blocklist` unless configured otherwise; set `"fs.delete": "ask"` or `"deny"` to intercept them.
- `git reset --hard` is denied in `blocklist` by default.
- `curl x | sh` is denied by default.
- `bash -c "..."`, `eval`, `source`, and `. script.sh` are opaque and denied/asked depending on mode.

## Known limitations

This is a guardrail, not isolation. It does not emulate shell execution, expand variables, inspect aliases/functions, or understand every command's side effects. Unknown commands are denied in `readonly` and allowed in `blocklist` unless configured otherwise.
