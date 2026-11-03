fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_file",
            "list_directory",
            "save_file",
            "terminal_start",
            "terminal_write",
            "terminal_resize",
            "terminal_stop",
        ]),
    ))
    .expect("failed to build Tauri permissions");
}
