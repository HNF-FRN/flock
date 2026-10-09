<p align="center">
  <img src="docs/assets/banner.svg" width="100%" alt="Flock: every Claude account, side by side">
</p>

<p align="center">
  <a href="https://github.com/HNF-FRN/flock/releases/latest"><img src="https://img.shields.io/github/v/release/HNF-FRN/flock?style=flat-square&label=release&color=38BDF8&labelColor=0E0F11" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-Windows-4ADE80?style=flat-square&labelColor=0E0F11" alt="Windows">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-C084FC?style=flat-square&labelColor=0E0F11" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/built%20with-Claude%20Code-D97757?style=flat-square&labelColor=0E0F11" alt="Built with Claude Code">
</p>

<p align="center">
  <a href="docs/media/flock.mp4"><img src="docs/media/preview.webp" width="100%" alt="Flock's island opening one Claude account, then all of them side by side"></a>
  <br>
  <sub>▶ <a href="docs/media/flock.mp4">Watch the full film</a> (1:35, with sound)</sub>
</p>

<p align="center">
  <a href="https://github.com/HNF-FRN/flock/releases/latest"><img src="docs/assets/download.svg" height="64" alt="Download Flock for Windows"></a>
</p>

Claude Desktop lets you sign in to one account at a time. If you have a few (personal, work, a client), you sign out and back in all day.

**Flock** runs each account in its own Claude window, side by side, each signed in once and remembered. Every window is named after its account and wears its colour, so you always know which one you're typing into. A small island at the top of the screen holds one mascot per account: click one to open or bring up that account's window.

## What it does

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/side-by-side.svg" width="44" align="left" alt="">
      <b>Every account at once</b><br>
      Each account gets its own Claude window. Sign in once, and it stays signed in.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/identity.svg" width="44" align="left" alt="">
      <b>Always know where you're typing</b><br>
      Windows are titled after their account (<i>Work — Claude</i>) and get their own taskbar button and icon colour. The one you're typing in glows along its top edge.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/island.svg" width="44" align="left" alt="">
      <b>The island</b><br>
      A small bar at the top of the screen, one mascot per account. Hover it or press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>, then click an account.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/sessions.svg" width="44" align="left" alt="">
      <b>Session peek</b><br>
      Hover an account to see its recent Claude Code sessions. Click one to jump back in, or start a new one in that account.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/sign-in.svg" width="44" align="left" alt="">
      <b>Sign in once</b><br>
      Google and e-mail sign-in links reach the window that asked for them, not your main Claude window.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/folder.svg" width="44" align="left" alt="">
      <b>Shared or separate setup</b><br>
      An account can share your <code>~/.claude</code> (CLAUDE.md, skills, plugins, settings) or keep its own.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/out-of-way.svg" width="44" align="left" alt="">
      <b>Stays out of the way</b><br>
      When a maximized browser or editor sits under the island, it slides away and lets clicks through. Rest the pointer on the top edge to bring it back.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/icons/keyboard.svg" width="44" align="left" alt="">
      <b>Keyboard friendly</b><br>
      <kbd>1</kbd>–<kbd>9</kbd> open accounts, <kbd>↑</kbd> <kbd>↓</kbd> move between them, <kbd>A</kbd> opens them all.
    </td>
  </tr>
</table>

## Get started

