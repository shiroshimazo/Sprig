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

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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
    id: String,
    cols: u16,
    rows: u16,
    output: Channel<TerminalEvent>,
    cwd: Option<std::path::PathBuf>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Terminals>();
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        if state.1.load(Ordering::SeqCst) {
            return Err("The application is closing.".into());
        }
        if sessions.contains_key(&id) || sessions.len() >= 4 {
            return Err("Terminal session limit reached.".into());
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
            command.cwd(resolved);
        }
        #[cfg(windows)]
        command.args([
            "-NoLogo",
            "-NoExit",
            "-Command",
            "function prompt { $p = (Get-Location).Path; $l = Split-Path -Leaf $p; if (-not $l) { $l = $p }; \"PS $l> \" }",
        ]);
        #[cfg(not(windows))]
        command.env("PS1", "\\W \\$ ");
        command.env("TERM", "xterm-256color");
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
pub fn terminal_resize(
    state: tauri::State<Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    sessions
        .get(&id)
        .ok_or("Terminal is not running.")?
        .master
        .resize(size(cols, rows)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_stop(state: tauri::State<Terminals>, id: String) -> Result<(), String> {
    let removed = state.0.lock().map_err(|e| e.to_string())?.remove(&id);
    drop(removed);
    Ok(())
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
