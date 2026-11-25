import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ArrowLeft01Icon, ClipboardPasteIcon, Copy01Icon, Delete02Icon, LinkSquare01Icon, RedoIcon, RefreshIcon, SaveIcon, ScissorIcon, TextSelectIcon, UndoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isWindows } from "./lib/platform";
import "./ContextMenu.css";

export type ContextMenuItem = {
  label: string;
  shortcut?: string;
  enabled?: boolean;
  command?: number | null;
  children?: ContextMenuItem[];
  icon?: ReactNode;
  separator?: boolean;
  destructive?: boolean;
  action?: () => void;
  choice?: { kind: "checkbox" | "radio"; checked: boolean };
};

type NativeMenuItem = Pick<ContextMenuItem, "label" | "shortcut" | "enabled" | "command" | "choice"> & {
  name: string;
  separator_before: boolean;
  children: NativeMenuItem[];
};
type MenuRequest = { id: number; x: number; y: number; items: NativeMenuItem[] };
type Panel = { x: number; y: number; opener?: HTMLButtonElement; items: ContextMenuItem[] };
type Menu = { id: number; panel: Panel; editor: boolean };
type CloseMenu = (command?: number | null, restoreFocus?: boolean) => void;

const menuIcons = new Map([
  ["undo", UndoIcon],
  ["redo", RedoIcon],
  ["cut", ScissorIcon],
  ["copy", Copy01Icon],
  ["paste", ClipboardPasteIcon],
  ["pasteAndMatchStyle", ClipboardPasteIcon],
  ["pasteAsPlainText", ClipboardPasteIcon],
  ["delete", Delete02Icon],
  ["selectAll", TextSelectIcon],
  ["back", ArrowLeft01Icon],
  ["refresh", RefreshIcon],
  ["reload", RefreshIcon],
  ["saveAs", SaveIcon],
  ["saveImageAs", SaveIcon],
  ["copyImage", Copy01Icon],
  ["copyLink", Copy01Icon],
  ["openLinkInNewWindow", LinkSquare01Icon],
]);

function styleNativeItem(item: NativeMenuItem): ContextMenuItem {
  const icon = menuIcons.get(item.name);
  return {
    ...item,
    icon: icon && <HugeiconsIcon icon={icon} size={14} aria-hidden="true" />,
    separator: item.separator_before,
    children: item.children.map(styleNativeItem),
  };
}

function complete(id: number, command: number | null) {
  void invoke("complete_context_menu", { id, command }).catch(console.error);
}

function rememberFocus() {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return null;
  const focus = () => target.focus({ preventScroll: true });
  if (!(target instanceof HTMLTextAreaElement) || !target.closest(".terminal-content")) return focus;

  // xterm clears its hidden textarea on blur, including the selection prepared for native Copy.
  const { value, selectionStart, selectionEnd, selectionDirection } = target;
  return () => {
    focus();
    target.value = value;
    target.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  };
}

export default function ContextMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const pending = useRef<number | null>(null);
  const previousFocus = useRef<(() => void) | null>(null);

  const close = useCallback((command: number | null = null, restoreFocus = true) => {
    if (pending.current === null) return;
    if (restoreFocus) previousFocus.current?.();
    complete(pending.current, command);
    pending.current = null;
    previousFocus.current = null;
    setMenu(null);
  }, []);

  useEffect(() => {
    if (!isTauri() || !isWindows()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const onMenu = ({ id, x, y, items }: MenuRequest) => {
      if (disposed || document.querySelector(":modal")) {
        complete(id, null);
        return;
      }
      const scale = window.devicePixelRatio;
      const anchor = { x: x / scale, y: y / scale };
      const target = document.elementFromPoint(anchor.x, anchor.y);
      if (target?.closest('.file-tree-row[aria-haspopup="menu"], .context-menu')) {
        complete(id, null);
        return;
      }
      const editor = !!target?.closest(".cm-editor");
      if (pending.current === null) {
        previousFocus.current = rememberFocus();
      }
      pending.current = id;
      setMenu({ id, editor, panel: { ...anchor, items: items.map(styleNativeItem) } });
    };
    void getCurrentWebviewWindow().listen<MenuRequest>("webview-context-menu", ({ payload }) => onMenu(payload))
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          return invoke("register_context_menu");
        }
      }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
      if (pending.current !== null) {
        complete(pending.current, null);
        pending.current = null;
      }
    };
  }, []);

  return menu && <ContextMenuPopup
    key={menu.id}
    panel={menu.panel}
    close={close}
    label={menu.editor ? "Editor context menu" : undefined}
  />;
}

