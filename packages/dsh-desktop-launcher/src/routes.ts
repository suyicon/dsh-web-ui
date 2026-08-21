/**
 * The /api/dsh-desktop-launcher route family: one POST that writes the
 * launcher script under $DSH_HOME/desktop-launcher/ and places the double-click
 * icon on the Desktop. Every route carries the same loopback-only trust
 * fence as the dsh-ssh routes — this endpoint writes files on the host
 * machine, so LAN-exposed dsh web deployments must not serve it.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { desktopFileName, launcherJsFileName, renderDesktopEntry, renderLauncherScript, renderNodeLauncher, renderShortcutInstaller, renderWindowsShortcutArgs, scriptFileName, type LauncherPlatform, type LauncherSpec } from './core/launcher.ts'
import { LAUNCHER_API, type CreateResult } from './protocol.ts'
import { isLoopbackRequest } from './loopback.ts'

const execFileAsync = promisify(execFile)

/** Result of one spawned command (tests inject a fake runner). */
export interface CommandResult {
  /** Process exit code. */
  code: number | null
  /** Captured stdout (when the runner captures it, e.g. `where` output). */
  stdout?: string
  /** Captured stderr. */
  stderr: string
}

/** Runner signature: execute a command with arguments and report its exit. */
export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>

/** Route dependencies: the live spec resolver plus test seams. */
export interface LauncherRoutesDeps {
  /** Resolve the live launcher spec (composition + settings). */
  resolveSpec: () => LauncherSpec
  /** Home directory (defaults to os.homedir()): the OS desktop the icon lands on. */
  homeDir?: string
  /** DSH home directory for launcher assets (defaults to $DSH_HOME, then ~/.dsh). */
  dshHomeDir?: string
  /** Host platform (defaults to process.platform). */
  platform?: string
  /** Command runner (defaults to child_process.execFile). */
  run?: CommandRunner
  /** Test seam: explicit icon source file (overrides discovery). */
  iconSource?: string
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/**
 * The dsh icon bundled with the package (assets/dsh.ico next to lib/index.js).
 * Vitest transforms src modules to non-file URLs, so a missing or unparsable
 * bundle URL is tolerated (tests inject iconSource instead).
 */
let bundledIconPath: string | undefined
let bundledPngPath: string | undefined
if (import.meta.url.startsWith('file:')) {
  try { bundledIconPath = fileURLToPath(new URL('../assets/dsh.ico', import.meta.url)) } catch { /* keep undefined */ }
  try { bundledPngPath = fileURLToPath(new URL('../assets/dsh.png', import.meta.url)) } catch { /* keep undefined */ }
}

/**
 * Resolve the icon source: the injected override, then the configured
 * iconPath when it exists, then the bundled dsh icon. Undefined when none is
 * available.
 * @param configured - the spec's optional iconPath.
 * @param override - test seam: an explicit icon file.
 * @returns the source icon file, or undefined.
 */
function resolveIconSource(configured: string | undefined, override: string | undefined): string | undefined {
  if (override !== undefined && existsSync(override)) return override
  if (configured !== undefined && configured !== '' && existsSync(configured)) return configured
  return bundledIconPath !== undefined && existsSync(bundledIconPath) ? bundledIconPath : undefined
}

/** Default runner: execFile with a 30s cap, reporting exit code, stdout and stderr. */
const defaultRunner: CommandRunner = async (file, args) => {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 30_000, windowsHide: true })
    return { code: 0, stdout: String(stdout), stderr: '' }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : null
    return {
      code: typeof code === 'number' ? code : null,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Narrow a raw platform string to the supported set. */
function toLauncherPlatform(platform: string): LauncherPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform
  throw new Error(`unsupported platform: ${platform}`)
}

/**
 * Desktop directory: the standard Desktop, with the OneDrive redirect
 * fallback on Windows when the plain path does not exist.
 */
function resolveDesktopDir(home: string, platform: LauncherPlatform): string {
  const desktop = join(home, 'Desktop')
  if (platform === 'win32' && !existsSync(desktop)) {
    const onedrive = join(home, 'OneDrive', 'Desktop')
    if (existsSync(onedrive)) return onedrive
  }
  return desktop
}

/**
 * Resolve the dsh command to an absolute path (never throws). Absolute or
 * path-like commands are checked by existence; bare names are resolved through
 * the platform's PATH lookup, returning the first match.
 * @returns the resolved command path, or undefined when not found.
 */
