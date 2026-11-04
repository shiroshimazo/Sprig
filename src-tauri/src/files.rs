use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

fn check_unchanged(path: &Path, expected: &str) -> Result<(), String> {
    let file =
        fs::File::open(path).map_err(|e| format!("Cannot verify file before saving: {e}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot verify file before saving: {e}"))?;
    if bytes != expected.as_bytes() {
        return Err("File changed outside the app. Save was canceled; your edits are still available. Copy your edits before reopening the app to load the disk version.".into());
    }
    Ok(())
}

fn write_text(path: &Path, content: &str, expected: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("Files larger than 10 MiB are not supported yet.".into());
    }
    let metadata = fs::metadata(path).map_err(|e| format!("Cannot inspect file: {e}"))?;
    if !metadata.is_file() || metadata.permissions().readonly() {
        return Err("This file is not writable.".into());
    }
    check_unchanged(path, expected)?;
    let parent = path.parent().ok_or("File has no parent folder.")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    check_unchanged(path, expected)?;
    temporary
        .persist(path)
        .map_err(|e| format!("Cannot replace file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    path: PathBuf,
    content: String,
    expected_content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_text(&authorized_path(&app, &path)?, &content, &expected_content)
    })
    .await
    .map_err(|e| e.to_string())?
}

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
    let metadata = file
        .metadata()
        .map_err(|e| format!("Cannot inspect file: {e}"))?;
    if !metadata.is_file() {
        return Err("Select a regular file.".into());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("Files larger than 10 MiB are not supported yet.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Files larger than 10 MiB are not supported yet.".into());
    }
    if bytes
        .iter()
        .any(|byte| matches!(byte, 0..=8 | 11 | 14..=31 | 127))
    {
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
    fn unicode_paths_and_readonly_save_failure_preserve_content() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("项目 with spaces");
        fs::create_dir(&folder).unwrap();
        let path = folder.join("代码 file.txt");
        fs::write(&path, "original").unwrap();
        assert_eq!(read_text(&path).unwrap(), "original");
        let entries = directory_entries(&folder).unwrap();
        assert_eq!(entries[0].path, path);
        assert_eq!(entries[0].name, "代码 file.txt");
        write_text(&path, "saved 世界", "original").unwrap();
        let original_permissions = fs::metadata(&path).unwrap().permissions();
        let mut readonly = original_permissions.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&path, readonly).unwrap();
        let result = write_text(&path, "must not replace", "saved 世界");
        fs::set_permissions(&path, original_permissions).unwrap();
        assert!(result.unwrap_err().contains("not writable"));
        assert_eq!(read_text(&path).unwrap(), "saved 世界");
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
    }

    #[test]
    fn open_save_reopen_preserves_exact_bytes() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("code with spaces.txt");
        for original in [
            "",
            "no final newline",
            "one\ntwo\n",
            "one\r\ntwo\r\n",
            "one\rtwo\r",
            "one\r\ntwo\nthree\r",
            "\u{feff}hello 世界\r\n",
        ] {
            fs::write(&path, original.as_bytes()).unwrap();
            let opened = read_text(&path).unwrap();
            assert_eq!(opened, original);
            let edited = format!("edited {opened}");
            write_text(&path, &edited, &opened).unwrap();
            assert_eq!(fs::read(&path).unwrap(), edited.as_bytes());
            let reopened = read_text(&path).unwrap();
            assert_eq!(reopened, edited);
            write_text(&path, original, &reopened).unwrap();
            assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
        }
    }

    #[test]
    fn saves_and_rejects_oversized_content_without_changing_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("file.txt");
        fs::write(&path, "before").unwrap();
        write_text(&path, "after\r\n", "before").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "after\r\n");
        assert!(write_text(&path, &"x".repeat(MAX_FILE_BYTES as usize + 1), "after\r\n").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "after\r\n");
        write_text(&path, "", "after\r\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"");
    }

    #[test]
    fn external_changes_and_deleted_files_are_not_overwritten() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("file.txt");
        for changed in ["edited", "before\r\n", "", "BEFORE"] {
            fs::write(&path, changed).unwrap();
            assert!(
                write_text(&path, "my draft", "before")
                    .unwrap_err()
                    .contains("changed outside")
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), changed);
        }
        fs::write(&path, [0xff, 0x00]).unwrap();
        assert!(write_text(&path, "my draft", "before").is_err());
        assert_eq!(fs::read(&path).unwrap(), [0xff, 0x00]);
        fs::remove_file(&path).unwrap();
        assert!(write_text(&path, "my draft", "before").is_err());
        assert!(!path.exists());
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 0);
    }

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
            fs::write(root.join("controls"), [1, 2, 3]).unwrap();
            assert_eq!(
                read_text(&root.join("controls")).unwrap_err(),
                "Binary files are not supported."
            );
            fs::write(root.join("empty"), []).unwrap();
            assert_eq!(read_text(&root.join("empty")).unwrap(), "");
            let whitespace = "\ttext\r\n\n\u{c}";
            fs::write(root.join("whitespace"), whitespace).unwrap();
            assert_eq!(read_text(&root.join("whitespace")).unwrap(), whitespace);
            fs::write(root.join("limit"), vec![b'a'; MAX_FILE_BYTES as usize]).unwrap();
            assert_eq!(
                read_text(&root.join("limit")).unwrap().len(),
                MAX_FILE_BYTES as usize
            );
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                let locked = fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(root.join("a file.txt"))
                    .unwrap();
                assert!(
                    read_text(&root.join("a file.txt"))
                        .unwrap_err()
                        .contains("Cannot open file")
                );
                drop(locked);
                assert_eq!(read_text(&root.join("a file.txt")).unwrap(), text);
            }
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
