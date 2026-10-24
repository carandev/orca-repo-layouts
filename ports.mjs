import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { browserCommand } from './src/open-url.mjs';

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
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  writeFile: (file, text) => writeFile(file, text),
  rename: (from, to) => rename(from, to),
  remove: (file) => rm(file, { force: true }),
  copyFileExclusive: (from, to) => copyFile(from, to, constants.COPYFILE_EXCL),
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

/** Profile path of a PowerShell flavour (`powershell` 5.1 or `pwsh` 7), or null when that executable is unavailable. */
export const psProfile = (exe) =>
  new Promise((resolve) => {
    execFile(
      exe,
      ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'],
      { windowsHide: true, timeout: 15_000, encoding: 'utf8' },
      (error, stdout) => resolve(error || !stdout.trim() ? null : stdout.trim())
    );
  });

/** Opens a url in the OS default browser. */
export const openExternal = (url) =>
  new Promise((resolve, reject) => {
    const [file, args] = browserCommand(url);
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (error) => (error ? reject(error) : resolve()));
  });
