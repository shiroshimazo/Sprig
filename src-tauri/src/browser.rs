use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview,
    WebviewBuilder, WebviewUrl, Window, WindowBuilder,
};

pub(crate) const WINDOW_LABEL: &str = "browser";
const TOOLBAR_LABEL: &str = "browser-toolbar";
const PAGE_LABEL: &str = "browser-page";
const HOME: &str = "https://www.google.com/";
const TOOLBAR_HEIGHT: f64 = 52.0;

pub(crate) fn owns_webview(label: &str) -> bool {
    matches!(label, TOOLBAR_LABEL | PAGE_LABEL)
}

fn is_web_address(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn address_or_search(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Enter an address or search term.".into());
    }
    if input.contains("://") && !input.contains(char::is_whitespace) {
        return Url::parse(input)
            .ok()
            .filter(is_web_address)
            .ok_or_else(|| "Enter a valid HTTP or HTTPS address.".into());
    }
    if !input.contains(char::is_whitespace)
        && let Ok(url) = Url::parse(&format!("https://{input}"))
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| host == "localhost" || host.contains('.') || host.starts_with('['))
    {
        return Ok(url);
    }
    let mut url = Url::parse(HOME).map_err(|error| error.to_string())?;
    url.set_path("/search");
    url.query_pairs_mut().append_pair("q", input);
    Ok(url)
}

pub(crate) fn resize(window: &Window) -> tauri::Result<()> {
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    if let Some(toolbar) = window.app_handle().get_webview(TOOLBAR_LABEL) {
        toolbar.set_size(LogicalSize::new(size.width, TOOLBAR_HEIGHT))?;
    }
    if let Some(page) = window.app_handle().get_webview(PAGE_LABEL) {
        page.set_bounds(Rect {
            position: LogicalPosition::new(0.0, TOOLBAR_HEIGHT).into(),
            size: LogicalSize::new(size.width, (size.height - TOOLBAR_HEIGHT).max(0.0)).into(),
        })?;
    }
    Ok(())
}

fn report_address(app: &AppHandle, address: &str) {
    let _ = app.emit_to(
        EventTarget::webview(TOOLBAR_LABEL),
        "browser-address",
        address,
    );
}

#[cfg(windows)]
fn watch_address(page: &Webview) -> tauri::Result<()> {
    use webview2_com::{SourceChangedEventHandler, take_pwstr};
    use windows_core::PWSTR;

    let app = page.app_handle().clone();
    page.with_webview(move |view| {
        let register = || -> windows_core::Result<()> {
            let webview = unsafe { view.controller().CoreWebView2()? };
            let handler = SourceChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut source = PWSTR::null();
                    unsafe { sender.Source(&mut source)? };
                    let address = take_pwstr(source);
                    if Url::parse(&address).is_ok_and(|url| is_web_address(&url)) {
                        report_address(&app, &address);
                    }
                }
                Ok(())
            }));
            let mut token = 0;
            unsafe { webview.add_SourceChanged(&handler, &mut token) }
        };
        if let Err(error) = register() {
            eprintln!("Cannot watch browser address: {error}");
        }
    })
}

#[tauri::command]
pub(crate) async fn browser_open(app: AppHandle) -> Result<(), String> {
    if let Some(browser) = app.get_window(WINDOW_LABEL) {
        return browser
            .unminimize()
            .and_then(|_| browser.set_focus())
            .map_err(|error| error.to_string());
    }
    let home = Url::parse(HOME).map_err(|error| error.to_string())?;
    let window = WindowBuilder::new(&app, WINDOW_LABEL)
        .title("Browser")
        .inner_size(1000.0, 680.0)
        .min_inner_size(320.0, 240.0)
        .decorations(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    let setup = || -> tauri::Result<()> {
        let size = window
            .inner_size()?
            .to_logical::<f64>(window.scale_factor()?);
        window.add_child(
            WebviewBuilder::new(
                TOOLBAR_LABEL,
                WebviewUrl::App("index.html?browser=1".into()),
            ),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(size.width, TOOLBAR_HEIGHT),
        )?;
        // The remote webview has no matching capability. Only the local toolbar can invoke commands.
        let page = window.add_child(
            WebviewBuilder::new(PAGE_LABEL, WebviewUrl::External(home))
                .on_navigation(is_web_address)
                .on_page_load(|page, payload| {
                    if is_web_address(payload.url()) {
                        report_address(page.app_handle(), payload.url().as_str());
                    }
                }),
            LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
            LogicalSize::new(size.width, (size.height - TOOLBAR_HEIGHT).max(0.0)),
        )?;
        #[cfg(windows)]
        watch_address(&page)?;
        #[cfg(not(windows))]
        let _ = page;
        window.show()
    };
    if let Err(error) = setup() {
        let _ = window.destroy();
        return Err(error.to_string());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum BrowserAction {
    Address,
    Navigate { input: String },
    Back,
    Forward,
    Reload,
}

#[tauri::command]
pub(crate) async fn browser_control(
    webview: Webview,
    action: BrowserAction,
) -> Result<Option<String>, String> {
    if webview.label() != TOOLBAR_LABEL {
        return Err("This command is only available in the browser toolbar.".into());
    }
    let Some(page) = webview.app_handle().get_webview(PAGE_LABEL) else {
        return if matches!(action, BrowserAction::Address) {
            Ok(None)
        } else {
            Err("Browser page is still starting.".into())
        };
    };
    match action {
        BrowserAction::Address => {
            return page
                .url()
                .map(|url| is_web_address(&url).then(|| url.to_string()))
                .map_err(|error| error.to_string());
        }
        BrowserAction::Navigate { input } => page.navigate(address_or_search(&input)?),
        BrowserAction::Back => page.eval("history.back()"),
        BrowserAction::Forward => page.eval("history.forward()"),
        BrowserAction::Reload => page.reload(),
    }
    .map(|_| None)
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_and_searches_stay_on_http_or_https() {
        assert_eq!(
            address_or_search("example.org/path").unwrap().as_str(),
            "https://example.org/path"
        );
        assert_eq!(
            address_or_search("http://localhost:3000").unwrap().as_str(),
            "http://localhost:3000/"
        );
        let search = address_or_search("rust & tauri").unwrap();
        assert_eq!(search.path(), "/search");
        assert_eq!(search.query_pairs().next().unwrap().1, "rust & tauri");
        assert!(address_or_search("file:///secret.txt").is_err());
        assert!(address_or_search("   ").is_err());
    }
}
