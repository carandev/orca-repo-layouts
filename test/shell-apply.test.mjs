import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runShellApply } from '../src/shell-apply.mjs';

const FILE = '/cfg/config.json';
const WT = 'r::/w/Univer.CRM/wt';
const WT_PATH = '/w/Univer.CRM/wt';
const NOW = 1_000_000_000_000;
const config = (extra = {}) => ({
  ...extra,
  projects: { 'Univer.CRM': { layout: [{ label: 'claude', agent: 'claude' }, { label: 'git', command: 'lazygit' }] } },
});

function setup({ cfg = config(), env = { ORCA_WORKTREE_ID: WT }, terminals = [{ handle: 't0' }], createdAt = NOW - 3_600_000, current } = {}) {
  const calls = [];
  const logs = [];
  const deps = {
    auto: false,
    env,
    now: () => NOW,
    configFile: FILE,
    pathApi: path.posix,
    log: (m) => logs.push(m),
    fs: {
      readFile: async (p) => (p === FILE && cfg !== undefined ? JSON.stringify(cfg) : null),
      isDirectory: async () => true,
      createdAt: async () => createdAt,
    },
    git: async () => '/w/Univer.CRM/.git\n',
    orcaCli: async (args) => {
      calls.push(args);
      if (args[0] === 'worktree' && args[1] === 'current') {
        if (!current) throw new Error('selector_not_found');
        return { worktree: current };
      }
      if (args[0] === 'worktree' && args[1] === 'show') return { worktree: { id: WT, path: WT_PATH } };
      if (args[0] === 'terminal' && args[1] === 'list') return { terminals };
      if (args[0] === 'agent') return { launch: { outcome: { kind: 'terminal', handle: 'agentTerm' } } };
      if (args[1] === 'create') return { terminal: { handle: 'tb' } };
      return {};
    },
  };
  return { calls, logs, deps };
}

test('no ORCA_WORKTREE_ID and no cwd worktree: "not inside an Orca worktree"', async () => {
  const s = setup({ env: {} });
  await assert.rejects(runShellApply(s.deps), /not inside an Orca worktree/);
  assert.deepEqual(s.calls, [['worktree', 'current']]);
});

test('falls back to `worktree current` when the env var is absent', async () => {
  const s = setup({ env: {}, current: { id: WT, path: WT_PATH } });
  const r = await runShellApply(s.deps);
  assert.equal(r.status, 'applied');
  assert.deepEqual(s.calls[0], ['worktree', 'current']);
  assert.deepEqual(s.calls[1], ['worktree', 'show', '--worktree', `id:${WT}`]);
});

test('uses the env id, resolves the path via worktree show, applies in manual mode (agent launched)', async () => {
  const s = setup();
  const r = await runShellApply(s.deps);
  assert.deepEqual(r, { status: 'applied', message: 'Layout applied' });
  assert.deepEqual(s.calls, [
    ['worktree', 'show', '--worktree', `id:${WT}`],
    ['terminal', 'list', '--worktree', `id:${WT}`],
    ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${WT}`],
    ['terminal', 'rename', '--terminal', 'agentTerm', '--title', 'claude'],
    ['terminal', 'create', '--worktree', `id:${WT}`, '--title', 'git'],
    ['terminal', 'send', '--terminal', 'tb', '--text', 'lazygit', '--enter'],
  ]);
});

test('the one-terminal guard reports a message and touches nothing', async () => {
  const s = setup({ terminals: [{ handle: 'a' }, { handle: 'b' }] });
  const r = await runShellApply(s.deps);
  assert.equal(r.status, 'guard');
  assert.match(r.message, /Layout not applied: worktree already has 2 terminals/);
  assert.equal(s.calls.length, 2);
});

test('no matching layout is a no-op with a message', async () => {
  const s = setup({ cfg: { projects: { Other: { layout: [{ command: 'x' }] } } } });
  const r = await runShellApply(s.deps);
  assert.equal(r.status, 'noop');
  assert.match(r.message, /No layout/);
});

test('config errors propagate', async () => {
  const s = setup({ cfg: { projects: { X: { directory: 'd' } } } });
  await assert.rejects(runShellApply(s.deps), /directory/);
});

test('--auto: needs autoApplyOnShellStart true in the config', async () => {
  for (const cfg of [config(), config({ autoApplyOnShellStart: false }), undefined]) {
    const s = setup({ cfg });
    const r = await runShellApply({ ...s.deps, auto: true });
    assert.equal(r.status, 'skipped');
    assert.deepEqual(s.calls, []);
  }
  const s = setup({ cfg: config({ autoApplyOnShellStart: true }) });
  assert.equal((await runShellApply({ ...s.deps, auto: true })).status, 'applied');
});

test('--auto: without an Orca worktree id it is a silent skip, not an error', async () => {
  const s = setup({ cfg: config({ autoApplyOnShellStart: true }), env: {} });
  assert.equal((await runShellApply({ ...s.deps, auto: true })).status, 'skipped');
  assert.deepEqual(s.calls, []);
});

test('--auto: skips worktrees created less than 60 s ago; 60 s and older run', async () => {
  const cfg = config({ autoApplyOnShellStart: true });
  const young = setup({ cfg, createdAt: NOW - 59_999 });
  assert.equal((await runShellApply({ ...young.deps, auto: true })).status, 'skipped');
  assert.ok(young.calls.every((c) => c[1] !== 'create' && c[0] !== 'agent'));
  const old = setup({ cfg, createdAt: NOW - 60_000 });
  assert.equal((await runShellApply({ ...old.deps, auto: true })).status, 'applied');
});

test('--auto: unknown creation time still skips a lone agent terminal but not a plain shell', async () => {
  const cfg = config({ autoApplyOnShellStart: true });
  const lone = setup({ cfg, createdAt: null, terminals: [{ handle: 't0', agentIdentity: 'claude' }] });
  assert.equal((await runShellApply({ ...lone.deps, auto: true })).status, 'skipped');
  const plain = setup({ cfg, createdAt: null, terminals: [{ handle: 't0' }] });
  assert.equal((await runShellApply({ ...plain.deps, auto: true })).status, 'applied');
});

test('--auto: a lone agent terminal is skipped even when the age is known (the agent must not be launched twice)', async () => {
  const s = setup({ cfg: config({ autoApplyOnShellStart: true }), terminals: [{ handle: 't0', agentIdentity: 'claude' }] });
  assert.equal((await runShellApply({ ...s.deps, auto: true })).status, 'skipped');
  assert.ok(s.calls.every((c) => c[0] !== 'agent'));
});

test('interactive mode ignores autoApplyOnShellStart and the age rule', async () => {
  const s = setup({ createdAt: NOW - 1000 });
  assert.equal((await runShellApply(s.deps)).status, 'applied');
});
