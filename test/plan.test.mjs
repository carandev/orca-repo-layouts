import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { planLayout, resolveLayoutCwds } from '../src/plan.mjs';

const plan = (layout, worktreePath = '/wt') => planLayout({ layout, worktreePath, pathApi: path.posix });

test('resolveLayoutCwds defaults to the worktree root', () => {
  assert.deepEqual(
    resolveLayoutCwds({ layout: [{}, { cwd: 'src/api' }], worktreePath: '/wt', pathApi: path.posix }),
    ['/wt', '/wt/src/api'],
  );
});

test('resolveLayoutCwds rejects an escaping cwd', () => {
  assert.throws(
    () => resolveLayoutCwds({ layout: [{ cwd: '../x' }], worktreePath: '/wt', pathApi: path.posix }),
    /escapes the worktree/,
  );
});

test('entry 0: label renames, cwd cds, command runs, in that order', () => {
  const { operations } = plan([{ label: 'claude', cwd: 'sub', command: 'claude' }]);
  assert.deepEqual(operations, [
    { op: 'rename', entry: 0, title: 'claude' },
    { op: 'send', entry: 0, text: 'cd "/wt/sub"', cwd: '/wt/sub' },
    { op: 'send', entry: 0, text: 'claude' },
  ]);
});

test('a bare first entry plans nothing', () => {
  assert.deepEqual(plan([{}]), { operations: [], notes: [] });
});

test('right/down map to horizontal/vertical and split the `from` entry', () => {
  const { operations } = plan([{}, { split: 'right', from: 0, command: 'a' }, { split: 'down', from: 0 }]);
  assert.deepEqual(operations, [
    { op: 'split', entry: 1, from: 0, direction: 'horizontal' },
    { op: 'send', entry: 1, text: 'a' },
    { op: 'split', entry: 2, from: 0, direction: 'vertical' },
  ]);
});

test('an entry without split opens a tab with its label as title', () => {
  const { operations } = plan([{}, { label: 'lazygit', command: 'lazygit' }, { cwd: 'a' }]);
  assert.deepEqual(operations, [
    { op: 'tab', entry: 1, title: 'lazygit' },
    { op: 'send', entry: 1, text: 'lazygit' },
    { op: 'tab', entry: 2 },
    { op: 'send', entry: 2, text: 'cd "/wt/a"', cwd: '/wt/a' },
  ]);
});

test('ratio other than 0.5 yields a single note; 0.5 and absent yield none', () => {
  const l = (r) => [{}, { split: 'right', from: 0, ratio: r }, { split: 'down', from: 1, ratio: r }];
  assert.equal(plan(l(0.3)).notes.length, 1);
  assert.match(plan(l(0.3)).notes[0], /ratio/);
  assert.deepEqual(plan(l(0.5)).notes, []);
  assert.deepEqual(plan([{}, { split: 'right', from: 0 }]).notes, []);
});

test('Univer.CRM config: entry 2 splits the api/web tab (entry 1) downwards', async () => {
  const file = '/cfg/config.json';
  const text = JSON.stringify({
    projects: {
      'Univer.CRM': {
        layout: [
          { label: 'claude', command: 'claude' },
          { label: 'api/web', cwd: 'CRM.API' },
          { split: 'down', ratio: 0.5, cwd: 'CRM.Backoffice.Web' },
          { label: 'lazygit', command: 'lazygit' },
          { label: 'neovim', command: 'nvim' },
        ],
      },
    },
  });
  const config = await loadConfig({ configFile: file, fs: { readFile: async () => text } });
  const { operations } = plan(config.projects['Univer.CRM'].layout);
  assert.deepEqual(operations, [
    { op: 'rename', entry: 0, title: 'claude' },
    { op: 'send', entry: 0, text: 'claude' },
    { op: 'tab', entry: 1, title: 'api/web' },
    { op: 'send', entry: 1, text: 'cd "/wt/CRM.API"', cwd: '/wt/CRM.API' },
    { op: 'split', entry: 2, from: 1, direction: 'vertical' },
    { op: 'send', entry: 2, text: 'cd "/wt/CRM.Backoffice.Web"', cwd: '/wt/CRM.Backoffice.Web' },
    { op: 'tab', entry: 3, title: 'lazygit' },
    { op: 'send', entry: 3, text: 'lazygit' },
    { op: 'tab', entry: 4, title: 'neovim' },
    { op: 'send', entry: 4, text: 'nvim' },
  ]);
});

test('a browser entry plans a browser op (with or without url) and no cwd/send ops', () => {
  const { operations } = plan([{}, { browser: true }, { browser: 'https://localhost:5001' }, { label: 'git', command: 'lazygit' }]);
  assert.deepEqual(operations, [
    { op: 'browser', entry: 1 },
    { op: 'browser', entry: 2, url: 'https://localhost:5001' },
    { op: 'tab', entry: 3, title: 'git' },
    { op: 'send', entry: 3, text: 'lazygit' },
  ]);
});

test('browser ops apply in both modes', () => {
  const layout = [{ agent: 'claude' }, { browser: true }];
  for (const mode of ['created', 'manual']) {
    const { operations } = planLayout({ layout, worktreePath: '/wt', mode, pathApi: path.posix });
    assert.deepEqual(operations.at(-1), { op: 'browser', entry: 1 });
  }
});
