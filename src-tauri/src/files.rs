use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_fs::FsExt;

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

fn create_empty_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "A file already exists at this path. Choose a different name.".into()
            } else {
                format!("Cannot create file: {error}")
            }
        })
}

fn validate_name(name: &str) -> Result<(), String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("Enter a valid name without path separators or reserved characters.".into());
    }
    Ok(())
}

fn create_entry(
    app: &tauri::AppHandle,
    parent: &Path,
    name: &str,
    directory: bool,
) -> Result<PathBuf, String> {
    validate_name(name)?;
    let parent = authorized_path(app, parent)?;
    if !parent.is_dir() {
        return Err("Choose a folder for the new item.".into());
    }
    let path = parent.join(name);
    if !app.fs_scope().is_allowed(&path) {
        return Err("Destination is outside the opened folder.".into());
    }
    if directory {
        fs::create_dir(&path).map_err(|e| format!("Cannot create folder: {e}"))?;
    } else {
        create_empty_file(&path)?;
    }
    Ok(path)
}

#[tauri::command]
pub async fn create_file(
    app: tauri::AppHandle,
    parent: PathBuf,
    name: String,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || create_entry(&app, &parent, &name, false))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_folder(
    app: tauri::AppHandle,
    parent: PathBuf,
    name: String,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || create_entry(&app, &parent, &name, true))
        .await
        .map_err(|e| e.to_string())?
}

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

pub(crate) fn authorized_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
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

fn read_bytes(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open file: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("Cannot inspect file: {e}"))?;
    if !metadata.is_file() {
        return Err("Select a regular file.".into());
    }
    let too_large = || {
        format!(
            "Files larger than {} MiB are not supported yet.",
            limit / (1024 * 1024)
        )
    };
    if metadata.len() > limit {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    Ok(bytes)
}

fn read_text(path: &Path) -> Result<String, String> {
    let bytes = read_bytes(path, MAX_FILE_BYTES)?;
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
pub async fn read_image(app: tauri::AppHandle, path: PathBuf) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_bytes(&authorized_path(&app, &path)?, MAX_IMAGE_BYTES).map(tauri::ipc::Response::new)
    })
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    path: PathBuf,
    relative_path: PathBuf,
}

fn workspace_files(
    root: &Path,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<Vec<WorkspaceFile>, String> {
    let mut folders = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(folder) = folders.pop() {
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(error) if folder == root => return Err(format!("Cannot list folder: {error}")),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if matches!(entry.file_name().to_str(), Some(".git" | "node_modules")) {
                    continue;
                }
                if is_allowed(&path) {
                    folders.push(path);
                }
            } else if kind.is_file() && path.to_str().is_some() && is_allowed(&path) {
                let relative_path = path
                    .strip_prefix(root)
                    .expect("entry under workspace root")
                    .to_path_buf();
                files.push(WorkspaceFile { path, relative_path });
            }
        }
    }

    files.sort_unstable_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

#[tauri::command]
pub async fn list_workspace_files(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<Vec<WorkspaceFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = authorized_path(&app, &path)?;
        let scope = app.fs_scope();
        workspace_files(&root, |entry| scope.is_allowed(entry))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileTreeAction {
    Copy { folder: PathBuf },
    Move { folder: PathBuf },
    Duplicate,
    Rename { name: String },
    Trash,
    Open,
    Reveal,
}

fn workspace_entry(app: &tauri::AppHandle, root: &Path, path: &Path) -> Result<PathBuf, String> {
    let resolved = authorized_path(app, path)?;
    if !resolved.starts_with(root) {
        return Err("Choose an item within the opened folder.".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("Cannot inspect item: {e}"))?;
    if metadata.is_symlink() {
        return Err("This action is unavailable for links.".into());
    }
    Ok(resolved)
}

fn copy_entry(source: &Path, destination: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
        return Err(std::io::Error::other("Cannot copy links or special files."));
    }
    if metadata.is_dir() {
        fs::create_dir(destination)?;
        for child in fs::read_dir(source)? {
            let child = child?;
            copy_entry(&child.path(), &destination.join(child.file_name()))?;
        }
    } else {
        fs::copy(source, destination)?;
    }
    Ok(())
}

fn copy_to_folder(
    source: &Path,
    folder: &Path,
    duplicate: bool,
    allowed: impl Fn(&Path) -> bool,
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind};

    if folder.starts_with(source) {
        return Err(Error::other("Cannot copy a folder into itself."));
    }
    let name = source
        .file_name()
        .ok_or_else(|| Error::other("Item has no name."))?;
    // Publish the copy only once it is complete and the final name is available.
    let staging = tempfile::Builder::new()
        .prefix(".sprig-copy-")
        .tempdir_in(folder)?;
    let staged = staging.path().join("item");
    copy_entry(source, &staged)?;
    let publish = |destination: PathBuf| {
        if !allowed(&destination) {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                "Destination is outside the opened folder.",
            ));
        }
        renamore::rename_exclusive(&staged, destination)
    };
    if !duplicate {
        return publish(folder.join(name));
    }

    let (stem, extension) = if source.is_dir() {
        (name, None)
    } else {
        (source.file_stem().unwrap_or(name), source.extension())
    };
    let mut number = 1;
    loop {
        let mut candidate = stem.to_os_string();
        if number == 1 {
            candidate.push(" copy");
        } else {
            candidate.push(format!(" copy {number}"));
        }
        if let Some(extension) = extension {
            candidate.push(".");
            candidate.push(extension);
        }
        match publish(folder.join(candidate)) {
            Err(error) if error.kind() == ErrorKind::AlreadyExists => number += 1,
            result => return result,
        }
    }
}

