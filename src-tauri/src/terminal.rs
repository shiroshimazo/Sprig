use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, ipc::Channel};
use tauri_plugin_fs::FsExt;
use std::path::{Path, PathBuf};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Label of the window that started the session.
    owner: String,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.killer.kill();
    }
}

#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Session>>, AtomicBool);

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output(Vec<u8>),
    Exit,
    Error(String),
}

/// Windows `canonicalize` returns verbatim `\\?\` paths, which CMD and
/// PowerShell don't support as a working directory. Strip the prefix.
fn un_verbatim(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.as_os_str().to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err("Invalid terminal size.".into());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

#[tauri::command]
pub async fn terminal_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    cols: u16,
    rows: u16,
    output: Channel<TerminalEvent>,
    cwd: Option<std::path::PathBuf>,
) -> Result<(), String> {
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Terminals>();
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        if state.1.load(Ordering::SeqCst) {
            return Err("The application is closing.".into());
        }
        if sessions.contains_key(&id) {
            return Err("This terminal is already running.".into());
        }
        let pair = native_pty_system()
            .openpty(size(cols, rows)?)
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let shell = "powershell.exe".to_string();
        #[cfg(not(windows))]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut command = CommandBuilder::new(shell);
        if let Some(path) = cwd {
            let scope = app.fs_scope();
            if !scope.is_allowed(&path) {
                return Err("Select the working folder through Open Folder first.".into());
            }
            let resolved = path
                .canonicalize()
                .map_err(|e| format!("Cannot access working folder: {e}"))?;
            if !resolved.is_dir() || !scope.is_allowed(&resolved) {
                return Err("Working folder is unavailable or outside the selected scope.".into());
            }
            command.cwd(un_verbatim(&resolved));
        }
        // Restricted execution policy blocks PSReadLine modules installed for the user.
        #[cfg(windows)]
        command.args([
            "-NoLogo",
            "-NoExit",
            "-ExecutionPolicy",
            "RemoteSigned",
            "-Command",
            include_str!("terminal-startup.ps1"),
        ]);
        #[cfg(not(windows))]
        command.env("PS1", "\\W \\$ ");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "sprig");
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        sessions.insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                owner,
            },
        );
        drop(sessions);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        if output
                            .send(TerminalEvent::Output(buffer[..count].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = output.send(TerminalEvent::Error(error.to_string()));
                        break;
                    }
                }
            }
            let removed = app
                .state::<Terminals>()
                .0
                .lock()
                .ok()
                .and_then(|mut sessions| sessions.remove(&id));
            drop(removed);
            let _ = child.wait();
            let _ = output.send(TerminalEvent::Exit);
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<Terminals>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal is not running.")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
    app: tauri::AppHandle,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Resizing the pseudo console blocks, so it runs off the command thread to keep
    // the app responsive while the window is being resized.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Terminals>();
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions
            .get(&id)
            .ok_or("Terminal is not running.")?
            .master
            .resize(size(cols, rows)?)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_stop(state: tauri::State<Terminals>, id: String) -> Result<(), String> {
    let removed = state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    drop(removed);
    Ok(())
}

/// Label of the single shared window hosting all detached terminals.
pub const DETACHED_LABEL: &str = "detached-terminals";

#[tauri::command]
pub async fn terminal_popout(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    if window.label() == DETACHED_LABEL { return Err("A terminal window cannot detach a terminal.".into()); }
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
        return Err("Invalid terminal ID.".into());
    }
    {
        let state = app.state::<Terminals>();
        let sessions = state.0.lock().map_err(|e| e.to_string())?;
        if state.1.load(Ordering::SeqCst) || !sessions.contains_key(&id) {
            return Err("Terminal is no longer running.".into());
        }
    }
    // If the shared window already exists, raise it instead of creating a
    // second one — the terminal moves in as a new tab on the frontend side.
    if let Some(existing) = app.get_webview_window(DETACHED_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, DETACHED_LABEL, tauri::WebviewUrl::App("index.html?detached=1".into()))
        .title("Terminals").inner_size(900.0, 560.0).min_inner_size(320.0, 200.0).visible(false)
        .decorations(false)
        .build().map_err(|e| format!("Cannot open terminal window: {e}"))?;
    Ok(())
}

#[derive(Clone, serde::Deserialize)]
pub struct ExternalTab {
    pub name: String,
    pub path: Option<PathBuf>,
}

/// Titles go on the Windows Terminal command line, so strip anything that
/// could split commands or break quoting, and keep them short.
fn sanitize_external_title(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != ';' && *c != '"')
        .take(64)
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() { "Terminal".to_string() } else { trimmed.to_string() }
}

