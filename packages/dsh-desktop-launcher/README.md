# @linxin666/dsh-desktop-launcher

English | [中文](README.zh.md)

Create a desktop icon that launches dsh with one double-click: the icon starts
`dsh web` when it is not running, waits for the GUI to become ready, and opens
the browser at the configured URL. Works on Windows (.lnk), macOS (.command)
and Linux (.desktop).

## What it does

- Settings → Plugin configuration → Web UI plugins card with a "Create desktop
  icon" button; the host writes the launcher script under
  `~/.dsh/desktop-launcher/` and places the icon on the Desktop.
- Double-click behavior:
  - POSIX (macOS/Linux): probe the GUI URL; if it responds, open the browser.
    Otherwise start `dsh web` in the background, poll for up to 30 seconds,
    then open the browser. If the `dsh` command is missing, the launcher shows
    a message instead of failing silently.
  - Windows: the .lnk targets the node binary running dsh, which runs a tiny
    static Node launcher (`launcher-win.js`) that spawns `dsh web` detached and
    headless — no console window, and no PowerShell anywhere in the launch
    chain. `dsh web` opens the browser by default.
- The launcher is regenerated from the live settings each time you click the
  button, so `dshCommand`, `url` and `profile` changes apply on the next
  creation without editing the icon target.
- The Windows launch chain is shell-free: the .lnk points at the node binary, a
  static Node launcher (`launcher-win.js`) spawns `dsh web` headless
  (CREATE_NO_WINDOW, detached), and the shortcut leaves no console window
  behind. The .lnk itself is created once by the host through
  `powershell -NoProfile -Command` (plain COM shortcut creation — no
  `-ExecutionPolicy Bypass`, no `-File`, no script file on disk, no runtime
  `Add-Type`).
- The Windows shortcut uses the DeepSeek Harness whale icon (white background);
  launching it opens the app directly with no black console window.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-desktop-launcher
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-desktop-launcher
```

Restart `dsh web`, open Settings → Plugin configuration → Web UI plugins,
enable the plugin (it ships off by default), and click "Create desktop icon".

## Config

All fields live in the plugin settings card (or in the composition entry):

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch for the plugin; off by default. |
| `announceToAgent` | `false` | Opt-in: when true, announces the plugin in the system prompt. |
| `dshCommand` | `dsh` | Command that starts dsh; must be on PATH. |
| `url` | `http://127.0.0.1:3080` | GUI URL the launcher waits for and opens. |
| `profile` | unset | Optional `--profile` argument passed to `dsh web`. |
| `iconPath` | unset | Icon file (.ico/.png) for the desktop icon; blank uses the bundled DeepSeek Harness icon. |

## Security model

- The host API is loopback-only: requests from non-local addresses, foreign
  Host headers and cross-site origins are rejected with 403.
- The plugin writes only two places: `~/.dsh/desktop-launcher/` (launcher
  scripts) and the user's Desktop directory (the icon).
- On Linux the icon creation best-effort marks the `.desktop` file as trusted
  with `gio`; on desktop environments without `gio` the file still appears but
  may need a manual "allow launching" step.

## Known limitations

- The launcher assumes `dsh` is reachable on PATH at double-click time; if you
  installed dsh outside PATH, set `dshCommand` to the absolute command.
- The 30-second readiness poll applies to the POSIX launchers and is fixed;
  very slow first starts may time out (the launcher then shows a message).
  Windows has no poll: `dsh web` opens the browser itself.
- Creating the icon requires a Desktop directory; OneDrive-redirected Windows
  desktops are detected, other redirects may need a manual icon placement.

## License

Apache-2.0.
