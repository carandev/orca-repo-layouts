import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BEGIN, getBlock, renderBlock } from '../src/shell-profile.mjs';
import {
  installProfile,
  installTargets,
  listTargets,
  refreshTargets,
  uninstallTargets,
} from '../src/shell-install.mjs';

const SCRIPT = '/new/bin/apply-layout.mjs';

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

test('getBlock returns the delimited block or null', () => {
  const block = renderBlock({ shell: 'bash', script: '/a' });
  assert.equal(getBlock(`x\n${block}y\n`), block);
  assert.equal(getBlock('nothing\n'), null);
  assert.ok(getBlock(block).startsWith(BEGIN));
});

test('listTargets on Windows asks powershell and pwsh for their profile; pwsh is skipped when unavailable', async () => {
  const psProfile = async (exe) => (exe === 'powershell' ? 'C:\\Docs\\WindowsPowerShell\\p.ps1' : null);
  const t = await listTargets({ platform: 'win32', home: 'C:\\Users\\me', fs: memFs(), psProfile, pathApi: path.win32 });
  assert.deepEqual(t, [{ shell: 'powershell', profile: 'C:\\Docs\\WindowsPowerShell\\p.ps1' }]);
  const both = await listTargets({
    platform: 'win32',
    home: 'C:\\Users\\me',
    fs: memFs(),
    psProfile: async (exe) => `C:\\${exe}.ps1`,
    pathApi: path.win32,
  });
  assert.deepEqual(both.map((x) => x.shell), ['powershell', 'pwsh']);
});

test('listTargets on Linux/macOS picks the existing rc files', async () => {
  const fs = memFs({ '/h/.bashrc': 'x', '/h/.zshrc': 'y' });
  const t = await listTargets({ platform: 'linux', home: '/h', fs, pathApi: path.posix });
  assert.deepEqual(t, [
    { shell: 'bash', profile: '/h/.bashrc' },
    { shell: 'zsh', profile: '/h/.zshrc' },
  ]);
  const onlyZsh = await listTargets({ platform: 'darwin', home: '/h', fs: memFs({ '/h/.zshrc': '' }), pathApi: path.posix });
  assert.deepEqual(onlyZsh.map((x) => x.shell), ['zsh']);
});

test('listTargets creates ~/.zshrc on macOS and ~/.bashrc on Linux when no rc file exists', async () => {
  const mac = await listTargets({ platform: 'darwin', home: '/h', fs: memFs(), pathApi: path.posix });
  assert.deepEqual(mac, [{ shell: 'zsh', profile: '/h/.zshrc' }]);
  const linux = await listTargets({ platform: 'linux', home: '/h', fs: memFs(), pathApi: path.posix });
  assert.deepEqual(linux, [{ shell: 'bash', profile: '/h/.bashrc' }]);
});

test('installProfile backs up an existing profile once and upserts the block', async () => {
  const fs = memFs({ '/h/.bashrc': 'export A=1\n' });
  const r = await installProfile({ fs, profile: '/h/.bashrc', shell: 'bash', script: SCRIPT });
  assert.equal(r.backup, '/h/.bashrc.bak-orca-repo-layouts');
  assert.equal(fs.files.get('/h/.bashrc.bak-orca-repo-layouts'), 'export A=1\n');
  assert.ok(fs.files.get('/h/.bashrc').startsWith('export A=1\n'));
  assert.ok(fs.files.get('/h/.bashrc').includes(SCRIPT));
  await installProfile({ fs, profile: '/h/.bashrc', shell: 'bash', script: '/other.mjs' });
  assert.equal(fs.files.get('/h/.bashrc.bak-orca-repo-layouts'), 'export A=1\n');
  assert.equal(fs.files.get('/h/.bashrc').split(BEGIN).length, 2);
});

test('installProfile writes a BOM for a new profile and no backup', async () => {
  const fs = memFs();
  const r = await installProfile({ fs, profile: '/p.ps1', shell: 'powershell', script: SCRIPT });
  assert.equal(r.backup, undefined);
  assert.ok(fs.files.get('/p.ps1').startsWith('\uFEFF'));
});

test('installTargets installs every target and reports per-target errors without throwing', async () => {
  const fs = memFs({ '/a': '' });
  const bad = {
    ...fs,
    writeFile: async (p, text) => {
      if (p === '/b') throw new Error('denied');
      fs.files.set(p, text);
    },
  };
  const results = await installTargets({
    targets: [{ shell: 'bash', profile: '/a' }, { shell: 'zsh', profile: '/b' }],
    script: SCRIPT,
    fs: bad,
  });
  assert.equal(results[0].profile, '/a');
  assert.equal(results[0].error, undefined);
  assert.equal(results[1].profile, '/b');
  assert.match(results[1].error, /denied/);
});

test('uninstallTargets removes only existing blocks', async () => {
  const block = renderBlock({ shell: 'bash', script: SCRIPT });
  const fs = memFs({ '/a': `before\n${block}`, '/b': 'untouched\n' });
  const results = await uninstallTargets({
    targets: [{ shell: 'bash', profile: '/a' }, { shell: 'zsh', profile: '/b' }, { shell: 'zsh', profile: '/missing' }],
    fs,
  });
  assert.deepEqual(results.map((r) => [r.profile, r.removed]), [['/a', true], ['/b', false], ['/missing', false]]);
  assert.equal(fs.files.get('/a'), 'before\n');
  assert.equal(fs.files.get('/b'), 'untouched\n');
});

test('refreshTargets rewrites a block pointing elsewhere, leaves current ones, and never adds a block', async () => {
  const stale = renderBlock({ shell: 'bash', script: '/old/apply-layout.mjs' });
  const current = renderBlock({ shell: 'zsh', script: SCRIPT });
  const fs = memFs({ '/a': `x\n${stale}`, '/b': current, '/c': 'no block\n' });
  const updated = await refreshTargets({
    targets: [{ shell: 'bash', profile: '/a' }, { shell: 'zsh', profile: '/b' }, { shell: 'zsh', profile: '/c' }, { shell: 'zsh', profile: '/none' }],
    script: SCRIPT,
    fs,
  });
  assert.deepEqual(updated, ['/a']);
  assert.ok(fs.files.get('/a').includes(SCRIPT));
  assert.ok(!fs.files.get('/a').includes('/old/'));
  assert.equal(fs.files.get('/b'), current);
  assert.equal(fs.files.get('/c'), 'no block\n');
  assert.equal(fs.files.has('/none'), false);
});
