import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyForActiveWorktree, applyForWorktree } from '../src/apply.mjs';

const FILE = '/cfg/config.json';
const WT = 'r::/w/Univer.CRM/wt';
const WT_PATH = '/w/Univer.CRM/wt';
const agentConfig = {
  projects: {
    'Univer.CRM': { layout: [{ label: 'claude', agent: 'claude' }, { label: 'git', command: 'lazygit' }] },
  },
};
const listed = { id: WT, path: WT_PATH, branch: 'refs/heads/feat', displayName: 'feat' };

function setup(config, { context, list } = {}) {
  const calls = [];
  const logs = [];
  const deps = {
    configFile: FILE,
    pathApi: path.posix,
    log: (m) => logs.push(m),
    fs: {
      readFile: async (p) => (p === FILE ? JSON.stringify(config) : null),
      isDirectory: async () => true,
    },
    git: async () => '/w/Univer.CRM/.git\n',
    readContext: async () =>
      context === undefined ? { branch: 'refs/heads/feat', displayName: 'feat', terminals: [{ id: 'term0' }] } : context,
    orcaCli: async (args) => {
      calls.push(args);
      if (args[0] === 'terminal' && args[1] === 'show') {
        return { terminal: { handle: args[3], worktreeId: WT, worktreePath: WT_PATH } };
      }
      if (args[0] === 'worktree') return { worktrees: list ?? [listed] };
      if (args[0] === 'agent') return { launch: { outcome: { kind: 'terminal', handle: 'agentTerm' } } };
      if (args[1] === 'create') return { terminal: { handle: 'tb' } };
      return {};
    },
  };
  return { calls, logs, deps };
}

test('manual: no active worktree returns a notice', async () => {
  const s = setup(agentConfig, { context: null });
  const r = await applyForActiveWorktree(s.deps);
  assert.equal(r.applied, false);
  assert.match(r.notice, /No active worktree/);
  assert.equal(s.calls.length, 0);
});

test('manual: one terminal applies the layout including the agent launch', async () => {
  const s = setup(agentConfig);
  const r = await applyForActiveWorktree(s.deps);
  assert.equal(r.applied, true);
  assert.deepEqual(s.calls, [
    ['terminal', 'show', '--terminal', 'term0'],
    ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${WT}`],
    ['terminal', 'rename', '--terminal', 'agentTerm', '--title', 'claude'],
    ['terminal', 'create', '--worktree', `id:${WT}`, '--title', 'git'],
    ['terminal', 'send', '--terminal', 'tb', '--text', 'lazygit', '--enter'],
  ]);
});

test('manual: more than one terminal is refused with a notice', async () => {
  const s = setup(agentConfig, {
    context: { branch: 'feat', displayName: 'feat', terminals: [{ id: 'a' }, { id: 'b' }] },
  });
  const r = await applyForActiveWorktree(s.deps);
  assert.equal(r.applied, false);
  assert.match(r.notice, /Layout not applied: worktree already has 2 terminals/);
  assert.ok(s.calls.every((c) => c[1] === 'show'));
});

test('manual: zero terminals resolves via worktree list (branch with or without refs/heads) and creates entry 0', async () => {
  const s = setup(
    { projects: { 'Univer.CRM': { layout: [{ label: 'main' }] } } },
    { context: { branch: 'feat', displayName: 'feat', terminals: [] } },
  );
  const r = await applyForActiveWorktree(s.deps);
  assert.equal(r.applied, true);
  assert.deepEqual(s.calls, [
    ['worktree', 'list'],
    ['terminal', 'create', '--worktree', `id:${WT}`, '--title', 'main'],
  ]);
});

test('manual: zero terminals with an ambiguous or missing worktree match errors', async () => {
  const context = { branch: 'feat', displayName: 'feat', terminals: [] };
  await assert.rejects(
    applyForActiveWorktree(setup(agentConfig, { context, list: [listed, { ...listed, id: 'o' }] }).deps),
    /multiple/i,
  );
  await assert.rejects(applyForActiveWorktree(setup(agentConfig, { context, list: [] }).deps), /no worktree/i);
});

test('created trigger ignores the agent field', async () => {
  const s = setup(agentConfig);
  await applyForWorktree({
    ...s.deps,
    worktreeId: WT,
    worktreePath: WT_PATH,
    waitForFirstTerminal: async () => ({ handle: 'term0' }),
  });
  assert.deepEqual(s.calls[0], ['terminal', 'rename', '--terminal', 'term0', '--title', 'claude']);
  assert.ok(!s.calls.some((c) => c[0] === 'agent'));
});
