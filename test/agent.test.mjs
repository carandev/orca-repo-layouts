import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { planLayout } from '../src/plan.mjs';
import { executePlan } from '../src/execute.mjs';

const plan = (layout, mode) => planLayout({ layout, worktreePath: '/wt', pathApi: path.posix, mode });

test('plan: manual mode plans an agent op first and skips the entry 0 rename', () => {
  const { operations } = plan(
    [{ label: 'claude', agent: 'claude', cwd: 'sub' }, { label: 'git', command: 'lazygit' }],
    'manual',
  );
  assert.deepEqual(operations, [
    { op: 'agent', entry: 0, agent: 'claude', title: 'claude' },
    { op: 'send', entry: 0, text: 'cd "/wt/sub"', cwd: '/wt/sub' },
    { op: 'tab', entry: 1, title: 'git' },
    { op: 'send', entry: 1, text: 'lazygit' },
  ]);
});

test('plan: manual mode without a label plans no title', () => {
  assert.deepEqual(plan([{ agent: 'codex' }], 'manual').operations, [{ op: 'agent', entry: 0, agent: 'codex' }]);
});

test('plan: agent is ignored in created mode (default) and the label still renames', () => {
  const expected = [{ op: 'rename', entry: 0, title: 'claude' }];
  assert.deepEqual(plan([{ label: 'claude', agent: 'claude' }]).operations, expected);
  assert.deepEqual(plan([{ label: 'claude', agent: 'claude' }], 'created').operations, expected);
});

test('plan: manual mode without agent still renames entry 0', () => {
  assert.deepEqual(plan([{ label: 'x' }], 'manual').operations, [{ op: 'rename', entry: 0, title: 'x' }]);
});

const layoutOf = async (layout) => {
  const fs = { readFile: async () => JSON.stringify({ projects: { P: { layout } } }) };
  return (await loadConfig({ configFile: 'c.json', fs })).projects.P.layout;
};

test('config: agent is a non-empty string allowed on entry 0 only', async () => {
  assert.deepEqual(await layoutOf([{ label: 'c', agent: 'claude' }]), [{ label: 'c', agent: 'claude' }]);
  await assert.rejects(layoutOf([{ agent: '' }]), /agent.*non-empty string/);
  await assert.rejects(layoutOf([{ agent: 3 }]), /agent.*non-empty string/);
  await assert.rejects(layoutOf([{}, { agent: 'claude' }]), /agent.*first entry/);
  await assert.rejects(layoutOf([{}, { split: 'right', agent: 'claude' }]), /agent.*first entry/);
});

const run = async (operations, outcome) => {
  const calls = [];
  const orcaCli = async (args) => {
    calls.push(args);
    return args[0] === 'agent' ? { launch: { outcome } } : {};
  };
  const r = await executePlan({
    operations,
    worktreeId: 'r::/wt',
    firstTerminal: 'term0',
    orcaCli,
    fs: { isDirectory: async () => true },
  });
  return { calls, ...r };
};

test('execute: agent op launches the agent; a terminal outcome is renamed to the title', async () => {
  const { calls, handles } = await run(
    [
      { op: 'agent', entry: 0, agent: 'claude', title: 'claude' },
      { op: 'send', entry: 0, text: 'cd "/wt/a"' },
    ],
    { kind: 'terminal', handle: 'agentTerm' },
  );
  assert.deepEqual(calls, [
    ['agent', 'launch', '--agent', 'claude', '--worktree', 'id:r::/wt'],
    ['terminal', 'rename', '--terminal', 'agentTerm', '--title', 'claude'],
    ['terminal', 'send', '--terminal', 'term0', '--text', 'cd "/wt/a"', '--enter'],
  ]);
  assert.deepEqual(handles, ['term0']);
});

test('execute: a structured (chat) outcome or a missing title is not renamed', async () => {
  const chat = await run([{ op: 'agent', entry: 0, agent: 'claude', title: 't' }], { kind: 'structured', handle: 'c' });
  assert.equal(chat.calls.length, 1);
  const untitled = await run([{ op: 'agent', entry: 0, agent: 'claude' }], { kind: 'terminal', handle: 'a' });
  assert.equal(untitled.calls.length, 1);
});
