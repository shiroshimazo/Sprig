mod files;
mod git;
mod terminal;
mod window;
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
                    window::close_all(window.app_handle());
                } else if window.label() == terminal::DETACHED_LABEL {
                    // Every IDE window owns a share of the detached terminals,
                    // so they all have to dock them again.
                    let _ = window.app_handle().emit("terminal-window-closed", ());
                } else {
                    // A closed IDE window leaves no shells and no detached
                    // terminals behind.
                    terminal::stop_owner(window.app_handle(), window.label());
                    let _ = window.app_handle().emit("detached-owner-closed", window.label());
                }
            }
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            git::git_snapshot,
            git::git_action,
            git::git_status,
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
            window::window_new,
            files::list_directory,
            workspace::restore_workspace,
            workspace::save_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
