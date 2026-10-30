<p align="center">
  <img src="build/icon-256.png" width="96" alt="mymux">
</p>

<h1 align="center">mymux</h1>

<p align="center">
  <b>A desktop app for Claude Code that feels like a chat, not a terminal.</b><br>
  Run several conversations side by side and watch each one work in its own live browser.
</p>

<p align="center">
  <a href="https://github.com/HRyohni/MyMux/releases/latest"><b>Download</b></a> ·
  <a href="#why-mymux">Why mymux</a> ·
  <a href="#features">Features</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#development">Development</a>
</p>

---

## Why mymux

Claude Code is powerful, but following several long-running conversations in terminal windows is hard. mymux keeps all of Claude Code and gives it a proper interface:

- **See what Claude sees.** Every conversation has a real browser panel. Claude drives it, you watch live, and you can click in it yourself.
- **Run many conversations at once.** Split panes and groups keep each task in view, and the layout comes back after a restart.
- **Review before anything changes.** Edits appear as diffs in the permission card. Reject one and tell Claude what to do instead.
- **Open your documents next to the chat.** PDF, Word, Excel, PowerPoint and Markdown files open in the panel, for you and for Claude.
- **No setup.** It uses the login, models, settings, `CLAUDE.md`, skills and hooks you already have in the Claude Code CLI.

mymux runs Claude Code through the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (`settingSources: user, project, local`) and renders messages, tool calls, diffs and approvals as a normal chat.

## Install

