import nodePath from 'node:path';
import { loadConfig, matchProject } from './config.mjs';
import { resolveMainRepoRoot } from './context.mjs';
import { planLayout } from './plan.mjs';
import { executePlan } from './execute.mjs';

/**
 * Shared path for both triggers.
 * trigger: 'created' (worktree.created event) | 'manual' (Apply layout command).
 * Ports: fs {readFile, isDirectory}, git(args, cwd) -> stdout, orcaCli(args) -> result, log(message).
 * `getFirstTerminal()` -> {handle} | null runs only once a layout matched (null: the worktree has no terminal).
 * `terminalCount` (manual only) enforces the duplicate guard: more than one terminal means the layout was
 * already applied (or the user has their own tabs), so nothing is touched.
 * `repoRoot` skips git resolution (dry runs).
 * Returns { applied, operations?, notice? }; throws on any error.
 */
export async function applyLayout({
  trigger,
  worktreeId,
  worktreePath,
  repoRoot,
  terminalCount,
  getFirstTerminal,
  configFile,
  fs,
  git,
  orcaCli,
  log,
  pathApi = nodePath,
}) {
  const config = await loadConfig({ configFile, fs });
  if (!config) {
    const notice = `No config at ${configFile}: run "Repo Layouts: Edit config" to create one`;
    log(notice);
    return trigger === 'manual' ? { applied: false, notice } : { applied: false };
  }
  const root = repoRoot ?? (await resolveMainRepoRoot({ startDirs: [worktreePath], git })).repoRoot;
  const match = matchProject(config.projects, root, pathApi);
  if (!match || match.entry.layout.length === 0) {
    log(`no layout for ${root}${match ? ` (project "${match.key}" opts out)` : ''}`);
    return { applied: false };
  }
  if (trigger === 'manual' && terminalCount > 1) {
    const notice = `Layout not applied: worktree already has ${terminalCount} terminals`;
    log(notice);
    return { applied: false, notice };
  }
  const layout = match.entry.layout;
  const { operations: planned, notes } = planLayout({ layout, worktreePath, mode: trigger, pathApi });
  for (const note of notes) log(note);
  let operations = planned;
  let first = await getFirstTerminal();
  if (!first) {
    // Zero terminals (manual only): entry 0 has nothing to reuse, so create it with its label as title.
    const args = ['terminal', 'create', '--worktree', `id:${worktreeId}`];
    if (layout[0].label) args.push('--title', layout[0].label);
    const handle = (await orcaCli(args))?.terminal?.handle;
    if (typeof handle !== 'string' || !handle) throw new Error('orca terminal create returned no terminal handle');
    first = { handle };
    operations = planned.filter((o) => !(o.op === 'rename' && o.entry === 0));
  }
  await executePlan({ operations, worktreeId, firstTerminal: first.handle, orcaCli, fs });
  log(`applied layout "${match.key}" to ${worktreePath} (${operations.length} operations, ${trigger})`);
  return { applied: true, operations };
}

/** worktree.created resolver: waits for Orca to open the first terminal, then applies. */
export function applyForWorktree({ waitForFirstTerminal, ...rest }) {
  return applyLayout({
    ...rest,
    trigger: 'created',
    getFirstTerminal: () => waitForFirstTerminal(rest.worktreeId),
  });
}

const stripRef = (branch) => (typeof branch === 'string' ? branch.replace(/^refs\/heads\//, '') : '');

/**
 * Finds the active worktree via `readContext()` (null | { branch, displayName, terminals: [{ id }] }).
 * Returns { worktreeId, worktreePath, terminals } or null when no worktree is focused; throws when it cannot be resolved.
 */
export async function resolveActiveWorktree({ readContext, orcaCli }) {
  const context = await readContext();
  if (!context) return null;
  const terminals = context.terminals ?? [];
  let worktreeId;
  let worktreePath;
  if (terminals.length > 0) {
    const shown = (await orcaCli(['terminal', 'show', '--terminal', terminals[0].id]))?.terminal;
    worktreeId = shown?.worktreeId;
    worktreePath = shown?.worktreePath;
  } else {
    const { worktrees = [] } = await orcaCli(['worktree', 'list']);
    const matches = worktrees.filter(
      (w) => w.displayName === context.displayName && stripRef(w.branch) === stripRef(context.branch),
    );
    if (matches.length === 0) throw new Error(`No worktree matches "${context.displayName}" (${context.branch})`);
    if (matches.length > 1) {
      throw new Error(`Multiple worktrees match "${context.displayName}" (${context.branch}); cannot pick one`);
    }
    worktreeId = matches[0].id;
    worktreePath = matches[0].path;
  }
  if (!worktreeId || !worktreePath) throw new Error('Could not resolve the active worktree id and path');
  return { worktreeId, worktreePath, terminals };
}

/** Apply layout command resolver: resolves the active worktree, then applies in manual mode. */
export async function applyForActiveWorktree({ readContext, ...rest }) {
  const active = await resolveActiveWorktree({ readContext, orcaCli: rest.orcaCli });
  if (!active) return { applied: false, notice: 'No active worktree' };
  const { worktreeId, worktreePath, terminals } = active;
  return applyLayout({
    ...rest,
    trigger: 'manual',
    worktreeId,
    worktreePath,
    terminalCount: terminals.length,
    getFirstTerminal: async () => (terminals.length > 0 ? { handle: terminals[0].id } : null),
  });
}