#[tauri::command]
pub async fn terminal_open_external(app: tauri::AppHandle, tabs: Vec<ExternalTab>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if tabs.is_empty() { return Err("No terminals to open.".into()); }
        if tabs.len() > 8 { return Err("Too many terminals to open in one window.".into()); }
        // Validate every folder before spawning anything so a bad path fails
        // the whole operation instead of leaving a half-open window.
        let mut resolved: Vec<(String, Option<PathBuf>)> = Vec::with_capacity(tabs.len());
        for tab in tabs {
            let name = sanitize_external_title(&tab.name);
            let dir = match tab.path {
                Some(path) => {
                    let scope = app.fs_scope();
                    if !scope.is_allowed(&path) { return Err("Open the working folder first.".into()); }
                    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
                    if !resolved.is_dir() || !scope.is_allowed(&resolved) {
                        return Err("Working folder is unavailable or outside the selected scope.".into());
                    }
                    Some(un_verbatim(&resolved))
                }
                None => None,
            };
            resolved.push((name, dir));
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut command = std::process::Command::new("wt.exe");
            command.arg("-w").arg("new");
            for (index, (name, dir)) in resolved.iter().enumerate() {
                if index > 0 { command.arg(";"); }
                command.arg("new-tab");
                if let Some(dir) = dir { command.arg("-d").arg(dir); }
                command.arg("--title").arg(name);
                command.arg("powershell.exe").arg("-NoLogo");
            }
            let result = command.creation_flags(0x08000000).status();
            if matches!(result, Ok(status) if status.success()) { return Ok(()); }
            // Fallback without Windows Terminal: one console window per tab.
            for (_, dir) in &resolved {
                let mut fallback = std::process::Command::new("powershell.exe");
                fallback.args(["-NoLogo", "-NoExit"]).creation_flags(0x00000010);
                if let Some(dir) = dir { fallback.current_dir(dir); }
                fallback.spawn().map_err(|e| format!("Cannot open an external terminal: {e}"))?;
            }
            Ok(())
        }
        #[cfg(not(windows))]
        Err("Opening an external terminal is currently supported on Windows.".into())
    }).await.map_err(|e| e.to_string())?
}

pub fn stop_all(app: &tauri::AppHandle) {
    let state = app.state::<Terminals>();
    state.1.store(true, Ordering::SeqCst);
    let removed = state
        .0
        .lock()
        .ok()
        .map(|mut sessions| std::mem::take(&mut *sessions));
    drop(removed);
}