async function resolveDshCommand(platform: LauncherPlatform, run: CommandRunner, dshCommand: string): Promise<string | undefined> {
  if (isAbsolute(dshCommand) || dshCommand.includes('/') || dshCommand.includes('\\')) {
    return existsSync(dshCommand) ? dshCommand : undefined
  }
  try {
    if (platform === 'win32') {
      const result = await run('where', [dshCommand])
      if (result.code !== 0) return undefined
      const match = (result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
      return match ?? undefined
    }
    const result = await run('sh', ['-lc', `command -v ${dshCommand}`])
    if (result.code !== 0) return undefined
    const match = (result.stdout ?? '').trim()
    return match === '' ? undefined : match
  } catch {
    return undefined
  }
}

/**
 * Write the launcher script and place the desktop icon for the current
 * platform. Refreshing is idempotent: rerunning overwrites both files.
 * @param deps - spec resolver plus test seams.
 * @returns the icon path and any non-fatal warning.
 */
export async function createDesktopShortcut(deps: LauncherRoutesDeps): Promise<CreateResult> {
  const spec = deps.resolveSpec()
  const platform = toLauncherPlatform(deps.platform ?? process.platform)
  const home = deps.homeDir ?? homedir()
  const run = deps.run ?? defaultRunner
  const scriptsDir = join(deps.dshHomeDir ?? dshHome(), 'desktop-launcher')
  await mkdir(scriptsDir, { recursive: true })
  // Copy the icons next to the launcher so the shortcut keeps working even if
  // the source package moves: windows uses dsh.ico as the .lnk icon, POSIX
  // launchers use dsh.png when available.
  let iconIco: string | undefined
  let iconPng: string | undefined
  const iconSource = resolveIconSource(spec.iconPath, deps.iconSource)
  if (iconSource !== undefined) {
    iconIco = join(scriptsDir, 'dsh.ico')
    await copyFile(iconSource, iconIco)
    if (/\.png$/i.test(iconSource)) {
      iconPng = join(scriptsDir, 'dsh.png')
      await copyFile(iconSource, iconPng)
    } else if (bundledPngPath !== undefined && existsSync(bundledPngPath)) {
      iconPng = join(scriptsDir, 'dsh.png')
      await copyFile(bundledPngPath, iconPng)
    }
  }
  const desktopDir = resolveDesktopDir(home, platform)
  await mkdir(desktopDir, { recursive: true })
  const iconPath = join(desktopDir, desktopFileName(platform))
  const dshCommandPath = await resolveDshCommand(platform, run, spec.dshCommand)
  let warning: string | undefined
  if (dshCommandPath === undefined) warning = `dsh command "${spec.dshCommand}" was not found on PATH; the launcher shows a message when run`
  if (platform === 'win32') {
    // The .lnk targets the node binary running this host, which runs a static
    // Node detach launcher (launcher-win.js) that spawns the resolved dsh
    // command headless (CREATE_NO_WINDOW, detached) and exits. The app opens
    // with no lingering console, and the launch chain contains no PowerShell,
    // no launcher.ps1, no .bat wrapper, no -ExecutionPolicy Bypass, no
    // Add-Type — the Windows Defender HEUR:Trojan/LNK.Agent.b trigger is gone.
    const launcherPath = join(scriptsDir, launcherJsFileName())
    await writeFile(launcherPath, renderNodeLauncher())
    // Plain argv tokens (whitespace-only quoting); no user-controlled text is
    // interpolated into any script or shell.
    const commandArgs = renderWindowsShortcutArgs({
      launcherPath,
      dshCommand: dshCommandPath ?? spec.dshCommand,
      profile: spec.profile,
    })
    const installCommand = renderShortcutInstaller({
      commandPath: process.execPath,
      commandArgs,
      desktopPath: iconPath,
      homeDir: home,
      iconLocation: iconIco ?? `${process.execPath},0`,
    })
    // Creation-time only: a plain COM shortcut create via powershell -Command.
    // No -ExecutionPolicy Bypass, no -File, no script left on disk.
    const result = await run('powershell', ['-NoProfile', '-Command', installCommand])
    if (result.code !== 0) throw new Error(`shortcut creation failed: ${result.stderr}`)
  } else {
    const launcherPath = join(scriptsDir, scriptFileName(platform))
    await writeFile(launcherPath, renderLauncherScript(platform, spec), { mode: 0o755 })
    if (platform === 'darwin') {
      // On macOS the desktop file IS the launcher script.
      await writeFile(iconPath, renderLauncherScript(platform, spec), { mode: 0o755 })
    } else {
      await writeFile(iconPath, renderDesktopEntry(launcherPath, iconPng ?? iconIco), { mode: 0o755 })
      await chmod(launcherPath, 0o755)
      // Best-effort trust marker: GNOME refuses untrusted desktop entries.
      const trust = await run('gio', ['set', iconPath, 'metadata::trusted', 'true'])
      if (trust.code !== 0) warning = `desktop entry created but not marked trusted: ${trust.stderr}`
    }
  }
  return { ok: true, path: iconPath, platform, ...(warning === undefined ? {} : { warning }) }
}

/**
 * Build the /api/dsh-desktop-launcher route family.
 * @param deps - spec resolver plus test seams.
 * @returns the routes.
 */
export function makeRoutes(deps: LauncherRoutesDeps): { routes: WebRoute[] } {
  const routes: WebRoute[] = [{
    kind: 'exact',
    path: LAUNCHER_API.create,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if ((req.method ?? 'GET') !== 'POST') {
        writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        return
      }
      try {
        writeJson(res, 200, { result: await createDesktopShortcut(deps) })
      } catch (error) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }]
  return { routes }
}