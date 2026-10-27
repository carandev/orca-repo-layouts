# orca-repo-layouts

Orca plugin that opens your terminal tabs and splits automatically in every new worktree, per project.

## Install

1. Orca: **Settings -> Plugins -> Install plugin -> Git URL**.
2. Paste `https://github.com/carandev/orca-repo-layouts.git#v0.4.1` and accept the permissions.

Requires Orca >= 1.4.0. To update, install again with the newer tag.

## Use

1. Command palette (`Ctrl+Shift+J` / `Cmd+J`): **Repo Layouts: Edit config**.
2. Add your projects and their tabs/splits, then **Save**.
3. Create a worktree: the layout opens by itself.

| Command | What it does |
|---------|--------------|
| Repo Layouts: Edit config | Opens the layout editor |
| Repo Layouts: Apply layout (`Mod+Alt+L`) | Applies the layout to the current worktree |
| Repo Layouts: Install shell integration | Adds a `layout` command to your terminal (optional) |
| Repo Layouts: Remove shell integration | Removes it |

Config file format, rules and development: [docs/reference.md](docs/reference.md).
