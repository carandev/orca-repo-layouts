import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

/** Node implementations of the fs/git ports shared by the plugin (main.mjs) and the shell CLI (bin/). */
export const fs = {
  readFile: async (file) => {
    try {
      return await readFile(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  },
  isDirectory: async (dir) => {
    try {
      return (await stat(dir)).isDirectory();
    } catch {
      return false;
    }
  },
  /**
   * Orca exposes no worktree creation time. A linked worktree's `.git` file is written when the worktree is
   * created, so its birth time stands in (for the main worktree it is the old `.git` directory). null: unknown.
   */
  createdAt: async (worktreePath) => {
    try {
      const { birthtimeMs } = await stat(`${worktreePath}/.git`);
      return birthtimeMs > 0 ? birthtimeMs : null;
    } catch {
      return null;
    }
  },
};

export const git = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 15_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    );
  });
