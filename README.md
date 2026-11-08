# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Terminal history autocomplete (Windows)

The embedded and detached terminals use PSReadLine history to suggest commands as you type. Press Right Arrow to accept a suggestion, then Enter to run it. Existing Tab completion stays available.

This requires PSReadLine 2.1 or newer. Install it in PowerShell, then open a new terminal:

```powershell
Install-Module PSReadLine -Scope CurrentUser -Force
```

The app sets `RemoteSigned` only for its PowerShell process so local modules can load. System execution policy stays unchanged. If suggestions cannot load, the terminal shows a warning and remains usable. The Windows history integration test also requires PSReadLine 2.1 or newer; it uses a temporary history file.
