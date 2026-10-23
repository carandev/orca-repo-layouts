/**
 * Runs planned operations through the Orca CLI.
 * Ports: orcaCli(args) -> result, fs {isDirectory(path) -> boolean}.
 * `firstTerminal` is the handle of entry 0 (an 'agent' op never replaces it). Returns { handles } (index-aligned with the layout; browser entries have no handle).
 * Directories are checked up front so a bad cwd fails before any terminal is touched.
 */
export async function executePlan({ operations, worktreeId, firstTerminal, orcaCli, fs }) {
  for (const o of operations) {
    if (o.cwd && !(await fs.isDirectory(o.cwd))) {
      throw new Error(`Layout entry ${o.entry} cwd does not exist: ${o.cwd}`);
    }
  }
  const handles = [firstTerminal];
  for (const o of operations) {
    if (o.op === 'rename') {
      await orcaCli(['terminal', 'rename', '--terminal', handles[o.entry], '--title', o.title]);
    } else if (o.op === 'agent') {
      const result = await orcaCli(['agent', 'launch', '--agent', o.agent, '--worktree', `id:${worktreeId}`]);
      const outcome = result?.launch?.outcome;
      if (o.title && outcome?.kind === 'terminal') {
        await orcaCli(['terminal', 'rename', '--terminal', handleOf(outcome, 'agent launch'), '--title', o.title]);
      }
    } else if (o.op === 'split') {
      const result = await orcaCli(['terminal', 'split', '--terminal', handles[o.from], '--direction', o.direction]);
      handles[o.entry] = handleOf(result?.split, 'split');
    } else if (o.op === 'tab') {
      const args = ['terminal', 'create', '--worktree', `id:${worktreeId}`];
      if (o.title) args.push('--title', o.title);
      handles[o.entry] = handleOf((await orcaCli(args))?.terminal, 'create');
    } else if (o.op === 'browser') {
      const args = ['tab', 'create', '--worktree', `id:${worktreeId}`];
      if (o.url) args.push('--url', o.url);
      await orcaCli(args);
    } else if (o.op === 'send') {
      await orcaCli(['terminal', 'send', '--terminal', handles[o.entry], '--text', o.text, '--enter']);
    } else {
      throw new Error(`Unknown layout operation: ${o.op}`);
    }
  }
  return { handles };
}

function handleOf(node, what) {
  const handle = node?.handle;
  if (typeof handle !== 'string' || !handle) throw new Error(`orca terminal ${what} returned no terminal handle`);
  return handle;
}
