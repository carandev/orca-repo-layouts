import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import nodePath from 'node:path'

// The plugin worker gets a scrubbed env (an allowlist without APPDATA,
// LOCALAPPDATA or ORCA_CLI_COMMAND), so the binary and the dirs the CLI needs
// are rebuilt here from USERPROFILE/HOME.
export function resolveOrcaCli({
  env = process.env,
  platform = process.platform,
  pathApi = nodePath,
  exists = existsSync
} = {}) {
  const home = env.USERPROFILE ?? env.HOME ?? ''
  if (platform === 'win32') {
    const appData = env.APPDATA ?? pathApi.join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA ?? pathApi.join(home, 'AppData', 'Local')
    return {
      bin: pathApi.join(localAppData, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'),
      env: { ...env, APPDATA: appData, LOCALAPPDATA: localAppData }
    }
  }
  if (platform === 'linux') {
    // Bare `orca` is the GNOME screen reader on Linux; Orca's CLI is `orca-ide`,
    // symlinked into ~/.local/bin, which a desktop-launched app may lack on PATH.
    const link = pathApi.join(home, '.local', 'bin', 'orca-ide')
    return { bin: exists(link) ? link : 'orca-ide', env: { ...env } }
  }
  return { bin: 'orca', env: { ...env } }
}

const cli = resolveOrcaCli()
export const orcaBin = cli.bin

export function orcaCli(args) {
  return new Promise((resolve, reject) => {
    execFile(
      orcaBin,
      [...args, '--json'],
      { env: cli.env, windowsHide: true, timeout: 30_000 },
      (error, stdout, stderr) => {
        let reply
        try {
          reply = JSON.parse(stdout)
        } catch {
          reject(new Error(`orca ${args.join(' ')} failed: ${stderr || error?.message || stdout}`))
          return
        }
        if (!reply.ok) {
          reject(new Error(`orca ${args.join(' ')} failed: ${JSON.stringify(reply.error ?? reply)}`))
          return
        }
        resolve(reply.result)
      }
    )
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// worktree.created can fire before Orca has opened the workspace's first terminal.
export async function waitForFirstTerminal(worktreeId, { attempts = 20, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { terminals } = await orcaCli(['terminal', 'list', '--worktree', `id:${worktreeId}`])
    if (terminals.length > 0) {
      return terminals[0]
    }
    await sleep(delayMs)
  }
  throw new Error(`no terminal appeared for ${worktreeId}`)
}