export function ContextMenuPopup({ panel, close, label = "Context menu" }: {
  panel: Panel;
  close: CloseMenu;
  label?: string;
}) {
  const [submenus, setSubmenus] = useState<Panel[]>([]);
  const panels = [panel, ...submenus];
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(null, false);
    };
    const dismiss = () => close(null, false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [close]);

  useLayoutEffect(() => {
    if (!root.current) return;
    const elements = root.current.querySelectorAll<HTMLDivElement>(".context-menu");
    const edge = 6;
    elements.forEach((element, index) => {
      const { x, y, opener } = panels[index];
      const { width, height } = element.getBoundingClientRect();
      const parent = opener?.getBoundingClientRect();
      const left = parent
        ? (parent.right + width <= window.innerWidth - edge ? parent.right : parent.left - width)
        : x;
      element.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      element.style.top = `${Math.max(edge, Math.min(parent?.top ?? y, window.innerHeight - height - edge))}px`;
    });
    const active = elements[elements.length - 1];
    if (active && !active.contains(document.activeElement)) {
      (active.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? active).focus({ preventScroll: true });
    }
  });

  const select = (index: number, item: ContextMenuItem, opener: HTMLButtonElement) => {
    if (item.action) {
      close();
      item.action();
    } else if (item.command != null) {
      close(item.command);
    } else if (item.children?.length) {
      setSubmenus([...submenus.slice(0, index), { x: 0, y: 0, opener, items: item.children }]);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const current = buttons.findIndex((button) => button === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        buttons[(current + 1) % buttons.length]?.focus();
        break;
      case "ArrowUp":
        buttons[(current > 0 ? current - 1 : buttons.length - 1)]?.focus();
        break;
      case "Home":
        buttons[0]?.focus();
        break;
      case "End":
        buttons[buttons.length - 1]?.focus();
        break;
      case "ArrowRight":
        if (buttons[current]?.hasAttribute("aria-haspopup")) buttons[current].click();
        break;
      case "ArrowLeft":
        if (index > 0) {
          panels[index].opener?.focus();
          setSubmenus(submenus.slice(0, index - 1));
        }
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        close();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return createPortal(
    <div ref={root} onContextMenu={(event) => event.preventDefault()}>
      {panels.map((panel, index) => (
        <div
          key={index}
          className="context-menu"
          role="menu"
          aria-label={panel.opener?.textContent?.trim() || label}
          tabIndex={-1}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {panel.items.map((item, itemIndex) => (
            <MenuRow key={itemIndex} item={item} index={itemIndex} submenu={panels[index + 1]} select={(opener) => select(index, item, opener)} />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function MenuRow({ item, index, submenu, select }: {
  item: ContextMenuItem;
  index: number;
  submenu: Panel | undefined;
  select: (opener: HTMLButtonElement) => void;
}) {
  const hasChildren = !!item.children?.length;
  return <>
    {item.separator && <div role="separator" className="context-menu-separator" />}
    <button
      type="button"
      role={item.choice ? `menuitem${item.choice.kind}` : "menuitem"}
      aria-checked={item.choice?.checked}
      tabIndex={-1}
      disabled={item.enabled === false}
      className={item.destructive ? "context-menu-danger" : undefined}
      aria-haspopup={hasChildren ? "menu" : undefined}
      aria-expanded={hasChildren ? submenu?.opener?.dataset.index === String(index) : undefined}
      data-index={index}
      onClick={(event) => select(event.currentTarget)}
    >
      {item.choice ? <span className="context-menu-check" aria-hidden="true">
        {item.choice.checked && (item.choice.kind === "radio" ? "●" : "✓")}
      </span> : item.icon}
      <span className="context-menu-label">{item.label}</span>
      {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
      {hasChildren && <span className="context-menu-arrow" aria-hidden="true" />}
    </button>
  </>;
}
