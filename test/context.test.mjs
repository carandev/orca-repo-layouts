import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMainRepoRoot } from '../src/context.mjs';

test('main repo root is the parent of the git common dir', async () => {
  const git = async () => 'C:/dev/Univer.CRM/.git\n';
  const r = await resolveMainRepoRoot({ startDirs: ['C:/dev/Univer.CRM/.claude/worktrees/x'], git });
  assert.deepEqual(r, { repoRoot: 'C:/dev/Univer.CRM', commonDir: 'C:/dev/Univer.CRM/.git' });
});

test('bare/odd common dir falls back to show-toplevel', async () => {
  const git = async (args) => (args.includes('--git-common-dir') ? '/x/repo.git\n' : '/x/top\n');
  assert.equal((await resolveMainRepoRoot({ startDirs: ['/x'], git })).repoRoot, '/x/top');
});

test('tries the next start dir when git fails', async () => {
  const git = async (args, cwd) => {
    if (cwd === '/bad') throw new Error('not a repo');
    return '/ok/.git';
  };
  assert.equal((await resolveMainRepoRoot({ startDirs: ['/bad', '/good'], git })).repoRoot, '/ok');
});

test('throws when no start dir is in a repository', async () => {
  const git = async () => {
    throw new Error('nope');
  };
  await assert.rejects(resolveMainRepoRoot({ startDirs: ['/a'], git }), /Could not locate a git repository/);
});
