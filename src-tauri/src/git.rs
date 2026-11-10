use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, process::{Command, Output}};
use tauri_plugin_fs::FsExt;

fn run(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command.current_dir(root).args(["--no-pager", "--literal-pathspecs"]).args(args)
        .env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "Never");
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command.output().map_err(|e| format!("Cannot run Git. Check that Git is installed: {e}"))
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = run(root, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8(output.stdout).map_err(|_| "Git returned a path or message that is not UTF-8.".into())
}

fn repository(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let scope = app.fs_scope();
    if !scope.is_allowed(path) { return Err("Open the repository folder first.".into()); }
    let folder = path.canonicalize().map_err(|e| e.to_string())?;
    if !scope.is_allowed(&folder) { return Err("Folder is outside the selected scope.".into()); }
    let root = PathBuf::from(git(&folder, &["rev-parse", "--show-toplevel"])?.trim());
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !scope.is_allowed(&root) { return Err("Open the repository root folder to use Source Control.".into()); }
    Ok(root)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change { path: String, original: Option<String>, index: char, worktree: char }

fn changes(text: &str) -> Result<Vec<Change>, String> {
    let mut entries = text.split('\0').filter(|s| !s.is_empty());
    let mut result = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 || !entry.is_char_boundary(3) { return Err("Invalid Git status record.".into()); }
        let index = entry.as_bytes()[0] as char;
        let worktree = entry.as_bytes()[1] as char;
        let original = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            Some(entries.next().ok_or("Missing rename source.")?.to_string())
        } else { None };
        result.push(Change { path: entry[3..].into(), original, index, worktree });
    }
    Ok(result)
}

#[derive(Serialize)]
pub struct Commit { sha: String, subject: String, author: String, date: String }
#[derive(Serialize)]
pub struct Snapshot { branch: String, changes: Vec<Change>, commits: Vec<Commit> }

/// A file that has changes which are not committed yet.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry { path: String, index: char, worktree: char }

/// Turns a repository relative path into an absolute path that uses the
/// platform separator, so it can be compared with the paths the file tree
/// lists.
fn absolute_path(root: &Path, relative: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        path.push(component.as_os_str());
    }
    path
}

/// Lists the files with changes that are not committed yet.
///
/// Untracked files are reported one by one so the file tree can mark each of
/// them, including the ones inside a new folder.
#[tauri::command]
pub async fn git_status(app: tauri::AppHandle, path: PathBuf) -> Result<Vec<StatusEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = repository(&app, &path)?;
        let rows = changes(&git(&root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?)?;
        Ok(rows
            .into_iter()
            .map(|row| StatusEntry {
                path: absolute_path(&root, &row.path).to_string_lossy().into_owned(),
                index: row.index,
                worktree: row.worktree,
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let changes = changes(&git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=normal"])?)?;
    let branch = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .or_else(|_| git(root, &["rev-parse", "--short", "HEAD"]).map(|sha| format!("Detached at {}", sha.trim())))?;
    let mut commits = Vec::new();
    if run(root, &["rev-parse", "--verify", "HEAD"])?.status.success() {
        let log = git(root, &["log", "-100", "--date=iso-strict", "--format=%H%x00%s%x00%an%x00%aI", "-z"])?;
        let fields: Vec<_> = log.trim_end_matches('\0').split('\0').collect();
        for row in fields.chunks_exact(4) {
            commits.push(Commit { sha: row[0].into(), subject: row[1].into(), author: row[2].into(), date: row[3].into() });
        }
    }
    Ok(Snapshot { branch: branch.trim().into(), changes, commits })
}

#[tauri::command]
pub async fn git_snapshot(app: tauri::AppHandle, path: PathBuf) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&repository(&app, &path)?)).await.map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action { Stage, Unstage, Commit, Push }

#[tauri::command]
pub async fn git_action(app: tauri::AppHandle, path: PathBuf, action: Action, file: Option<String>, message: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = repository(&app, &path)?;
        match action {
            Action::Stage | Action::Unstage => {
                let file = file.ok_or("Select a changed file.")?;
                let current = snapshot(&root)?;
                let change = current.changes.iter().find(|c| c.path == file).ok_or("File status changed. Refresh and try again.")?;
                let mut args = match action {
                    Action::Stage => vec!["add", "--"],
                    _ if current.commits.is_empty() => vec!["rm", "--cached", "--"],
                    _ => vec!["restore", "--staged", "--"],
                };
                args.push(&file);
                if let Some(original) = &change.original { args.push(original); }
                git(&root, &args)?;
            }
            Action::Commit => {
                let message = message.ok_or("Enter a commit message.")?;
                if message.trim().is_empty() { return Err("Enter a commit message.".into()); }
                git(&root, &["commit", "-m", &message])?;
            }
            Action::Push => { git(&root, &["push"])?; }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_changes_and_renames_without_splitting_paths() {
        let rows = changes(" M file with spaces\0R  new\nname\0old name\0?? new.txt\0").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].worktree, 'M');
        assert_eq!(rows[1].path, "new\nname");
        assert_eq!(rows[1].original.as_deref(), Some("old name"));
        assert_eq!(rows[2].index, '?');
        assert!(changes("R  missing\0").is_err());
    }
    #[test]
    fn reads_empty_repository_without_creating_commits() {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "--initial-branch=main"]).unwrap();
        std::fs::write(dir.path().join("hello.txt"), "hello").unwrap();
        let state = snapshot(dir.path()).unwrap();
        assert_eq!(state.branch, "main");
        assert_eq!(state.changes.len(), 1);
        assert!(state.commits.is_empty());
    }
    #[test]
    fn maps_repository_paths_to_absolute_paths_with_native_separators() {
        let root = if cfg!(windows) { PathBuf::from("C:\\repo") } else { PathBuf::from("/repo") };
        assert_eq!(absolute_path(&root, "src/main.rs"), root.join("src").join("main.rs"));
        assert_eq!(absolute_path(&root, "main.rs"), root.join("main.rs"));
        #[cfg(windows)]
        assert!(!absolute_path(&root, "src/main.rs").to_string_lossy().contains('/'));
    }
}
