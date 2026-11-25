use serde::Serialize;
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};
use webview2_com::{
    ContextMenuRequestedEventHandler, Microsoft::Web::WebView2::Win32::*, take_pwstr,
};
use windows_core::{BOOL, Interface, PWSTR, Result};

const WRITING_DIRECTION_MENU_ID: i32 = 57328;

thread_local! {
    static WINDOWS: RefCell<HashMap<String, Option<PendingMenu>>> = RefCell::new(HashMap::new());
    static NEXT_REQUEST: Cell<u32> = const { Cell::new(0) };
}

#[derive(Clone, Serialize)]
struct MenuItem {
    name: String,
    label: String,
    shortcut: String,
    enabled: bool,
    command: Option<i32>,
    separator_before: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    choice: Option<MenuChoice>,
    children: Vec<MenuItem>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "checked", rename_all = "lowercase")]
enum MenuChoice {
    Checkbox(bool),
    Radio(bool),
}

#[derive(Clone, Serialize)]
struct MenuRequest {
    id: u32,
    x: i32,
    y: i32,
    items: Vec<MenuItem>,
}

struct PendingMenu {
    id: u32,
    commands: HashSet<i32>,
    args: ICoreWebView2ContextMenuRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

impl Drop for PendingMenu {
    fn drop(&mut self) {
        // WebView2 waits for completion even when no command is selected.
        let _ = unsafe { self.deferral.Complete() };
    }
}

fn menu_item_name(item: &ICoreWebView2ContextMenuItem) -> Result<String> {
    let mut name = PWSTR::null();
    unsafe { item.Name(&mut name)? };
    Ok(take_pwstr(name))
}

fn remove_excluded_items(collection: &ICoreWebView2ContextMenuItemCollection) -> Result<()> {
    let mut count = 0;
    unsafe { collection.Count(&mut count)? };
    for index in (0..count).rev() {
        let item = unsafe { collection.GetValueAtIndex(index)? };
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        unsafe { item.Kind(&mut kind)? };
        if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
            continue;
        }
        let excluded = match menu_item_name(&item)?.as_str() {
            "emoji" | "print" | "writingDirection" | "moreTools" | "inspectElement" => true,
            "other" if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU => {
                // WebView2 exposes Chromium's writing direction submenu under the name "other".
                let mut command = 0;
                unsafe { item.CommandId(&mut command)? };
                command == WRITING_DIRECTION_MENU_ID
            }
            _ => false,
        };
        if excluded {
            unsafe { collection.RemoveValueAtIndex(index)? };
        } else if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
            remove_excluded_items(&unsafe { item.Children()? })?;
        }
    }
    Ok(())
}

fn menu_items(
    collection: &ICoreWebView2ContextMenuItemCollection,
    commands: &mut HashSet<i32>,
    parent_enabled: bool,
    page_menu: bool,
) -> Result<Vec<MenuItem>> {
    let mut items = Vec::new();
    let mut separator_before = false;
    let mut count = 0;
    unsafe { collection.Count(&mut count)? };
    for index in 0..count {
        let item = unsafe { collection.GetValueAtIndex(index)? };
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        unsafe { item.Kind(&mut kind)? };
        if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
            separator_before = !items.is_empty();
            continue;
        }
        let name = menu_item_name(&item)?;
        if page_menu && !matches!(name.as_str(), "back" | "refresh" | "reload" | "saveAs") {
            continue;
        }
        let mut label = PWSTR::null();
        unsafe { item.Label(&mut label)? };
        let label = take_pwstr(label).replace('&', "");
        let mut shortcut = PWSTR::null();
        unsafe { item.ShortcutKeyDescription(&mut shortcut)? };
        let shortcut = take_pwstr(shortcut);
        let mut enabled = BOOL::default();
        unsafe { item.IsEnabled(&mut enabled)? };
        let enabled = parent_enabled && enabled.as_bool();
        let choice = match kind {
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_CHECK_BOX
            | COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_RADIO => {
                let mut checked = BOOL::default();
                unsafe { item.IsChecked(&mut checked)? };
                Some(if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_RADIO {
                    MenuChoice::Radio(checked.as_bool())
                } else {
                    MenuChoice::Checkbox(checked.as_bool())
                })
            }
            _ => None,
        };

        let (command, children) = if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
            (
                None,
                menu_items(&unsafe { item.Children()? }, commands, enabled, false)?,
            )
        } else {
            let mut command = 0;
            unsafe { item.CommandId(&mut command)? };
            if enabled {
                commands.insert(command);
            }
            (Some(command), Vec::new())
        };
        items.push(MenuItem {
            name,
            label,
            shortcut,
            enabled,
            command,
            separator_before: std::mem::take(&mut separator_before),
            choice,
            children,
        });
    }
    Ok(items)
}

