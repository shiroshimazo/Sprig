use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const STATE_FILE: &str = "workspace.json";

/// The parts of the workspace that survive an app restart.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    /// The folder that was open the last time the app ran.
    #[serde(default)]
    pub folder: Option<PathBuf>,
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Cannot locate the app config folder: {error}"))?;
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Cannot create the app config folder: {error}"))?;
    Ok(folder.join(STATE_FILE))
}

fn read_state_from(path: &Path) -> WorkspaceState {
    let Ok(text) = fs::read_to_string(path) else {
        return WorkspaceState::default();
    };
    // A damaged or outdated state file must never keep the app from starting.
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_state_to(path: &Path, state: &WorkspaceState) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Cannot serialize the workspace: {error}"))?;
    let temporary = path.with_file_name("workspace.json.tmp");
    fs::write(&temporary, text)
        .map_err(|error| format!("Cannot write the workspace: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot save the workspace: {error}"))
}

/// Reopens the folder that was open during the previous run.
///
/// The folder is put back into the file system scope, because the scope only
/// covers folders that were picked through a dialog and a restored folder was
/// never picked in this session.
#[tauri::command]
pub async fn restore_workspace(app: tauri::AppHandle) -> Result<WorkspaceState, String> {
    let path = state_path(&app)?;
    let state = read_state_from(&path);
    let Some(folder) = state.folder.clone() else {
        return Ok(state);
    };
    if !folder.is_dir() {
        // The folder was moved or deleted while the app was closed.
        let cleared = WorkspaceState::default();
        write_state_to(&path, &cleared)?;
        return Ok(cleared);
    }
    let resolved = folder.canonicalize().unwrap_or_else(|_| folder.clone());
    app.fs_scope()
        .allow_directory(&resolved, true)
        .map_err(|error| format!("Cannot reopen the last folder: {error}"))?;
    Ok(WorkspaceState {
        folder: Some(folder),
    })
}

/// Stores the folder that is currently open so the next run can restore it.
#[tauri::command]
pub async fn save_workspace(app: tauri::AppHandle, folder: Option<PathBuf>) -> Result<(), String> {
    let path = state_path(&app)?;
    write_state_to(&path, &WorkspaceState { folder })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_reads_the_open_folder() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(STATE_FILE);
        assert_eq!(read_state_from(&path), WorkspaceState::default());

        let state = WorkspaceState {
            folder: Some(PathBuf::from("C:\\Users\\tester\\project")),
        };
        write_state_to(&path, &state).unwrap();
        assert_eq!(read_state_from(&path), state);

        write_state_to(&path, &WorkspaceState::default()).unwrap();
        assert_eq!(read_state_from(&path), WorkspaceState::default());
    }

    #[test]
    fn a_damaged_state_file_falls_back_to_an_empty_workspace() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(STATE_FILE);
        fs::write(&path, "{not json").unwrap();
        assert_eq!(read_state_from(&path), WorkspaceState::default());
    }
}
