import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import activate from '../main.mjs';
import { renderBlock } from '../src/shell-profile.mjs';

const SCRIPT = '/plugin/bin/apply-layout.mjs';

function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (p) => (files.has(p) ? files.get(p) : null),
    mkdir: async () => {},
    writeFile: async (p, text) => void files.set(p, text),
    copyFileExclusive: async (from, to) => {
      if (!files.has(to)) files.set(to, files.get(from));
    },
  };
}

function setup({ files = {}, platform = 'linux', context = null } = {}) {
  const handlers = {};
  const logs = [];
  const hostCalls = [];
  const fs = memFs(files);
  const orca = {
    log: (m) => logs.push(m),
    events: { on() {} },
    commands: { register: (id, fn) => (handlers[id] = fn) },
    host: {
      call: async (name, payload) => {
        hostCalls.push([name, payload]);
        return name === 'workspace.readContext' ? context : undefined;
      },
    },
  };
  const opened = [];
  const deps = {
    fs,
    platform,
    home: '/h',
    pathApi: path.posix,
    scriptPath: SCRIPT,
    configFile: '/cfg/config.json',
    psProfile: async () => null,
    openExternal: async (u) => opened.push(u),
    orcaCli: async () => ({}),
    createServer: () => ({ start: async () => ({ url: 'http://127.0.0.1:1/?token=t' }), stop: async () => {} }),
  };
  return { orca, deps, handlers, logs, hostCalls, fs, opened };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('registers exactly the commands declared in orca-plugin.json', async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'));
  const s = setup();
  activate(s.orca, s.deps);
  assert.deepEqual(Object.keys(s.handlers).sort(), manifest.contributes.commands.map((c) => c.id).sort());
  for (const id of ['edit-config', 'install-shell', 'uninstall-shell']) {
    assert.equal(manifest.contributes.commands.find((c) => c.id === id).context, 'global');
  }
});

test('edit-config opens the url (OS browser without a worktree) and notifies it', async () => {
  const s = setup();
  activate(s.orca, s.deps);
  await s.handlers['edit-config']();
  assert.deepEqual(s.opened, ['http://127.0.0.1:1/?token=t']);
  const note = s.hostCalls.find(([n]) => n === 'notifications.show');
  assert.ok(note[1].body.includes('http://127.0.0.1:1/?token=t'));
});

test('install-shell installs into the existing rc files and notifies the result', async () => {
  const s = setup({ files: { '/h/.bashrc': 'export A=1\n', '/h/.zshrc': '' } });
  activate(s.orca, s.deps);
  await s.handlers['install-shell']();
  assert.ok(s.fs.files.get('/h/.bashrc').includes(SCRIPT));
  assert.ok(s.fs.files.get('/h/.zshrc').includes(SCRIPT));
  const note = s.hostCalls.filter(([n]) => n === 'notifications.show').at(-1);
  assert.match(note[1].body, /\.bashrc/);
  assert.match(note[1].body, /\.zshrc/);
});

test('uninstall-shell removes the block', async () => {
  const block = renderBlock({ shell: 'bash', script: SCRIPT });
  const s = setup({ files: { '/h/.bashrc': `x\n${block}` } });
  activate(s.orca, s.deps);
  await s.handlers['uninstall-shell']();
  assert.equal(s.fs.files.get('/h/.bashrc'), 'x\n');
});

test('on activate a stale block is rewritten to the current script; no block is ever added', async () => {
  const stale = renderBlock({ shell: 'bash', script: '/old/apply-layout.mjs' });
  const s = setup({ files: { '/h/.bashrc': stale, '/h/.zshrc': 'plain\n' } });
  activate(s.orca, s.deps);
  await settle();
  assert.ok(s.fs.files.get('/h/.bashrc').includes(SCRIPT));
  assert.equal(s.fs.files.get('/h/.zshrc'), 'plain\n');
  assert.match(s.logs.join('\n'), /updated shell integration/);
});

test('activate-time refresh errors are only logged', async () => {
  const s = setup();
  s.deps.fs.readFile = async () => {
    throw new Error('boom');
  };
  activate(s.orca, s.deps);
  await settle();
  assert.match(s.logs.join('\n'), /boom/);
});
