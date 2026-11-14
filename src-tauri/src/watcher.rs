use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher, recommended_watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::files;

/// Folders whose changes never reach the frontend. `.git` is the important
/// one: the app runs `git status` on focus, so watching it would make the
/// app refresh itself in an endless loop.
const IGNORED_FOLDERS: [&str; 12] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".turbo",
    "out",
    ".cache",
];

/// The live watchers, keyed by the window that asked for them and the folder
/// they watch. Two windows can watch the same folder independently, so
/// closing one of them leaves the other one alone.
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<(String, PathBuf), RecommendedWatcher>>);

/// Payload of the `fs-changed` event.
#[derive(Clone, Serialize)]
pub struct FsChanged {
    paths: Vec<String>,
}

/// Windows `canonicalize` returns verbatim `\\?\` paths. Notify reports the
/// paths it watched, so the watchers get the plain path and the frontend
/// receives the paths it already knows.
fn plain_path(path: &Path) -> PathBuf {
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

/// True when the path lies inside one of the ignored folders. Only the parts
/// below the watched root count, so a workspace that happens to live in a
/// folder named `build` is still watched.
fn is_ignored(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        IGNORED_FOLDERS
            .iter()
            .any(|ignored| name.eq_ignore_ascii_case(ignored))
    })
}

/// The folder as it is watched and as it is looked up again, so the same
/// folder always ends up under the same key.
fn folder_key(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    Ok(plain_path(&files::authorized_path(app, path)?))
}

/// Watches a folder recursively and reports every change inside it.
#[tauri::command]
pub async fn watch_folder(
    app: AppHandle,
    window: WebviewWindow,
    path: PathBuf,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = folder_key(&app, &path)?;
        let label = window.label().to_string();
        let state = app.state::<Watchers>();
        let mut watchers = state
            .0
            .lock()
            .map_err(|_| "The file watcher is not available.".to_string())?;
        if watchers.contains_key(&(label.clone(), folder.clone())) {
            return Ok(());
        }
        let root = folder.clone();
        let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else { return; };
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|changed| plain_path(changed))
                .filter(|changed| !is_ignored(&root, changed))
                .map(|changed| changed.to_string_lossy().into_owned())
                .collect();
            if paths.is_empty() {
                return;
            }
            let _ = window.emit("fs-changed", FsChanged { paths });
        })
        .map_err(|e| format!("Cannot watch folder: {e}"))?;
        watcher
            .watch(&folder, RecursiveMode::Recursive)
            .map_err(|e| format!("Cannot watch folder: {e}"))?;
        watchers.insert((label, folder), watcher);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the watcher of this window for the given folder.
#[tauri::command]
pub async fn unwatch_folder(
    app: AppHandle,
    window: WebviewWindow,
    path: PathBuf,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = folder_key(&app, &path)?;
        let label = window.label().to_string();
        let state = app.state::<Watchers>();
        let mut watchers = state
            .0
            .lock()
            .map_err(|_| "The file watcher is not available.".to_string())?;
        let removed = watchers.remove(&(label, folder));
        drop(removed);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drops the watchers of a window that was closed, so the other windows keep
/// their own watchers.
pub fn stop_owner(app: &AppHandle, owner: &str) {
    let state = app.state::<Watchers>();
    let removed = state.0.lock().ok().map(|mut watchers| {
        let keys: Vec<(String, PathBuf)> = watchers
            .keys()
            .filter(|(label, _)| *label == owner)
            .cloned()
            .collect();
        keys.into_iter()
            .filter_map(|key| watchers.remove(&key))
            .collect::<Vec<_>>()
    });
    drop(removed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_build_folders_but_keeps_regular_files() {
        let root = Path::new("repo");
        assert!(is_ignored(root, Path::new("repo/.git/config")));
        assert!(is_ignored(root, Path::new("repo/node_modules/pkg/index.js")));
        assert!(is_ignored(root, Path::new("repo/Target/debug/app.exe")));
        assert!(!is_ignored(root, Path::new("repo/src/main.rs")));
        assert!(!is_ignored(root, Path::new("repo/.github/workflows/ci.yml")));
    }
}
