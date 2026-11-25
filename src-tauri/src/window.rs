use tauri::{Manager, WebviewUrl};

/// Label prefix of the extra IDE windows opened from the file menu.
pub const WINDOW_PREFIX: &str = "sprig";

#[cfg(windows)]
pub(crate) fn disable_browser_reload_shortcut(webview: tauri::Webview) {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::ICoreWebView2AcceleratorKeyPressedEventArgs2,
    };
    use windows_core::Interface;

    let result = webview.with_webview(|view| {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                let mut key = 0;
                unsafe { args.VirtualKey(&mut key)? };
                if key == u32::from(b'R') {
                    // Let Ctrl+R reach the sidebar shortcut or shell input.
                    let args = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>()?;
                    unsafe { args.SetIsBrowserAcceleratorKeyEnabled(false)? };
                }
            }
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = unsafe {
            view.controller()
                .add_AcceleratorKeyPressed(&handler, &mut token)
        } {
            eprintln!("Cannot register reload shortcut: {error}");
        }
    });
    if let Err(error) = result {
        eprintln!("Cannot access webview for reload shortcut: {error}");
    }
}

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
