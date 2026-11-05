mod files;
mod git;
mod terminal;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::Terminals::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if window.label() == "main" {
                    terminal::stop_all(window.app_handle());
                    for (label, detached) in window.app_handle().webview_windows() {
                        if label.starts_with("terminal-") { let _ = detached.destroy(); }
                    }
                } else if let Some(id) = window.label().strip_prefix("terminal-") {
                    let _ = window.app_handle().emit_to("main", "terminal-window-closed", id);
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
            files::save_file,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_stop,
            terminal::terminal_popout,
            terminal::terminal_open_external,
            files::list_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
