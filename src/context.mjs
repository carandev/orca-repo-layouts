/**
 * Finds the MAIN repository root (never a linked worktree's checkout) from the
 * parent of `git rev-parse --git-common-dir`. `git(args, cwd)` returns stdout.
 */
export async function resolveMainRepoRoot({ startDirs, git }) {
  for (const dir of startDirs) {
    try {
      const commonDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir)).trim();
      if (!commonDir) continue;
      const m = /^(.+)[\\/]\.git$/.exec(commonDir);
      if (m) return { repoRoot: m[1], commonDir };
      const top = (await git(['rev-parse', '--show-toplevel'], dir)).trim();
      if (top) return { repoRoot: top, commonDir };
    } catch {
      // try the next candidate directory
    }
  }
  throw new Error('Could not locate a git repository for this worktree');
}