fn show_menu(
    label: &str,
    app: &AppHandle,
    args: ICoreWebView2ContextMenuRequestedEventArgs,
) -> Result<()> {
    let collection = unsafe { args.MenuItems()? };
    remove_excluded_items(&collection)?;

    let target = unsafe { args.ContextMenuTarget()? };
    let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND::default();
    let mut editable = BOOL::default();
    unsafe {
        target.Kind(&mut kind)?;
        target.IsEditable(&mut editable)?;
    }
    let page_menu = kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE && !editable.as_bool();
    let mut commands = HashSet::new();
    let items = menu_items(&collection, &mut commands, true, page_menu)?;
    if items.is_empty() {
        return Ok(());
    }
    let mut location = Default::default();
    unsafe { args.Location(&mut location)? };
    let id = NEXT_REQUEST.with(|next| next.replace(next.get().wrapping_add(1)));
    let pending = PendingMenu {
        id,
        commands,
        deferral: unsafe { args.GetDeferral()? },
        args: args.clone(),
    };
    let displaced = WINDOWS.with(|windows| {
        let mut windows = windows.borrow_mut();
        let Some(window) = windows.get_mut(label) else {
            return Ok(None);
        };
        unsafe { args.SetHandled(true)? };
        Ok::<_, windows_core::Error>(window.replace(pending))
    })?;
    drop(displaced);

    if app
        .emit_to(
            EventTarget::webview_window(label),
            "webview-context-menu",
            MenuRequest {
                id,
                x: location.x,
                y: location.y,
                items,
            },
        )
        .is_err()
    {
        let reset = unsafe { args.SetHandled(false) };
        drop(take_pending(label, id));
        reset?;
    }
    Ok(())
}

fn take_pending(label: &str, id: u32) -> Option<PendingMenu> {
    WINDOWS.with(|windows| {
        let mut windows = windows.borrow_mut();
        let pending = windows.get_mut(label)?;
        pending.as_ref().filter(|menu| menu.id == id)?;
        pending.take()
    })
}

pub(crate) fn remove(label: &str) {
    let menu = WINDOWS.with(|windows| windows.borrow_mut().remove(label));
    drop(menu);
}

#[tauri::command]
pub(crate) fn register_context_menu(window: WebviewWindow) -> std::result::Result<(), String> {
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    window
        .with_webview(move |view| {
            let register = || -> Result<()> {
                if WINDOWS.with(|windows| windows.borrow().contains_key(&label)) {
                    return Ok(());
                }
                let webview =
                    unsafe { view.controller().CoreWebView2()? }.cast::<ICoreWebView2_11>()?;
                let menu_label = label.clone();
                let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        if let Err(error) = show_menu(&menu_label, &app, args) {
                            eprintln!("Cannot show custom context menu: {error}");
                        }
                    }
                    Ok(())
                }));
                let mut token = 0;
                unsafe { webview.add_ContextMenuRequested(&handler, &mut token)? };
                WINDOWS.with(|windows| {
                    windows.borrow_mut().insert(label, None);
                });
                Ok(())
            };
            if let Err(error) = register() {
                eprintln!("Cannot register custom context menu: {error}");
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn complete_context_menu(
    window: WebviewWindow,
    id: u32,
    command: Option<i32>,
) -> std::result::Result<(), String> {
    let label = window.label().to_owned();
    window
        .run_on_main_thread(move || {
            if let Some(menu) = take_pending(&label, id) {
                let result = if let Some(command) =
                    command.filter(|command| menu.commands.contains(command))
                {
                    unsafe { menu.args.SetSelectedCommandId(command) }
                } else {
                    Ok(())
                };
                if let Err(error) = result {
                    eprintln!("Cannot complete context menu: {error}");
                }
            }
        })
        .map_err(|error| error.to_string())
}
