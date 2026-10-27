# Reference

Everything the [README](../README.md) leaves out.

## Config file

`%APPDATA%\orca-repo-layouts\config.json` on Windows, `$XDG_CONFIG_HOME` or `~/.config` elsewhere (`orca-repo-layouts/config.json`). **Repo Layouts: Edit config** writes it for you; this section is for editing it by hand.

```json
{
  "projects": {
    "Univer.CRM": {
      "layout": [
        { "label": "claude" },
        { "label": "api/web", "cwd": "CRM.API" },
        { "split": "down", "cwd": "CRM.Backoffice.Web" },
        { "label": "lazygit", "command": "lazygit" }
      ]
    },
    "*": { "layout": [{ "label": "claude" }, { "label": "lazygit", "command": "lazygit" }] }
  }
}
```

Project key lookup uses the main repo root (resolved from the worktree via git): absolute path key, then folder-name key, then `"*"`. The first match is used whole (no merging); `"layout": []` opts a project out. Matching is case/slash-insensitive on Windows.

Layout entries:

- Entry 0 is the worktree's first terminal. Every later entry without `split` opens a new tab.
- When Orca starts an agent with the worktree, entry 0 is that agent's terminal: give it only a `label`, since a `command` would be typed into the agent as a prompt.
- `agent`: (entry 0 only) agent id, e.g. `"claude"`. Used only by the manual Apply layout command; ignored on new worktrees because Orca's new-workspace composer already starts the agent there.
- `command`: typed into the terminal and run.
- `label`: terminal/tab title (entry 0 and tab entries only).
- `cwd`: directory relative to the worktree (must exist, no `..` escape).
- `split`: `right` or `down` (not on entry 0).
- `from`: index of an earlier entry to split (needs `split`; default: the previous entry).
- `ratio`: accepted, ignored (the Orca CLI cannot size splits).
- `browser`: `true` (blank tab) or an `http`/`https` URL: opens a tab in Orca's embedded browser. A browser entry is always its own tab: not allowed on entry 0, and combining it with any other key is an error. A `split` entry cannot split a browser entry.

Top-level `"autoApplyOnShellStart": true` (optional, default `false`) enables the shell-start hook.

`directory` is not supported: Orca decides where worktrees live. Unknown keys are errors; a config error is reported as an Orca notification naming the file.

## Config editor

- Runs inside the plugin and opens in an Orca browser tab of the active worktree (falls back to your default browser; the URL is also shown in a notification).
- Localhost only: `127.0.0.1`, random port, random per-run token in the URL; other `Host` or cross-origin `Origin` requests are rejected.
- Validates with the same rules as the plugin; writes atomically and only on Save. `ratio` is kept when already present.
- Stops after 15 minutes without requests; run the command again for a new URL.

## When a layout is applied

1. **New worktree**: automatically.
2. **Existing worktree, from the app**: **Repo Layouts: Apply layout** (`Mod+Alt+L`).
3. **Existing worktree, from a terminal**: the `layout` shell command, or the shell-start hook. Orca does not dispatch plugin keybindings while a terminal has focus, which is why this exists.

Rules for 2 and 3:

- Applied only when the worktree has exactly one terminal (the plain shell Orca opens); otherwise "Layout not applied: worktree already has N terminals" and nothing is touched. With zero terminals, entry 0 is created.
- `agent` on entry 0 is launched first (`orca agent launch`); if it opens as a terminal and entry 0 has a `label`, it is renamed.
- The plain shell that was already open stays as is; it only receives entry 0's `cwd`/`command` if set.

## Shell integration

**Repo Layouts: Install shell integration** updates the Windows PowerShell 5.1 profile (and PowerShell 7 when `pwsh` exists) on Windows, or `~/.bashrc` / `~/.zshrc` elsewhere. After a plugin update moves the installed folder, the block is rewritten to the new path when Orca starts. **Repo Layouts: Remove shell integration** undoes it.

- `layout`: applies the layout to the calling terminal's worktree. Prints one line and exits non-zero on error. Outside Orca it prints `not inside an Orca worktree`.
- `--auto` (shell-start hook): silent, errors go to `auto.log` next to `config.json`. Runs only with `"autoApplyOnShellStart": true`, and skips worktrees younger than 60 s (to avoid racing the new-worktree handler) and worktrees whose only terminal is an agent.

From a clone, by hand (backs up the profile once to `<profile>.bak-orca-repo-layouts`):

```
node bin/install-shell.mjs                 # Windows PowerShell 5.1
node bin/install-shell.mjs --shell pwsh    # PowerShell 7
node bin/install-shell.mjs --shell bash    # print the bash/zsh snippet
node bin/install-shell.mjs --uninstall     # remove the block
```

## Orca CLI

The plugin drives the Orca CLI: `orca.exe` from the Orca install on Windows; `~/.local/bin/orca-ide` on Linux (install the CLI from Orca), then Orca's shim `~/.config/orca/linux-orca-cli-shim/orca` (honoring `XDG_CONFIG_HOME`), then the packaged `/usr/lib/orca-ide/bin/orca-ide`, falling back to `orca-ide` on `PATH`; `orca` on `PATH` on macOS.

## Development

Settings -> Plugins -> add a dev plugin and pick this folder. `npm test` runs the tests (Node >= 22).

## Releasing

1. Bump `version` in `orca-plugin.json` and `package.json`, `ref` in `orca-marketplace.json`, and the `#vX.Y.Z` in the README install URL.
2. Push to `main`. The Release workflow runs the tests, checks that those four agree, and creates the `vX.Y.Z` tag and GitHub release (only when the tag does not exist yet).
