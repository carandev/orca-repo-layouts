import test from 'node:test';
import assert from 'node:assert/strict';
import { openConfigEditor } from '../src/editor-command.mjs';
import { browserCommand } from '../src/open-url.mjs';

const URL_ = 'http://127.0.0.1:5555/?token=t';

function setup({ context = { branch: 'b', displayName: 'wt', terminals: [{ id: 't0' }] }, cliFails = false, openFails = false } = {}) {
  const calls = [];
  const opened = [];
  const notes = [];
  const logs = [];
  return {
    calls,
    opened,
    notes,
    logs,
    deps: {
      server: { start: async () => ({ url: URL_ }) },
      readContext: async () => context,
      orcaCli: async (args) => {
        calls.push(args);
        if (cliFails) throw new Error('cli down');
        if (args[0] === 'terminal') return { terminal: { worktreeId: 'r::/w/wt', worktreePath: '/w/wt' } };
        return {};
      },
      openExternal: async (url) => {
        opened.push(url);
        if (openFails) throw new Error('no browser');
      },
      notify: async (title, body) => notes.push([title, body]),
      log: (m) => logs.push(m),
    },
  };
}

test('opens the editor in an Orca browser tab of the active worktree and notifies the url', async () => {
  const s = setup();
  const r = await openConfigEditor(s.deps);
  assert.equal(r.opened, 'orca');
  assert.deepEqual(s.calls.at(-1), ['tab', 'create', '--worktree', 'id:r::/w/wt', '--url', URL_]);
  assert.equal(s.opened.length, 0);
  assert.equal(s.notes.length, 1);
  assert.ok(s.notes[0][1].includes(URL_));
});

test('falls back to the OS browser when there is no active worktree', async () => {
  const s = setup({ context: null });
  const r = await openConfigEditor(s.deps);
  assert.equal(r.opened, 'browser');
  assert.deepEqual(s.opened, [URL_]);
  assert.equal(s.calls.length, 0);
  assert.ok(s.notes[0][1].includes(URL_));
});

test('falls back to the OS browser when the Orca CLI fails', async () => {
  const s = setup({ cliFails: true });
  const r = await openConfigEditor(s.deps);
  assert.equal(r.opened, 'browser');
  assert.deepEqual(s.opened, [URL_]);
  assert.match(s.logs.join('\n'), /cli down/);
});

test('still notifies the url when nothing could be opened', async () => {
  const s = setup({ context: null, openFails: true });
  const r = await openConfigEditor(s.deps);
  assert.equal(r.opened, 'none');
  assert.ok(s.notes[0][1].includes(URL_));
});

test('browserCommand per platform', () => {
  assert.deepEqual(browserCommand('http://x', 'win32'), ['cmd', ['/c', 'start', '', 'http://x']]);
  assert.deepEqual(browserCommand('http://x', 'darwin'), ['open', ['http://x']]);
  assert.deepEqual(browserCommand('http://x', 'linux'), ['xdg-open', ['http://x']]);
});
