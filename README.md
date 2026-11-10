# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Smooth carets

Text fields, the code editor, and embedded and detached terminals use spring carets adapted from [Skiper UI's Skiper106](https://skiper-ui.com/v1/skiper106) by gxuri. The implementation reuses Motion and preserves existing input styling. Reduced motion, forced colors, and IME composition use native carets.

Terminals use xterm's DOM renderer so the animated caret can follow the actual cursor, including terminal apps that hide it. To run the browser checks, start `npm run dev` and open `/tests/smoothCaret.html` with the page focused.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Terminal history autocomplete (Windows)

The embedded and detached terminals use PSReadLine history to suggest commands as you type. Press Right Arrow to accept a suggestion, then Enter to run it. Existing Tab completion stays available.

Typing at the PowerShell prompt also opens a popup with matching commands, recent history, arguments, and file paths. Use Up/Down to select, Tab or a click to insert, and Escape to dismiss. Inserting a suggestion never executes it; Enter runs the command. The popup follows detached terminals and stays off while commands or AI harnesses run.

F11/F12 combinations are reserved inside this PowerShell session to request and insert completions. Suggestions resume at the next shell prompt after submitting a command or cancelling input.

This requires PSReadLine 2.1 or newer. Install it in PowerShell, then open a new terminal:

```powershell
Install-Module PSReadLine -Scope CurrentUser -Force
```

The app sets `RemoteSigned` only for its PowerShell process so local modules can load. System execution policy stays unchanged. If suggestions cannot load, the terminal shows a warning and remains usable. The Windows history integration test also requires PSReadLine 2.1 or newer; it uses a temporary history file.

Terminal tabs automatically show brand icons for `codex`, `claude`, `antigravity` / `agy`, and `opencode` commands submitted in the app's PowerShell session. Icons reset when the shell prompt returns and stay synchronized when terminals detach or dock. Shell aliases and executable paths are supported; nested shells and wrapper scripts do not report their internal commands. Brand icons come from [Lobe Icons](https://github.com/lobehub/lobe-icons), with its license in `public/terminal-icons/LICENSE`.

## Remembering the open folder

The folder you open is saved the moment you pick it, and it is reopened the next time the app starts, so closing the app or shutting down the PC does not lose it. The folder is kept in `workspace.json` inside the app config folder, and access to it is restored along with it, so the file tree and the terminal work right away. If the folder was moved or deleted while the app was closed, the app starts without a folder instead of pointing at a missing path.

