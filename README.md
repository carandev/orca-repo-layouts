# orca-repo-layouts

Orca plugin that applies a per-project terminal layout (tabs and splits, with labels and commands) to every new worktree, for any repository.

## Install

Orca: Settings -> Plugins -> add a dev plugin and pick this folder. Requires Orca >= 1.4.0 and Node >= 22 for tests (`npm test`).

The plugin drives the Orca CLI: `orca.exe` from the Orca install on Windows; on Linux `~/.local/bin/orca-ide` (install the CLI from Orca), falling back to `orca-ide` on `PATH`; `orca` on `PATH` on macOS.

## Config

`%APPDATA%\orca-repo-layouts\config.json` on Windows, `$XDG_CONFIG_HOME` or `~/.config` elsewhere (`orca-repo-layouts/config.json`).

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
- `agent`: (entry 0 only) agent id, e.g. `"claude"`. Used only by the manual Apply layout command (see below); ignored on new worktrees because Orca's new-workspace composer already starts the agent there.
- `command`: typed into the terminal and run.
- `label`: terminal/tab title (entry 0 and tab entries only).
- `cwd`: directory relative to the worktree (must exist, no `..` escape).
- `split`: `right` or `down` (not on entry 0).
- `from`: index of an earlier entry to split (needs `split`; default: the previous entry).
- `ratio`: accepted, ignored.
- `browser`: `true` (blank tab) or an `http`/`https` URL: opens a tab in Orca's embedded browser (`orca tab create [--url]`). A browser entry is always its own tab: not allowed on entry 0, and combining it with `split`, `from`, `ratio`, `label`, `cwd`, `command` or `agent` is an error (the CLI has no title option). A `split` entry cannot split a browser entry, so `from` (explicit or the default previous entry) must not point at one. Works in every trigger.

Top-level `"autoApplyOnShellStart": true` (optional boolean, default `false`) enables the shell-start trigger below.

`directory` is not supported: Orca decides where worktrees live. Unknown keys are errors; a config error is reported as an Orca notification naming the file.

## Triggers

1. **New worktree**: applied automatically by the plugin (`worktree.created`).
2. **Existing worktree, from the app**: the command palette (Cmd+J / Ctrl+Shift+J) or the keybinding below.
3. **Existing worktree, from a terminal**: the `layout` shell command, and optionally a hook that runs when a terminal starts (see "Shell integration"). Orca does not dispatch plugin keybindings while a terminal has focus, which is why this exists.

## Apply layout to an existing worktree

Command **Repo Layouts: Apply layout** (keybinding `Mod+Alt+L`, worktree scope) applies the matching layout to the active worktree. Remap it in Orca's keybinding settings, or run it from the command palette (Cmd+J). Requires the `workspace:read` capability.

- One-terminal guard: the layout is applied only when the worktree has exactly one terminal (the plain shell Orca opens). With more than one, a notification says "Layout not applied: worktree already has N terminals" and nothing is touched. With zero terminals, entry 0 is created (titled with its `label`) and the layout continues from it.
- `agent` on entry 0: before the rest of the layout, the plugin runs `orca agent launch --agent <id>` for the worktree (chat or terminal, per your Orca setting). If it opens as a terminal and entry 0 has a `label`, that agent terminal is renamed to the label.
- Leftover shell tab: the plain shell that was already open stays as is (not closed, not renamed). It only receives entry 0's `cwd`/`command` if you set them.
- Success shows a short "Layout applied" notification; errors are logged and notified.

## Shell integration

`bin/apply-layout.mjs` applies the layout to the worktree of the calling terminal, with the same rules as the command above (manual mode: entry-0 `agent` is launched, one-terminal guard, project matching, config). The worktree comes from `ORCA_WORKTREE_ID` (exported by Orca into every terminal), falling back to `orca worktree current`; outside Orca it prints `not inside an Orca worktree` and exits 1. The layout's entry 0 uses the worktree's first terminal, not necessarily the one you typed in.

- `layout`: interactive. Prints one line (`Layout applied`, the guard message, or an error) and exits non-zero on error.
- `--auto`: the shell-start hook. Silent; errors are appended to `auto.log` next to `config.json`. It runs only when `"autoApplyOnShellStart": true`, and skips: worktrees created less than 60 s ago (so it never races the `worktree.created` handler; Orca exposes no creation time, so the age is the birth time of `<worktree>/.git`), and a worktree whose only terminal is an agent terminal. Turn it off by setting `autoApplyOnShellStart` to `false` (or removing it); `layout` keeps working.

Install the shell block (PowerShell 5.1 by default; backs up an existing profile once to `<profile>.bak-orca-repo-layouts`; re-running replaces the block):

```
node bin/install-shell.mjs                 # Windows PowerShell 5.1
node bin/install-shell.mjs --shell pwsh    # PowerShell 7
node bin/install-shell.mjs --print         # show the block only
node bin/install-shell.mjs --uninstall     # remove the block
```

Bash/zsh (Linux, macOS): add this to `~/.bashrc` / `~/.zshrc` (`node bin/install-shell.mjs --shell bash --print` prints it with your path):

```sh
# >>> orca-repo-layouts >>>
layout() { node '/path/to/orca-repo-layouts/bin/apply-layout.mjs' "$@"; }
[ -n "$ORCA_WORKTREE_ID" ] && ( node '/path/to/orca-repo-layouts/bin/apply-layout.mjs' --auto >/dev/null 2>&1 & )
# <<< orca-repo-layouts <<<
```

## Differences from the Herdr plugin

- No split ratio: the Orca CLI cannot size splits, so `ratio` is ignored (logged when not 0.5).
- No per-pane cwd: the plugin types `cd "<abs path>"` into the terminal before the command.