You need Windows 11 (10 may work, but it isn't tested) and [Claude Desktop](https://claude.ai/download), from the Microsoft Store or the classic installer.

1. Download **Flock Setup** from [Releases](https://github.com/HNF-FRN/flock/releases/latest) and run it. It installs for your user only, no admin needed.
   The installer isn't code-signed yet, so SmartScreen may warn you: *More info → Run anyway*. Or [build it yourself](#build-from-source).
2. Open Flock. The first time, its settings window opens.
3. **Add account**: give it a name and a colour, and choose its `~/.claude`:
   - **Shared** uses `~\.claude` like your other shared accounts (same CLAUDE.md, skills, plugins, settings and memory in the Code tab).
   - **Its own** gets a separate folder (`~\.claude-<name>`), optionally starting with a copy of your CLAUDE.md, settings.json and skills.
   - **Same as…** shares another account's own folder, for example across several work accounts.
4. Flock opens that account's window. **Sign in once**, with *Continue with email* (then click the button in the e-mail) or with Google.
5. Switch on *Open automatically when Flock starts* for the accounts you want every time, and *Start Flock with Windows*.

### Keys

| Keys | What they do |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> | Open the island, from anywhere |
| <kbd>1</kbd> – <kbd>9</kbd> | Open that account |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move between accounts |
| <kbd>A</kbd> | Open all accounts |
| <kbd>Ctrl</kbd>+click | Select several |
| Right-click | More options for an account |

## How it works

<p align="center">
  <img src="docs/assets/how-it-works.svg" width="100%" alt="Flock starts the one Claude Desktop install once per account, each with its own data folder, and names and colours each window">
</p>

Claude Desktop is an Electron app, and Electron allows one window per **data folder**. So Flock starts each extra account with its own, through the Store build's own launch alias (so Claude updates don't break it):

```
claude-desktop.exe --user-data-dir=%APPDATA%\Claude-<name>
```

Main keeps Claude's default folder. Accounts that don't share `~/.claude` also get `CLAUDE_CONFIG_DIR`, which Claude Desktop and its Code tab read.

<p align="center">
  <img src="docs/assets/sign-in.svg" width="100%" alt="Windows hands every claude:// sign-in link to the main Claude window; Flock catches it and passes it to the account that is signing in">
</p>

Google and e-mail sign-in finish in the browser with a `claude://` link, and Windows always hands it to Main through a short-lived `Claude.exe "claude://…"` process. While an account waits for sign-in, Flock sees that process start (a WMI process-start event, about 0.1 s) and sends the link to the waiting window.

<details>
<summary><b>More on sign-in links</b></summary>
<br>

- **Google links:** Main keeps its copy too. It ignores a sign-in it didn't start, and it may be Main that is signing in.
- **E-mail and SSO links:** Flock stops the short-lived process before it reaches Main (Claude takes over a second to boot), so Main doesn't open a "Use verification code" page.
- **Connector sign-ins** in an extra account: right-click the account, then *Pass the next claude:// link here*.

Nothing is changed in the registry.
</details>

<details>
<summary><b>How windows are told apart</b></summary>
<br>

Claude draws every window the same way, so Flock marks them from the outside, without touching Claude or covering its content:

- **Names.** Each window is titled after its account (*Work — Claude*), which Alt+Tab, Win+Tab, taskbar previews and screen-share pickers show. Its icon there is Claude's own icon in the account's colour, and each account gets its own taskbar button (Main stays on Claude's own button while it keeps Claude's orange). A pinned account button opens that account through Flock (`Flock.exe --open=<id>`).
- **Accent edge.** A slim line in the account's colour along the top of each window, in the empty strip above Claude's title-bar controls. The window you're typing in gets the full colour and a soft glow. It takes no clicks, is skipped wherever another window covers it, and is left out of screenshots and screen sharing.
- **Island.** While a Claude window has focus, the island shows that account's mascot and name.

What Flock changes on a Claude window is its title, its icon (`WM_SETICON`) and its taskbar identity (the window's `System.AppUserModel` properties). Windows keeps these on the window only; nothing is written to Claude's files, settings or the registry. Flock puts every window back when you switch *Name each window* off or quit Flock (also `Flock.exe --quit`). If Flock is killed instead, the windows keep their names until Flock runs again or Claude restarts, and Alt+Tab may show them without an icon meanwhile.

The coloured icons are drawn on your PC from the installed Claude app's own icon and kept in `%APPDATA%\Flock\icons`. A small helper reads where the windows are (window order, frame bounds, Windows' window events). Settings → *Claude windows* switches each part on or off.
</details>

<details>
<summary><b>Session peek</b></summary>
<br>

Claude Desktop keeps a small file per Code session in each account's data folder (`claude-code-sessions\<account>\<organization>\local_*.json`). Flock reads the title, folder and last activity from the signed-in account's files (archived and removed sessions are left out), and opens a session with Claude's own link, `claude://code/continue?session=…`, sent to that account's window like the sign-in links. Only local Code sessions are listed, not cloud ones.

A session already open in a window of its own (Claude's *Open in → New window*) is listed first and marked **Window**: clicking it brings that window to the front, restored if it was minimized. Claude's link would always open the session in the main window, so Flock reads which sessions Claude has in their own windows (`session-popouts.json` in the data folder) and finds that window by its title, or else by where Claude last saw it. Flock can't open a session in a new window itself: Claude has no link for that, only its own *Open in* menu.

In the island, **New** starts a Code session in that account, the **+** on a session starts one in that session's folder, and the magnifier opens Claude's session search.
</details>

<details>
<summary><b>Where things live</b></summary>
<br>

- The Microsoft Store build of Claude stores what it writes under `%APPDATA%` in `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\`, so the account folders live there.
- Flock reads two fields from each account's `config.json` (the last account id), to show "signed in" and to warn when two windows use one account.
- Flock's own settings and log are in `%APPDATA%\Flock\`. `flock.log` records links without their codes.
</details>

<img src="docs/assets/icons/trust.svg" width="40" align="left" alt="">

**What Flock doesn't do.** It doesn't read or store your login, doesn't sit between you and Claude, and never switches accounts for you. Every window is the normal Claude app with its own data folder, and you sign in to each one yourself.

## Good to know

- Only one account at a time can run **Cowork**'s VM. That's a Claude limitation.
- Don't sign the same Claude account into two windows, chat sync gets confused. Flock warns you when it sees that.
- Removing an account can keep its data (re-add it later, still signed in) or move it to the Recycle Bin.
- Windows only for now.

## Build from source

```bash
npm install
npm start
```

| Command | What it does |
|---|---|
| `npm run dist` | Builds `dist\Flock Setup <version>.exe` (per-user install, no admin) |
| `npm run icons` | Draws the app and tray icons from the mascot |
| `node scripts/readme-art.mjs` | Redraws the artwork in this README |

`dev/` holds a mascot preview page and `dev/cdp.js`, which drives a dev run started with `--remote-debugging-port=9339`. The accent edge is left out of screenshots; start a dev run with `FLOCK_EDGE_CAPTURE=1` to capture it.

The film at the top is made in code too: plain HTML, CSS and JS rendered frame by frame. See [`video/`](video/).

## Credits

- The island's look and palette follow [Coucou](https://github.com/Louis-CFM/coucou)'s MIT-licensed code (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Flock's mascot is its own character, made for Flock. It isn't Anthropic's Clawd or Coucou's Mochi.
- Film music: "Cat Walk" by Arulo, under the Mixkit Stock Music Free License. Sound effects from Mixkit.
- Flock ships no Anthropic artwork. The coloured Claude icons are drawn at run time from the copy of Claude on your PC, so keep them out of screenshots you publish.

Flock is an independent project. It is not made by, or affiliated with, Anthropic. Claude is a trademark of Anthropic.

## License

[MIT](LICENSE)