/// Stops the sessions of a window that was closed, so no shell is left behind.
pub fn stop_owner(app: &tauri::AppHandle, owner: &str) {
    let state = app.state::<Terminals>();
    let removed = state.0.lock().ok().map(|mut sessions| {
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, session)| session.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        let mut removed = Vec::new();
        for id in ids {
            if let Some(session) = sessions.remove(&id) {
                removed.push(session);
            }
        }
        removed
    });
    drop(removed);
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dropping_session_terminates_shell() {
        let pair = native_pty_system().openpty(size(80, 24).unwrap()).unwrap();
        let writer = pair.master.take_writer().unwrap();
        let mut command = CommandBuilder::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-Command",
            "Start-Sleep -Seconds 60",
        ]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let session = Session {
            master: pair.master,
            writer,
            killer: child.clone_killer(),
            owner: "main".to_string(),
        };
        drop(session);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Session cleanup did not terminate shell");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    #[test]
    fn external_titles_are_safe_for_the_windows_terminal_command_line() {
        assert_eq!(sanitize_external_title("Terminal 1"), "Terminal 1");
        assert_eq!(sanitize_external_title("a;b"), "ab");
        assert_eq!(sanitize_external_title("say \"hi\""), "say hi");
        assert_eq!(sanitize_external_title("a\nb\tc"), "abc");
        assert_eq!(sanitize_external_title("   "), "Terminal");
        assert_eq!(sanitize_external_title("a".repeat(100).as_str()), "a".repeat(64));
    }

    #[test]
    fn powershell_completes_history_and_reports_the_running_app() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("history.txt"), "codex; Write-Output ('HISTORY_' + 'ACCEPTED')\n").unwrap();
        let history = folder.path().join("history.txt").display().to_string().replace('\'', "''");
        let pair = native_pty_system().openpty(size(120, 30).unwrap()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "RemoteSigned", "-Command", &format!(
            "{}\nfunction codex {{}}\nSet-PSReadLineOption -HistorySaveStyle SaveIncrementally -HistorySavePath '{}'\nWrite-Output 'HISTORY_READY'",
            include_str!("terminal-startup.ps1"), history,
        )]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut chunk = [0u8; 8192];
            let mut typed = false;
            let mut accepted = false;
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 { break; }
                output.extend_from_slice(&chunk[..count]);
                if chunk[..count].windows(4).any(|bytes| bytes == b"\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    let _ = writer.flush();
                }
                let text = String::from_utf8_lossy(&output);
                if !typed && text.contains("HISTORY_READY") {
                    let _ = writer.write_all(b"cod");
                    let _ = writer.flush();
                    typed = true;
                }
                if !accepted && typed && text.contains("'HISTORY_' + 'ACCEPTED'") {
                    let _ = writer.write_all(b"\x1b[C\r");
                    let _ = writer.flush();
                    accepted = true;
                }
                let done = text.contains("HISTORY_ACCEPTED") || text.contains("History autocomplete unavailable:");
                if send.send(output.clone()).is_err() || done { break; }
            }
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut output = Vec::new();
        while let Ok(chunk) = receive.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            output = chunk;
            let text = String::from_utf8_lossy(&output);
            if text.contains("HISTORY_ACCEPTED") || text.contains("History autocomplete unavailable:") { break; }
        }
        let _ = child.kill();
        let _ = child.wait();
        let text = String::from_utf8_lossy(&output);
        assert!(text.contains("HISTORY_ACCEPTED"), "History completion failed: {text}");
        assert!(text.contains("\x1b]777;sprig;app=codex\x07"), "Running app was not reported: {text}");
    }

    #[test]
    fn powershell_popup_completes_without_running_until_enter() {
        let folder = tempfile::tempdir().unwrap();
        let history = folder.path().join("history.txt");
        std::fs::write(&history, "SprigPopupOne -Previous\n").unwrap();
        let history = history.display().to_string().replace('\'', "''");
        let pair = native_pty_system().openpty(size(100, 30).unwrap()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut command = CommandBuilder::new("powershell.exe");
        command.args(["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "RemoteSigned", "-Command", &format!(
            "{}\nSet-PSReadLineOption -HistorySaveStyle SaveIncrementally -HistorySavePath '{}'\nfunction SprigPopupOne {{}}\nfunction SprigPopupTwo {{ Write-Output ('POPUP_' + 'SUCCESS') }}\nWrite-Output 'POPUP_READY'",
            include_str!("terminal-startup.ps1"), history,
        )]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut chunk = [0u8; 8192];
            let (mut queried, mut accepted, mut submitted) = (false, false, false);
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 { break; }
                output.extend_from_slice(&chunk[..count]);
                let text = String::from_utf8_lossy(&output);
                if chunk[..count].windows(4).any(|bytes| bytes == b"\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    let _ = writer.flush();
                }
                if !queried && text.contains("POPUP_READY") {
                    let _ = writer.write_all(b"SprigPopup\x1b[24~");
                    let _ = writer.flush();
                    queried = true;
                }
                if let Some((_, tail)) = text.rsplit_once("\x1b]777;sprig;suggestions=") {
                    if let Some((json, _)) = tail.split_once('\x07') {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(json) {
                            if let Some(items) = payload["items"].as_array() {
                                if !accepted {
                                    if let Some(index) = items.iter().position(|item| item["label"] == "SprigPopupTwo") {
                                        let key = if index == 0 { "\x1b[23~".into() } else { format!("\x1b[23;{}~", index + 1) };
                                        let _ = writer.write_all(format!("{key}\x1b[24~").as_bytes());
                                        let _ = writer.flush();
                                        accepted = true;
                                    }
                                } else if !submitted && items.len() == 1 && items[0]["label"] == "SprigPopupTwo" {
                                    assert!(!text.contains("POPUP_SUCCESS"), "Completion ran before Enter");
                                    let _ = writer.write_all(b"\r");
                                    let _ = writer.flush();
                                    submitted = true;
                                }
                            }
                        }
                    }
                }
                let done = submitted && text.contains("POPUP_SUCCESS");
                if send.send(output.clone()).is_err() || done { break; }
            }
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut output = Vec::new();
        while let Ok(chunk) = receive.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            output = chunk;
            if String::from_utf8_lossy(&output).contains("POPUP_SUCCESS") { break; }
        }
        let _ = child.kill();
        let _ = child.wait();
        let text = String::from_utf8_lossy(&output);
        assert!(text.contains("POPUP_SUCCESS"), "Popup completion failed: {text}");
    }

    #[test]
    fn powershell_accepts_input_and_returns_output_through_pty() {
        let folder = tempfile::tempdir().unwrap();
        let working = folder.path().join("project with spaces");
        std::fs::create_dir(&working).unwrap();
        let pair = native_pty_system().openpty(size(80, 24).unwrap()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut command = CommandBuilder::new("powershell.exe");
        command.cwd(&working);
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-Command",
            "$line = [Console]::ReadLine(); Invoke-Expression $line",
        ]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        pair.master.resize(size(100, 30).unwrap()).unwrap();
        writer
            .write_all(b"Write-Output ('CWD=' + (Get-Location).Path); Write-Output ('PTY_' + 'SUCCESS'); exit\r\n")
            .unwrap();
        writer.flush().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut chunk = [0u8; 1024];
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                output.extend_from_slice(&chunk[..count]);
                if output.windows(4).any(|bytes| bytes == b"\x1b[6n") {
                    let _ = writer.write_all(b"\x1b[1;1R");
                    let _ = writer.flush();
                }
                if String::from_utf8_lossy(&output).contains("PTY_SUCCESS") {
                    break;
                }
            }
            let _ = send.send(output);
        });
        let result = receive.recv_timeout(std::time::Duration::from_secs(15));
        let _ = child.kill();
        let _ = child.wait();
        let output = result.expect("PowerShell output timed out");
        assert!(String::from_utf8_lossy(&output).contains("PTY_SUCCESS"));
        assert!(String::from_utf8_lossy(&output).contains(&format!("CWD={}", working.display())));
        assert!(size(0, 24).is_err());
    }
}
