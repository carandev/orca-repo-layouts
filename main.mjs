import { applyForActiveWorktree, applyForWorktree } from './src/apply.mjs';
import { configFilePath } from './src/config.mjs';
import { orcaCli, waitForFirstTerminal } from './orca-cli.mjs';
import { fs, git } from './ports.mjs';

export default function activate(orca) {
  const log = (message) => orca.log(`repo-layouts: ${message}`);
  const notify = (title, body) => orca.host.call('notifications.show', { title, body: body.slice(0, 1000) });

  orca.events.on('worktree.created', async ({ worktreeId, path }) => {
    try {
      await applyForWorktree({
        worktreeId,
        worktreePath: path,
        configFile: configFilePath(),
        fs,
        git,
        orcaCli,
        waitForFirstTerminal,
        log,
      });
    } catch (error) {
      orca.log(`repo-layouts failed for ${path}: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });

  // The command carries no worktree args: the active worktree comes from workspace.readContext.
  orca.commands.register('apply-layout', async () => {
    try {
      const result = await applyForActiveWorktree({
        readContext: () => orca.host.call('workspace.readContext'),
        configFile: configFilePath(),
        fs,
        git,
        orcaCli,
        log,
      });
      if (result.notice) await notify('Repo Layouts', result.notice);
      else if (result.applied) await notify('Repo Layouts', 'Layout applied');
    } catch (error) {
      orca.log(`repo-layouts apply-layout failed: ${error.message}`);
      await notify('Repo Layouts failed', error.message);
    }
  });
}