fn file_tree_destination(
    app: &tauri::AppHandle,
    root: &Path,
    folder: &Path,
    name: &std::ffi::OsStr,
) -> Result<PathBuf, String> {
    let folder = workspace_entry(app, root, folder)?;
    if !folder.is_dir() || !app.fs_scope().is_allowed(folder.join(name)) {
        return Err("Choose a destination within the opened folder.".into());
    }
    Ok(folder)
}

fn run_file_tree_action(
    app: &tauri::AppHandle,
    root: &Path,
    path: &Path,
    action: FileTreeAction,
) -> Result<bool, String> {
    let root = authorized_path(app, root)?;
    if !root.is_dir() {
        return Err("Open a workspace folder first.".into());
    }
    let source = workspace_entry(app, &root, path)?;
    if source == root && !matches!(action, FileTreeAction::Open | FileTreeAction::Reveal) {
        return Err("The workspace folder cannot be changed here.".into());
    }
    if matches!(action, FileTreeAction::Open | FileTreeAction::Reveal) {
        return if matches!(action, FileTreeAction::Open) {
            tauri_plugin_opener::open_path(dunce::simplified(&source), None::<&str>)
                .map_err(|e| format!("Cannot open item: {e}"))
        } else {
            tauri_plugin_opener::reveal_item_in_dir(&source)
                .map_err(|e| format!("Cannot show item in the file manager: {e}"))
        }
        .map(|_| false);
    }
    let name = source.file_name().ok_or("Item has no name.")?;
    let parent = source.parent().ok_or("Item has no parent folder.")?;
    let scope = app.fs_scope();
    let allowed = |destination: &Path| scope.is_allowed(destination);
    let result = match action {
        FileTreeAction::Copy { folder } => {
            let folder = file_tree_destination(app, &root, &folder, name)?;
            copy_to_folder(&source, &folder, folder == parent, allowed)
        }
        FileTreeAction::Move { folder } => {
            let folder = file_tree_destination(app, &root, &folder, name)?;
            if folder.starts_with(&source) {
                return Err("Cannot move a folder into itself.".into());
            }
            if folder == parent {
                return Ok(false);
            }
            renamore::rename_exclusive(&source, folder.join(name))
        }
        FileTreeAction::Duplicate => copy_to_folder(&source, parent, true, allowed),
        FileTreeAction::Rename { name } => {
            validate_name(&name)?;
            let destination = parent.join(name);
            if destination == source {
                return Ok(false);
            }
            if !allowed(&destination) {
                return Err("Choose a destination within the opened folder.".into());
            }
            renamore::rename_exclusive(&source, destination)
        }
        FileTreeAction::Trash => {
            return trash::delete(&source)
                .map(|_| true)
                .map_err(|e| format!("Cannot move item to Trash: {e}"));
        }
        FileTreeAction::Open | FileTreeAction::Reveal => unreachable!(),
    };
    result.map(|_| true).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "An item with that name already exists in the destination.".into()
        } else {
            format!("File operation failed: {error}")
        }
    })
}

