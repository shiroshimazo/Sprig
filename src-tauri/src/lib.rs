mod files;
mod git;
mod terminal;
mod workspace;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::Terminals::default())
        .on_page_load(|webview, _| {
            if let Err(error) = webview.set_zoom(1.1) {
                eprintln!("Cannot set app zoom: {error}");
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if window.label() == "main" {
                    terminal::stop_all(window.app_handle());
                    if let Some(detached) = window.app_handle().get_webview_window(terminal::DETACHED_LABEL) {
                        let _ = detached.destroy();
                    }
                } else if window.label() == terminal::DETACHED_LABEL {
                    let _ = window.app_handle().emit_to("main", "terminal-window-closed", ());
                }
            }
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            git::git_snapshot,
            git::git_action,
            files::read_file,
            files::create_file,
            files::create_folder,
            files::save_file,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_stop,
            terminal::terminal_popout,
            terminal::terminal_open_external,
            files::list_directory,
            workspace::restore_workspace,
            workspace::save_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
