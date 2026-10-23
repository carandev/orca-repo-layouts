import test from 'node:test';
import assert from 'node:assert/strict';
import { executePlan } from '../src/execute.mjs';

function harness({ dirs = [] } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    fs: { isDirectory: async (p) => dirs.includes(p) },
    orcaCli: async (args) => {
      calls.push(args);
      const verb = args[1];
      if (verb === 'split') return { split: { handle: `split${++n}`, tabId: 't' } };
      if (verb === 'create') return { terminal: { handle: `tab${++n}` } };
      return {};
    },
  };
}

test('maps operations onto CLI calls and tracks handles per entry', async () => {
  const h = harness({ dirs: ['/wt/a'] });
  const operations = [
    { op: 'rename', entry: 0, title: 'main' },
    { op: 'tab', entry: 1, title: 'api' },
    { op: 'send', entry: 1, text: 'cd "/wt/a"', cwd: '/wt/a' },
    { op: 'split', entry: 2, from: 1, direction: 'vertical' },
    { op: 'send', entry: 2, text: 'lazygit' },
    { op: 'tab', entry: 3 },
  ];
  const { handles } = await executePlan({ operations, worktreeId: 'repo::/wt', firstTerminal: 'term0', ...h });
  assert.deepEqual(h.calls, [
    ['terminal', 'rename', '--terminal', 'term0', '--title', 'main'],
    ['terminal', 'create', '--worktree', 'id:repo::/wt', '--title', 'api'],
    ['terminal', 'send', '--terminal', 'tab1', '--text', 'cd "/wt/a"', '--enter'],
    ['terminal', 'split', '--terminal', 'tab1', '--direction', 'vertical'],
    ['terminal', 'send', '--terminal', 'split2', '--text', 'lazygit', '--enter'],
    ['terminal', 'create', '--worktree', 'id:repo::/wt'],
  ]);
  assert.deepEqual(handles, ['term0', 'tab1', 'split2', 'tab3']);
});

test('a missing cwd fails before any CLI call', async () => {
  const h = harness();
  const operations = [{ op: 'rename', entry: 0, title: 'x' }, { op: 'send', entry: 0, text: 'cd', cwd: '/nope' }];
  await assert.rejects(executePlan({ operations, worktreeId: 'w', firstTerminal: 't', ...h }), /entry 0 cwd does not exist: \/nope/);
  assert.deepEqual(h.calls, []);
});

test('stops at the first CLI error', async () => {
  const calls = [];
  const orcaCli = async (args) => {
    calls.push(args);
    throw new Error('boom');
  };
  const operations = [{ op: 'rename', entry: 0, title: 'x' }, { op: 'send', entry: 0, text: 'y' }];
  await assert.rejects(
    executePlan({ operations, worktreeId: 'w', firstTerminal: 't', orcaCli, fs: { isDirectory: async () => true } }),
    /boom/,
  );
  assert.equal(calls.length, 1);
});

test('a split/create reply without a handle is an error', async () => {
  const fs = { isDirectory: async () => true };
  const orcaCli = async () => ({});
  await assert.rejects(
    executePlan({ operations: [{ op: 'split', entry: 1, from: 0, direction: 'horizontal' }], worktreeId: 'w', firstTerminal: 't', orcaCli, fs }),
    /split returned no terminal handle/,
  );
  await assert.rejects(
    executePlan({ operations: [{ op: 'tab', entry: 1 }], worktreeId: 'w', firstTerminal: 't', orcaCli, fs }),
    /create returned no terminal handle/,
  );
});

test('browser ops run `tab create` and keep no terminal handle', async () => {
  const h = harness();
  const operations = [
    { op: 'browser', entry: 1 },
    { op: 'browser', entry: 2, url: 'https://localhost:5001' },
    { op: 'tab', entry: 3 },
  ];
  const { handles } = await executePlan({ operations, worktreeId: 'repo::/wt', firstTerminal: 'term0', ...h });
  assert.deepEqual(h.calls[0], ['tab', 'create', '--worktree', 'id:repo::/wt']);
  assert.deepEqual(h.calls[1], ['tab', 'create', '--worktree', 'id:repo::/wt', '--url', 'https://localhost:5001']);
  assert.deepEqual(h.calls[2], ['terminal', 'create', '--worktree', 'id:repo::/wt']);
  assert.equal(handles[1], undefined);
  assert.equal(handles[2], undefined);
  assert.equal(handles[3], 'tab3');
});
