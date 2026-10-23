import nodePath from 'node:path';

/** Absolute cwd for each entry (worktree root when unset), re-checked to stay inside the worktree. */
export function resolveLayoutCwds({ layout, worktreePath, pathApi = nodePath }) {
  const root = pathApi.resolve(worktreePath);
  return layout.map((e) => {
    if (!e.cwd) return root;
    const abs = pathApi.resolve(root, e.cwd);
    const rel = pathApi.relative(root, abs);
    if (rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) {
      throw new Error(`Layout cwd escapes the worktree: ${e.cwd}`);
    }
    return abs;
  });
}

const DIRECTIONS = { right: 'horizontal', down: 'vertical' };

/**
 * Pure planner: validated layout + worktree path -> ordered operations and notes.
 * Operations (`entry` is the layout index; the executor keeps one terminal handle per entry):
 *   { op: 'rename', entry, title }                 entry 0 only
 *   { op: 'agent', entry: 0, agent, title? }       manual mode only: launch the agent; title renames its terminal
 *   { op: 'split', entry, from, direction }        direction is horizontal|vertical
 *   { op: 'tab', entry, title? }
 *   { op: 'browser', entry, url? }                 Orca embedded-browser tab (no terminal handle)
 *   { op: 'send', entry, text, cwd? }              typed into the entry's terminal + Enter
 * `cwd` on a send is the absolute directory the executor checks before touching Orca.
 * `mode` is 'created' (worktree.created event; the "agent" field is ignored) or 'manual' (Apply layout command).
 * Orca has no split ratio, so a ratio other than 0.5 only produces a note.
 */
export function planLayout({ layout, worktreePath, mode = 'created', pathApi = nodePath }) {
  const cwds = resolveLayoutCwds({ layout, worktreePath, pathApi });
  const root = pathApi.resolve(worktreePath);
  const operations = [];
  const notes = new Set();
  layout.forEach((e, i) => {
    if (e.browser !== undefined) {
      operations.push(e.browser === true ? { op: 'browser', entry: i } : { op: 'browser', entry: i, url: e.browser });
      return;
    }
    if (i === 0) {
      if (mode === 'manual' && e.agent) {
        operations.push(e.label ? { op: 'agent', entry: 0, agent: e.agent, title: e.label } : { op: 'agent', entry: 0, agent: e.agent });
      } else if (e.label) {
        operations.push({ op: 'rename', entry: 0, title: e.label });
      }
    } else if (e.split === undefined) {
      operations.push(e.label ? { op: 'tab', entry: i, title: e.label } : { op: 'tab', entry: i });
    } else {
      operations.push({ op: 'split', entry: i, from: e.from, direction: DIRECTIONS[e.split] });
      if (e.ratio !== undefined && e.ratio !== 0.5) {
        notes.add('layout "ratio" is ignored: the Orca CLI cannot size splits');
      }
    }
    if (cwds[i] !== root) operations.push({ op: 'send', entry: i, text: `cd "${cwds[i]}"`, cwd: cwds[i] });
    if (e.command) operations.push({ op: 'send', entry: i, text: e.command });
  });
  return { operations, notes: [...notes] };
}
