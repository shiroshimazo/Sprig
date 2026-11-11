use tauri::{Manager, WebviewUrl};

/// Label prefix of the extra IDE windows opened from the file menu.
pub const WINDOW_PREFIX: &str = "sprig";

/// Finds a label that no other window uses yet.
fn next_label(app: &tauri::AppHandle) -> String {
    let open = app.webview_windows();
    let mut index = 2;
    loop {
        let label = format!("{WINDOW_PREFIX}-{index}");
        if !open.contains_key(&label) {
            return label;
        }
        index += 1;
    }
}

/// Opens another IDE window with the same app page.
#[tauri::command]
pub async fn window_new(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    if window.label() == crate::terminal::DETACHED_LABEL {
        return Err("A terminal window cannot open new windows.".into());
    }
    let label = next_label(&app);
    tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Sprig")
        .inner_size(1000.0, 680.0)
        .min_inner_size(640.0, 420.0)
        .decorations(false)
        .build()
        .map_err(|error| format!("Cannot open a new window: {error}"))?;
    Ok(label)
}

/// Closes every extra IDE window, so the app can shut down with the main one.
pub fn close_all(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(WINDOW_PREFIX) {
            let _ = window.destroy();
        }
    }
}
