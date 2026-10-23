import { applyLayout } from './apply.mjs';
import { loadConfig } from './config.mjs';

export const AUTO_MIN_AGE_MS = 60_000;

const skipped = (message) => ({ status: 'skipped', message });

/**
 * Shell-side trigger: applies the matching layout to the worktree of the calling terminal, in manual mode
 * (same rules as the Apply layout command: one-terminal guard, entry-0 `agent` launch).
 * Ports: env, now() -> ms, orcaCli, git, fs {readFile, isDirectory, createdAt(path) -> ms | null}, log.
 * `auto` (shell-start hook) additionally requires `autoApplyOnShellStart` in the config, an ORCA_WORKTREE_ID
 * from the environment, a worktree older than 60 s (the worktree.created handler owns new ones), and more
 * than a lone agent terminal (Orca already started the agent there).
 * Returns { status: 'applied' | 'guard' | 'noop' | 'skipped', message }; throws on any error.
 */
export async function runShellApply({ auto = false, env, now, configFile, fs, git, orcaCli, log, pathApi }) {
  if (auto) {
    const config = await loadConfig({ configFile, fs });
    if (!config?.autoApplyOnShellStart) return skipped('autoApplyOnShellStart is off');
  }
  let worktreeId = env.ORCA_WORKTREE_ID || undefined;
  if (!worktreeId && !auto) {
    worktreeId = await orcaCli(['worktree', 'current']).then(
      (r) => r?.worktree?.id,
      () => undefined,
    );
  }
  if (!worktreeId) {
    if (auto) return skipped('not inside an Orca worktree');
    throw new Error('not inside an Orca worktree');
  }
  const worktreePath = (await orcaCli(['worktree', 'show', '--worktree', `id:${worktreeId}`]))?.worktree?.path;
  if (!worktreePath) throw new Error(`Could not resolve the path of worktree ${worktreeId}`);
  if (auto) {
    const createdAt = await fs.createdAt(worktreePath);
    if (typeof createdAt === 'number' && now() - createdAt < AUTO_MIN_AGE_MS) {
      return skipped('worktree is less than 60 s old');
    }
  }
  const { terminals = [] } = await orcaCli(['terminal', 'list', '--worktree', `id:${worktreeId}`]);
  if (auto && terminals.length === 1 && terminals[0].agentIdentity) return skipped('only terminal is an agent terminal');
  const result = await applyLayout({
    trigger: 'manual',
    worktreeId,
    worktreePath,
    terminalCount: terminals.length,
    getFirstTerminal: async () => (terminals.length > 0 ? { handle: terminals[0].handle } : null),
    configFile,
    fs,
    git,
    orcaCli,
    log,
    pathApi,
  });
  if (result.notice) return { status: 'guard', message: result.notice };
  if (result.applied) return { status: 'applied', message: 'Layout applied' };
  return { status: 'noop', message: 'No layout to apply (no config, or no layout for this project)' };
}