1. Download `mymux Setup x.y.z.exe` from [Releases](https://github.com/HRyohni/MyMux/releases/latest) and run it.
2. Log in to Claude Code (`claude`, then `/login`) or set `ANTHROPIC_API_KEY`.
3. Start mymux, pick a working folder and start typing.

The app updates itself: new versions download in the background and install when you close it.

> The installer is not code-signed yet, so Windows SmartScreen asks for confirmation on first launch (*More info → Run anyway*).

Windows is the tested platform. macOS (dmg) and Linux (AppImage) builds are configured but untested, so reports and fixes are very welcome.

## Features

### Panes and groups
- **Split panes**: conversations side by side, to the right or below, each with its own browser. Drag a conversation from the sidebar into any pane.
- **Groups**: each group is a separate pane layout, for example three conversations for one project and three for another. Double-click to rename.
- **Persistent layout**: groups, splits, sizes and open conversations return after a restart. Save named layouts in *Settings → Layouts*.
- **Overview** (`Ctrl+Shift+O`): status, context, cost and change count for every conversation.

### Conversation
- **Approvals with diffs**: Edit and Write show a diff before you approve. Next to *Reject* you can say what Claude should do instead.
- **Questions and plans**: `AskUserQuestion` is a card with answer options. A plan is a readable document with buttons to approve it or keep planning.
- **Slash commands and `@` files**: `/` offers built-in commands, skills and project commands. `@` searches the working folder and respects `.gitignore`.
- **Attachments**: paperclip, drag and drop, or `Ctrl+V`. Images go as images, everything else as a path.
- **Message queue**: a message sent while Claude works waits for the end of the reply, or send it now (lightning icon) so Claude sees it between two steps.
- **Message actions**: copy, edit, retry, branch into a new pane, and restore files to their state before that message (SDK file checkpointing).
- **Tasks and subagents**: the task list stays pinned above the input while work is unfinished, and an Agent card holds the subagent's whole conversation.
- **Context and cost**: context window usage, session cost and the cost of each reply.
- **Model, effort and permission mode** are chosen under the input, per conversation.
- **"⋯" menu**: attach a browser screenshot, `/add-dir`, extended thinking, fast mode and your own prompt templates.
- **Background tasks, hooks and MCP input**: background agents have a stop button, hook errors appear in the conversation, and MCP forms and URL steps arrive as cards.

### Browser panel
- Each session has its own tabs. Claude uses them through built-in `browser_*` tools without asking for approval, and you see everything live. You can also click around or enter a URL yourself.
- Opens **PDF, DOCX, XLSX/CSV, PPTX, Markdown** and text files. The icon next to a path in a Read, Edit or Write card opens that file in the panel.
- File tree of the working folder, zoom, find in page, DevTools and a download list.
- **Select text** on a page or in the chat and a bubble appears: *Ask mymux* quotes the selection into the input with its source, *Google it* searches for it in a new tab.

### Git, sessions and export
- **Git** (branch icon): working tree changes with a diff against HEAD, commit, stash, and *New worktree + conversation* so two conversations never touch the same files.
- **Sessions**: resume any earlier Claude Code session with its history, search by title and transcript content, rename, archive, delete and fork.
- **Export** a conversation to Markdown or HTML.
- **Conversations can collaborate**: Claude sees your other open conversations (`session_list`) and can message them (`session_send`, with your approval).
- **Remote Control** (phone icon): continue the same conversation from claude.ai or the mobile app. Requires a claude.ai account, it does not work with an API key.

### Notifications
A notification arrives when Claude finishes, waits for approval, or has a question or a plan, and clicking it opens that conversation. The tray icon shows how many conversations are waiting for you and how many are working. A short sound marks the end of a reply, with a lower tone on errors, and the speaker button turns it off.

## Settings

`Ctrl+,` opens settings: theme, display size, sound, default model, effort and permission mode, shortcuts, prompt templates and layouts. These tabs apply to the conversation in the focused pane:

- **MCP servers**: status, errors, reconnect and enable or disable. Servers added in the app apply to every new mymux conversation and leave your Claude Code configuration alone.
- **Permissions and hooks**: add and remove rules (by default in the project's `.claude/settings.local.json`). Hooks are read-only here.
- **Account and usage**: subscription and limit usage (5 hours, 7 days).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+N` | new conversation in the focused pane |
| `Ctrl+\` / `Ctrl+Shift+\` | split pane right / down |
| `Ctrl+W` | close pane (the conversation stays in the sidebar) |
| `Ctrl+T` | new group |
| `Ctrl+1` … `Ctrl+9` | switch to group |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous group |
| `Ctrl+Shift+W` | close group |
| `Ctrl+B` | show / hide browser panel |
| `Ctrl+Shift+B` | show / hide sidebar |
| `Ctrl+F` | search the conversation (in the browser: the page) |
| `Ctrl+Shift+O` | overview of all conversations |
| `Ctrl+,` | settings |
| `Enter` / `Shift+Enter` | send / new line |

Every shortcut can be changed in settings. While the browser panel has focus, `Ctrl+T`/`Ctrl+W` (tab), `Ctrl+F`, `Ctrl +/-/0` (zoom) and `F12` (DevTools) apply.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev          # dev mode with hot reload
npm start            # build and run
npm run typecheck
npm test             # vitest
npm run dist         # Windows installer -> dist/
npm run dist:mac     # macOS dmg (on macOS)
npm run dist:linux   # Linux AppImage (on Linux)
npm run release      # Windows build + publish to GitHub Releases (needs GH_TOKEN)
```

Stack: Electron, electron-vite, React, Tailwind, zustand, Claude Agent SDK, Playwright (over CDP).

Issues and pull requests are welcome. Testing on macOS and Linux is the most useful help right now.

### Project structure

| Path | Contents |
|---|---|
| `src/main/agent.ts` | sessions through `query()` with streaming input, approvals (`canUseTool`) |
| `src/main/browser.ts` | one `WebContentsView` per tab, plus Playwright over CDP |
| `src/main/browserTools.ts` | in-process `mymux` MCP server with the `browser_*` tools |
| `src/main/documents.ts` | DOCX (mammoth), XLSX/CSV (SheetJS), PPTX (JSZip) and Markdown to HTML for the browser panel |
| `src/main/files.ts` | search for `@` mentions, temporary attachments |
| `src/main/git.ts` | status, diff, commit, stash, worktree |
| `src/main/extras.ts` | file tree, transcript search, subagents, export, permission rules |
| `src/main/updater.ts` | auto-update (electron-updater) |
| `src/main/index.ts` | window, IPC, notifications, dev hooks |
| `src/preload/` | `window.mymux` API (contextBridge); `page.ts` is the preload of browser panel pages (the selection bubble) |
| `src/renderer/` | React UI; pure logic with tests lives in `reducer.ts`, `layout.ts`, `diff.ts` and `keys.ts` |
| `src/shared/ipc.ts` | types of the IPC contract |

<details>
<summary><b>Dev hooks (environment variables)</b></summary>

| Variable | What it does |
|---|---|
| `MYMUX_AUTOPROMPT` | sends a prompt right after startup |
| `MYMUX_CWD` | working folder of the autoprompt session |
| `MYMUX_AUTOOPEN=path.pdf` | opens a file in the browser panel after startup |
| `MYMUX_AUTORESUME=latest\|<id>` | resumes the latest (or given) session from `MYMUX_CWD` |
| `MYMUX_AUTOSPLIT=horizontal\|vertical` | splits the pane after startup |
| `MYMUX_AUTOANSWER=allow\|deny` | answers approvals automatically (`MYMUX_AUTOANSWER_DELAY` ms) |
| `MYMUX_AUTOIMAGE=path.png` | attaches an image to `MYMUX_AUTOPROMPT` |
| `MYMUX_MODE=plan` | permission mode of the autoprompt session (`plan`, `acceptEdits`, …) |
| `MYMUX_SCREENSHOT=path.png` | captures the window after `MYMUX_SCREENSHOT_DELAY` ms (several comma-separated values allowed) |
| `MYMUX_TOGGLE_SIDEBAR=ms` | collapses or expands the sidebar after the given time |
| `MYMUX_CDP_PORT=9333` | fixed CDP port for test scripts (Playwright `connectOverCDP`) |
| `MYMUX_USER_DATA=folder` | separate profile, so a test never touches a running app |
| `MYMUX_NO_UPDATE=1` | skips the update check |
| `MYMUX_DEBUG=1` | prints SDK message types to the console |

The app is single-instance: a second launch with the same profile only focuses the existing window.
</details>

<details>
<summary><b>How the browser panel works</b></summary>

- Electron starts with `--remote-debugging-port` on a free localhost port. Playwright connects through `connectOverCDP` and finds the page by its unique initial `data:` URL (title `mymux-<sessionId>`).
- The `mcp__mymux__browser_*` tools (navigate, open_file, snapshot, get_text, click, type, select, press, scroll, screenshot, eval, back, tabs, wait) are in `allowedTools`, so they need no approval. A snapshot tags interactive elements with a `data-mymux-ref` attribute (e1, e2…).
- The renderer only measures a placeholder `<div>` and sends `setBounds`. The native view always sits above the DOM, so the browser hides while a dialog is open.
- PDF uses Chromium's PDF viewer (`webPreferences.plugins: true`). Links that open a new window open a new tab.
</details>

<details>
<summary><b>Agent SDK notes</b></summary>

- With `includePartialMessages` the SDK sends an `assistant` message **per block**, not per whole message. The UI builds blocks from `stream_event` events and takes only the final tool `input` from `assistant` messages.
- The SDK does not echo the user's prompt, so the main process emits it to the UI itself.
- Tool results arrive as `user` messages with `tool_result` blocks.
</details>

## Distribution

- **Auto-update** checks GitHub Releases of the repository in `build.publish` (`HRyohni/MyMux`). A private repository would need a user token, so it is only practical for a public one.
- **Signing**: electron-builder signs the installer when `CSC_LINK` (.pfx or base64) and `CSC_KEY_PASSWORD` are set.
- **Platforms**: Windows (nsis, x64) is tested. macOS (dmg, arm64/x64) and Linux (AppImage, x64) are configured but untested.

## Known limitations

- Restoring a layout starts one Claude Code process for each conversation that was open.
- Editing or retrying a message rewinds the conversation but not the files; use *Restore files* for that.
- MCP servers with OAuth are authorized in the CLI (`/mcp`). The app shows their status and offers a reconnect.
- There is no built-in voice input, because the Web Speech API in Electron does not work without a Google key. Windows dictation (Win+H) works.
- Dialogs through `onUserDialog` are not supported. MCP input requests (elicitation) are.
- Next-message suggestions and fast mode depend on the model and subscription.
- PPTX is simplified (text, tables, images and notes, without positions or themes), and DOCX renders without complex formatting.
- Conversation search does not see the content of collapsed tool cards.
