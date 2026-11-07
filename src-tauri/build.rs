fn main() {
    println!("cargo:rerun-if-changed=icons");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "git_snapshot",
            "git_action",
            "read_file",
            "create_file",
            "list_directory",
            "save_file",
            "terminal_start",
            "terminal_write",
            "terminal_resize",
            "terminal_stop",
            "terminal_popout",
            "terminal_open_external",
        ]),
    ))
    .expect("failed to build Tauri permissions");
}