#[tauri::command]
pub async fn file_tree_action(
    app: tauri::AppHandle,
    root: PathBuf,
    path: PathBuf,
    action: FileTreeAction,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || run_file_tree_action(&app, &root, &path, action))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_reads_preserve_binary_bytes_and_enforce_the_limit() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("image.png");
        let bytes = [0x89, b'P', b'N', b'G', 0, 255];
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_bytes(&path, MAX_IMAGE_BYTES).unwrap(), bytes);
        assert!(read_text(&path).is_err());

        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_IMAGE_BYTES + 1)
            .unwrap();
        assert!(read_bytes(&path, MAX_IMAGE_BYTES).unwrap_err().contains("32 MiB"));
    }

    #[test]
    fn quick_open_lists_scoped_files_in_unexpanded_folders() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        for folder in ["nested", ".git", "node_modules", "private"] {
            fs::create_dir(root.join(folder)).unwrap();
            fs::write(root.join(folder).join("same.txt"), "").unwrap();
        }
        fs::write(root.join("same.txt"), "").unwrap();
        fs::write(root.join("hidden.txt"), "").unwrap();
        #[cfg(unix)]
        {
            let external = tempfile::tempdir().unwrap();
            fs::write(external.path().join("outside.txt"), "").unwrap();
            std::os::unix::fs::symlink(external.path(), root.join("link")).unwrap();
            assert_eq!(workspace_files(root, |_| true).unwrap().len(), 4);
        }

        let files = workspace_files(root, |path| {
            !path.starts_with(root.join("private")) && path != root.join("hidden.txt")
        }).unwrap();
        let relative: Vec<_> = files.iter().map(|file| file.relative_path.clone()).collect();
        assert_eq!(relative, [Path::new("nested").join("same.txt"), PathBuf::from("same.txt")]);
        assert!(files.iter().all(|file| file.path == root.join(&file.relative_path)));
        assert!(workspace_files(&root.join("same.txt"), |_| true).is_err());
    }

    #[test]
    fn tree_copy_preserves_contents_and_never_replaces_an_existing_item() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        let source = root.join("project");
        let other = root.join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("nested/note.txt"), "original").unwrap();
        fs::create_dir(&other).unwrap();

        copy_to_folder(&source, &other, false, |_| true).unwrap();
        fs::write(other.join("project/nested/note.txt"), "keep me").unwrap();
        assert_eq!(
            copy_to_folder(&source, &other, false, |_| true)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert_eq!(
            fs::read_to_string(other.join("project/nested/note.txt")).unwrap(),
            "keep me"
        );
        assert!(copy_to_folder(&source, &source.join("nested"), false, |_| true).is_err());
        assert!(copy_to_folder(&source, &other, true, |_| false).is_err());
        assert_eq!(fs::read_dir(&other).unwrap().count(), 1);
    }

    #[test]
    fn duplicates_use_the_next_free_name_and_keep_the_file_extension() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        let source = root.join("note.txt");
        fs::write(&source, "duplicate me").unwrap();
        fs::write(root.join("note copy.txt"), "keep me").unwrap();

        copy_to_folder(&source, root, true, |_| true).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("note copy.txt")).unwrap(),
            "keep me"
        );
        assert_eq!(
            fs::read_to_string(root.join("note copy 2.txt")).unwrap(),
            "duplicate me"
        );
    }

    #[test]
    fn validates_inline_names() {
        for name in [
            "",
            ".",
            "..",
            "../outside",
            "a/b",
            "a\\b",
            "C:drive",
            "a\n",
            "name.",
            "name ",
            "CON.txt",
            "LPT1",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        for name in ["new file.ts", ".gitignore", "项目", "src"] {
            assert!(validate_name(name).is_ok());
        }
    }

    #[test]
    fn creates_empty_file_without_overwriting_existing_paths() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("新 file.ts");
        create_empty_file(&path).unwrap();
        assert_eq!(read_text(&path).unwrap(), "");
        write_text(&path, "keep this", "").unwrap();
        assert!(
            create_empty_file(&path)
                .unwrap_err()
                .contains("already exists")
        );
        assert_eq!(read_text(&path).unwrap(), "keep this");
        assert!(create_empty_file(folder.path()).is_err());
        assert!(create_empty_file(&folder.path().join("missing/file.ts")).is_err());
    }

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
            "sprig-files-{}-{}",
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
