import { describe, expect, it } from 'vitest'
import {
  batFileName,
  desktopFileName,
  renderBatWrapper,
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
    expect(scriptFileName('win32')).toBe('launcher.ps1')
    expect(scriptFileName('darwin')).toBe('launcher.command')
    expect(scriptFileName('linux')).toBe('launcher.sh')
    expect(desktopFileName('win32')).toBe('DeepSeek-Harness.lnk')
    expect(desktopFileName('darwin')).toBe('DeepSeek-Harness.command')
    expect(desktopFileName('linux')).toBe('deepseek-harness.desktop')
  })
})

describe('launcher script rendering', () => {
  it('renders a PowerShell launcher with the spec values and poll loop', () => {
    const script = renderLauncherScript('win32', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080', profile: 'web' })
    expect(script).toContain("$dshCommand = 'dsh'")
    expect(script).toContain("$url = 'http://127.0.0.1:3080'")
    expect(script).toContain("$profile = 'web'")
    expect(script).toContain("$arguments += @('--profile', $profile)")
    expect(script).toContain('Start-Process $url')
    expect(script).toContain('Start-Sleep -Milliseconds 250')
    expect(script).toContain('DeepSeek Harness')
    expect(script).toContain('正在启动')
    expect(script).toContain('XamlReader')
  })

  it('omits the profile flag when no profile is set', () => {
    const script = renderLauncherScript('win32', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(script).toContain("$profile = ''")
    expect(script).toContain("$arguments = @('web')")
    expect(script).toContain("if ($profile -ne '') {")
  })

  it('renders POSIX launchers with the platform open command', () => {
    const mac = renderLauncherScript('darwin', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(mac).toContain('open "$URL"')
    expect(mac).toContain('command -v "$DASH"')
    const linux = renderLauncherScript('linux', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(linux).toContain('xdg-open "$URL"')
  })

  it('escapes single quotes in embedded values', () => {
    const script = renderLauncherScript('win32', { dshCommand: "d'sh", url: 'http://127.0.0.1:3080' })
    expect(script).toContain("$dshCommand = 'd''sh'")
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

  it('renders a Windows shortcut installer targeting cmd.exe + launcher.bat', () => {
    const ps = renderShortcutInstaller({
      batPath: 'C:/Users/u/.dsh/desktop-launcher/launcher.bat',
      desktopPath: 'C:/Users/u/Desktop/DSH.lnk',
      homeDir: 'C:/Users/u',
      iconLocation: 'C:/Users/u/.dsh/desktop-launcher/dsh.ico',
    })
    // .lnk targets cmd.exe + launcher.bat, not powershell.exe with suspicious flags
    expect(ps).toContain("$shortcut.TargetPath = 'cmd.exe'")
    expect(ps).toContain('launcher.bat')
    expect(ps).not.toContain('-ExecutionPolicy Bypass')
    expect(ps).not.toContain('-WindowStyle Hidden')
    expect(ps).toContain("$shortcut.IconLocation = 'C:/Users/u/.dsh/desktop-launcher/dsh.ico'")
    expect(ps).toContain("$shortcut.Save()")
  })

  it('falls back to cmd.exe icon when no icon is given', () => {
    const ps = renderShortcutInstaller({
      batPath: 'C:/launcher.bat',
      desktopPath: 'C:/Desktop/DSH.lnk',
      homeDir: 'C:/',
      iconLocation: 'cmd.exe,0',
    })
    expect(ps).toContain("$shortcut.IconLocation = 'cmd.exe,0'")
  })

  it('returns the BAT wrapper file name', () => {
    expect(batFileName()).toBe('launcher.bat')
  })

  it('renders a BAT wrapper that calls powershell.exe with the ps1 path', () => {
    const bat = renderBatWrapper('C:/Users/u/.dsh/desktop-launcher/launcher.ps1')
    expect(bat).toContain('powershell')
    expect(bat).toContain('-ExecutionPolicy Bypass')
    expect(bat).toContain('-WindowStyle Hidden')
    expect(bat).toContain('launcher.ps1')
  })
})