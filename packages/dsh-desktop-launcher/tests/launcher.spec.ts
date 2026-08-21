import { describe, expect, it } from 'vitest'
import {
  desktopFileName,
  renderDesktopEntry,
  renderLauncherScript,
  renderShortcutInstaller,
  resolveLauncherSpec,
  scriptFileName,
} from '../src/core/launcher.ts'

describe('launcher spec resolution', () => {
  it('fills defaults and drops an empty profile', () => {
    expect(resolveLauncherSpec({})).toEqual({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(resolveLauncherSpec({ profile: '' })).toEqual({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(resolveLauncherSpec({ dshCommand: 'dsh-dev', url: 'http://localhost:4000', profile: 'web' }))
      .toEqual({ dshCommand: 'dsh-dev', url: 'http://localhost:4000', profile: 'web' })
  })
})

describe('file names', () => {
  it('names launcher scripts and desktop icons per platform', () => {
    expect(scriptFileName('darwin')).toBe('launcher.command')
    expect(scriptFileName('linux')).toBe('launcher.sh')
    expect(desktopFileName('win32')).toBe('DeepSeek-Harness.lnk')
    expect(desktopFileName('darwin')).toBe('DeepSeek-Harness.command')
    expect(desktopFileName('linux')).toBe('deepseek-harness.desktop')
  })
})

describe('launcher script rendering', () => {
  it('renders POSIX launchers with the platform open command', () => {
    const mac = renderLauncherScript('darwin', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(mac).toContain('open "$URL"')
    expect(mac).toContain('command -v "$DASH"')
    const linux = renderLauncherScript('linux', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(linux).toContain('xdg-open "$URL"')
  })

  it('escapes single quotes in embedded values', () => {
    const script = renderLauncherScript('linux', { dshCommand: "d'sh", url: 'http://127.0.0.1:3080' })
    expect(script).toContain("DASH='d'\\''sh'")
  })
})

describe('desktop file rendering', () => {
  it('renders a Linux desktop entry pointing at the launcher', () => {
    const entry = renderDesktopEntry('/home/u/.dsh/desktop-launcher/launcher.sh')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Type=Application')
    expect(entry).toContain('Exec="/home/u/.dsh/desktop-launcher/launcher.sh"')
    expect(entry).toContain('Icon=utilities-terminal')

    const withIcon = renderDesktopEntry('/home/u/.dsh/desktop-launcher/launcher.sh', '/home/u/.dsh/desktop-launcher/dsh.ico')
    expect(withIcon).toContain('Icon=/home/u/.dsh/desktop-launcher/dsh.ico')
    expect(withIcon).not.toContain('Icon=utilities-terminal')
  })
})

describe('Windows shortcut installer', () => {
  it('points the .lnk directly at the resolved dsh command', () => {
    const cmd = renderShortcutInstaller({
      commandPath: 'C:/Users/u/AppData/Roaming/npm/dsh.cmd',
      commandArgs: 'web',
      desktopPath: 'C:/Users/u/Desktop/DSH.lnk',
      homeDir: 'C:/Users/u',
      iconLocation: 'C:/Users/u/.dsh/desktop-launcher/dsh.ico',
    })
    expect(cmd).toContain("$s.TargetPath = 'C:/Users/u/AppData/Roaming/npm/dsh.cmd'")
    expect(cmd).toContain("$s.Arguments = 'web'")
    expect(cmd).toContain("$s.WorkingDirectory = 'C:/Users/u'")
    expect(cmd).toContain("$s.IconLocation = 'C:/Users/u/.dsh/desktop-launcher/dsh.ico'")
    // SW_SHOWMINIMIZED: the dsh console stays out of the way.
    expect(cmd).toContain('$s.WindowStyle = 7')
    expect(cmd).toContain('$s.Save()')
    // The launch chain contains no PowerShell: no ExecutionPolicy Bypass, no
    // runtime Add-Type, no window hiding, no powershell.exe target.
    expect(cmd).not.toContain('-ExecutionPolicy Bypass')
    expect(cmd).not.toContain('-WindowStyle Hidden')
    expect(cmd).not.toContain('Add-Type')
    expect(cmd).not.toContain('GetConsoleWindow')
    expect(cmd).not.toContain('powershell.exe')
    expect(cmd).not.toContain('launcher.ps1')
    expect(cmd).not.toContain('launcher.bat')
  })

  it('passes the profile as a --profile argument', () => {
    const cmd = renderShortcutInstaller({
      commandPath: 'C:/dsh.cmd',
      commandArgs: 'web --profile dev',
      desktopPath: 'C:/Desktop/DSH.lnk',
      homeDir: 'C:/',
      iconLocation: 'cmd.exe,0',
    })
    expect(cmd).toContain("$s.Arguments = 'web --profile dev'")
  })

  it('escapes single quotes in embedded values', () => {
    const cmd = renderShortcutInstaller({
      commandPath: "C:/d'sh.cmd",
      commandArgs: "web --profile it's",
      desktopPath: 'C:/Desktop/DSH.lnk',
      homeDir: 'C:/',
      iconLocation: 'cmd.exe,0',
    })
    expect(cmd).toContain("$s.TargetPath = 'C:/d''sh.cmd'")
    expect(cmd).toContain("$s.Arguments = 'web --profile it''s'")
  })
})
