import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyForWorktree } from '../src/apply.mjs';

const FILE = '/cfg/config.json';

function setup(config, { repoRoot = '/w/Univer.CRM' } = {}) {
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    deps: {
      worktreeId: 'r::/w/Univer.CRM/wt',
      worktreePath: '/w/Univer.CRM/wt',
      configFile: FILE,
      pathApi: path.posix,
      log: (m) => logs.push(m),
      fs: {
        readFile: async (p) => (p === FILE && config !== undefined ? JSON.stringify(config) : null),
        isDirectory: async () => true,
      },
      git: async () => `${repoRoot}/.git\n`,
      waitForFirstTerminal: async () => ({ handle: 'term0' }),
      orcaCli: async (args) => {
        calls.push(args);
        return args[1] === 'split' ? { split: { handle: 'sp' } } : { terminal: { handle: 'tb' } };
      },
    },
  };
}

test('no config file: logs and does nothing', async () => {
  const s = setup(undefined);
  assert.equal((await applyForWorktree(s.deps)).applied, false);
  assert.equal(s.calls.length, 0);
  assert.match(s.logs.join('\n'), /no config/i);
});

test('no matching project: does nothing', async () => {
  const s = setup({ projects: { Other: { layout: [{ command: 'x' }] } } });
  assert.equal((await applyForWorktree(s.deps)).applied, false);
  assert.equal(s.calls.length, 0);
});

test('empty layout opts out without waiting for a terminal', async () => {
  const s = setup({ projects: { 'Univer.CRM': { layout: [] }, '*': { layout: [{ command: 'x' }] } } });
  s.deps.waitForFirstTerminal = async () => {
    throw new Error('should not wait');
  };
  assert.equal((await applyForWorktree(s.deps)).applied, false);
});

test('applies the matched layout and logs ratio notes once', async () => {
  const s = setup({
    projects: {
      'Univer.CRM': {
        layout: [{ command: 'claude' }, { split: 'right', ratio: 0.3, command: 'x' }, { split: 'down', ratio: 0.3 }],
      },
    },
  });
  const r = await applyForWorktree(s.deps);
  assert.equal(r.applied, true);
  assert.deepEqual(s.calls, [
    ['terminal', 'send', '--terminal', 'term0', '--text', 'claude', '--enter'],
    ['terminal', 'split', '--terminal', 'term0', '--direction', 'horizontal'],
    ['terminal', 'send', '--terminal', 'sp', '--text', 'x', '--enter'],
    ['terminal', 'split', '--terminal', 'sp', '--direction', 'vertical'],
  ]);
  assert.equal(s.logs.filter((l) => /"ratio"/.test(l)).length, 1);
});

test('config validation errors propagate', async () => {
  const s = setup({ projects: { X: { directory: 'd' } } });
  await assert.rejects(applyForWorktree(s.deps), /directory/);
});
