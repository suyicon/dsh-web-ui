/**
 * Pure launcher generation: the PowerShell / POSIX launcher bodies, the
 * Windows shortcut installer, and the desktop file names for the three
 * supported platforms. No filesystem or process access — everything here is
 * testable without touching disk.
 */

/** Desktop platforms the launcher can generate an icon for. */
export type LauncherPlatform = 'win32' | 'darwin' | 'linux'

/** Launcher behavior, resolved from plugin config. */
export interface LauncherSpec {
  /** Command that starts dsh (must be on PATH when the launcher runs). */
  dshCommand: string
  /** Base URL of the dsh web GUI. */
  url: string
  /** Optional profile passed as `dsh web --profile <profile>`. */
  profile?: string
  /** Optional icon file (.ico/.png) for the desktop icon; empty uses the bundled dsh icon. */
  iconPath?: string
}

/** Default dsh command. */
export const DEFAULT_DSH_COMMAND = 'dsh'

/** Default GUI URL. */
export const DEFAULT_URL = 'http://127.0.0.1:3080'

/**
 * Fill defaults from a partial config (schema defaults may be absent in
 * hand-built test contexts). An empty profile means "no --profile flag".
 * @param config - partial launcher config.
 * @returns the resolved spec.
 */
export function resolveLauncherSpec(config: {
  dshCommand?: string
  url?: string
  profile?: string
  iconPath?: string
}): LauncherSpec {
  return {
    dshCommand: config.dshCommand ?? DEFAULT_DSH_COMMAND,
    url: config.url ?? DEFAULT_URL,
    ...(config.profile === undefined || config.profile === '' ? {} : { profile: config.profile }),
    ...(config.iconPath === undefined || config.iconPath === '' ? {} : { iconPath: config.iconPath }),
  }
}

/** File name of the POSIX launcher script under $DSH_HOME/desktop-launcher/. */
export function scriptFileName(platform: 'darwin' | 'linux'): string {
  return platform === 'darwin' ? 'launcher.command' : 'launcher.sh'
}

/** File name of the icon placed on the Desktop. */
export function desktopFileName(platform: LauncherPlatform): string {
  switch (platform) {
    case 'win32': return 'DeepSeek-Harness.lnk'
    case 'darwin': return 'DeepSeek-Harness.command'
    case 'linux': return 'deepseek-harness.desktop'
  }
}

/** Single-quote a value for PowerShell (embedded quotes are doubled). */
function psSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Single-quote a value for POSIX sh (embedded quotes are escaped). */
function shSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Render the Windows shortcut-installer command for the dsh host: a single
 * PowerShell `-Command` string that creates the Desktop .lnk pointing
 * DIRECTLY at the resolved dsh command (no powershell.exe, no launcher.ps1,
 * no .bat wrapper). The launch chain never touches PowerShell, so neither
 * `-ExecutionPolicy Bypass` nor a runtime `Add-Type` is needed — the exact
 * Windows Defender HEUR:Trojan/LNK.Agent.b trigger is gone and nothing
 * suspicious is exposed in the .lnk target or arguments.
 * @param opts - the resolved dsh command, its args, and shortcut metadata.
 * @returns a PowerShell `-Command` string (run by the host at creation time).
 */
export function renderShortcutInstaller(opts: {
  /** Absolute path of the resolved dsh command (the .lnk target). */
  commandPath: string
  /** Arguments for the .lnk, e.g. `web` or `web --profile <profile>`. */
  commandArgs: string
  /** Absolute path of the DSH.lnk to create. */
  desktopPath: string
  /** Working directory of the shortcut (the home dir). */
  homeDir: string
  /** Icon the shortcut shows (an .ico/.png path, or a shell-exe icon spec). */
  iconLocation: string
}): string {
  const { commandPath, commandArgs, desktopPath, homeDir, iconLocation } = opts
  // Every user-controlled value is single-quoted with PowerShell escaping
  // (embedded quotes doubled), so % ! & ^ ( ) and spaces stay literal.
  return [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut(${psSingle(desktopPath)})`,
    `$s.TargetPath = ${psSingle(commandPath)}`,
    `$s.Arguments = ${psSingle(commandArgs)}`,
    `$s.WorkingDirectory = ${psSingle(homeDir)}`,
    `$s.IconLocation = ${psSingle(iconLocation)}`,
    `$s.Description = ${psSingle('Launch DeepSeek Harness Web GUI')}`,
    // SW_SHOWMINIMIZED: keep the dsh console out of the way.
    '$s.WindowStyle = 7',
    '$s.Save()',
  ].join('; ')
}

/** POSIX launcher (macOS .command / Linux .sh) with the platform open command. */
function renderPosix(platform: 'darwin' | 'linux', spec: LauncherSpec): string {
  const open = platform === 'darwin' ? 'open' : 'xdg-open'
  const alert = platform === 'darwin'
    ? "osascript -e 'display dialog \"dsh command not found: '\"$DASH\"'\" with title \"DSH Launcher\" with icon caution' 2>/dev/null || echo \"dsh command not found: $DASH\" >&2"
    : 'zenity --error --title="DSH Launcher" --text="dsh command not found: $DASH" 2>/dev/null || echo "dsh command not found: $DASH" >&2'
  return [
    '#!/bin/bash',
    '# DSH web launcher (generated by dsh-desktop-launcher)',
    `DASH=${shSingle(spec.dshCommand)}`,
    `URL=${shSingle(spec.url)}`,
    `PROFILE=${shSingle(spec.profile ?? '')}`,
    '',
    'probe() {',
    '  curl -fsS --max-time 2 "$URL" >/dev/null 2>&1',
    '}',
    '',
    'if probe; then',
    `  ${open} "$URL"`,
    '  exit 0',
    'fi',
    '',
    'if ! command -v "$DASH" >/dev/null 2>&1; then',
    `  ${alert}`,
    '  exit 1',
    'fi',
    '',
    'if [ -n "$PROFILE" ]; then',
    '  "$DASH" web --profile "$PROFILE" >/dev/null 2>&1 &',
    'else',
    '  "$DASH" web >/dev/null 2>&1 &',
    'fi',
    '',
    'for i in $(seq 1 30); do',
    '  if probe; then',
    `    ${open} "$URL"`,
    '    exit 0',
    '  fi',
    '  sleep 1',
    'done',
    '',
    'echo "dsh web did not start within 30 seconds: $URL" >&2',
    'exit 1',
    '',
  ].join('\n')
}

/**
 * Render the POSIX launcher script (macOS .command / Linux .sh). Windows uses
 * a .lnk pointing directly at the dsh command instead (renderShortcutInstaller).
 * @param platform - target POSIX desktop platform.
 * @param spec - resolved launcher behavior.
 * @returns the script body.
 */
export function renderLauncherScript(platform: 'darwin' | 'linux', spec: LauncherSpec): string {
  return renderPosix(platform, spec)
}

/**
 * Render the Linux desktop entry (the macOS launcher doubles as the desktop
 * file; Windows uses a .lnk pointing directly at the dsh command).
 * @param launcherPath - absolute path of the launcher script.
 * @returns the .desktop file body.
 */
export function renderDesktopEntry(launcherPath: string, iconPath?: string): string {
  const iconLine = iconPath === undefined ? 'Icon=utilities-terminal' : `Icon=${iconPath}`
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=DeepSeek Harness',
    'Comment=Launch DeepSeek Harness Web GUI',
    `Exec="${launcherPath}"`,
    iconLine,
    'Terminal=true',
    'Categories=Development;',
    '',
  ].join('\n')
}
