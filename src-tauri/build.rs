fn main() {
    println!("cargo:rerun-if-changed=icons");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "git_snapshot",
            "git_action",
            "git_status",
            "read_file",
            "create_file",
            "create_folder",
            "list_directory",
            "save_file",
            "terminal_start",
            "terminal_write",
            "terminal_resize",
            "terminal_stop",
            "terminal_popout",
            "terminal_open_external",
            "restore_workspace",
            "save_workspace",
        ]),
    ))
    .expect("failed to build Tauri permissions");
}
