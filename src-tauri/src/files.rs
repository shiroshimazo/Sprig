use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: PathBuf,
    is_directory: bool,
    is_symlink: bool,
}

fn authorized_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let scope = app.fs_scope();
    if !scope.is_allowed(path) {
        return Err("Select this file or folder through the Open dialog first.".into());
    }
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("Cannot access path: {e}"))?;
    if !scope.is_allowed(&resolved) {
        return Err("The resolved path is outside the selected files and folders.".into());
    }
    Ok(resolved)
}

fn read_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open file: {e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Select a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Files larger than 10 MiB are not supported yet.".into());
    }
    if bytes.contains(&0) {
        return Err("Binary files are not supported.".into());
    }
    String::from_utf8(bytes).map_err(|_| "Only UTF-8 text files are supported.".into())
}

fn directory_entries(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| format!("Cannot list folder: {e}"))? {
        let entry = entry.map_err(|e| format!("Cannot read folder entry: {e}"))?;
        let kind = entry
            .file_type()
            .map_err(|e| format!("Cannot inspect folder entry: {e}"))?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path(),
            is_directory: kind.is_dir(),
            is_symlink: kind.is_symlink(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn read_file(app: tauri::AppHandle, path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_text(&authorized_path(&app, &path)?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_directory(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || directory_entries(&authorized_path(&app, &path)?))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_text_and_lists_only_immediate_children() {
        let root = std::env::temp_dir().join(format!(
            "personal-ide-files-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let result = std::panic::catch_unwind(|| {
            fs::create_dir(root.join("nested")).unwrap();
            fs::write(root.join("nested/child.txt"), "child").unwrap();
            let text = "hello 世界\r\n";
            fs::write(root.join("a file.txt"), text).unwrap();
            assert_eq!(read_text(&root.join("a file.txt")).unwrap(), text);
            let entries = directory_entries(&root).unwrap();
            assert_eq!(entries.len(), 2);
            assert!(entries[0].is_directory);
            assert_eq!(entries[1].name, "a file.txt");
            assert!(read_text(&root.join("missing")).is_err());
            assert!(read_text(&root).is_err());
            fs::write(root.join("binary"), [0, 1]).unwrap();
            assert!(read_text(&root.join("binary")).is_err());
            fs::write(root.join("invalid"), [255]).unwrap();
            assert!(read_text(&root.join("invalid")).is_err());
            let large = fs::File::create(root.join("large")).unwrap();
            large.set_len(MAX_FILE_BYTES + 1).unwrap();
            assert!(
                read_text(&root.join("large"))
                    .unwrap_err()
                    .contains("10 MiB")
            );
            assert!(directory_entries(&root.join("a file.txt")).is_err());
        });
        fs::remove_dir_all(&root).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}
