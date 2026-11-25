import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isWindows } from "./lib/platform";
import "./ContextMenu.css";

type Item = {
  label: string;
  shortcut: string;
  enabled: boolean;
  command: number | null;
  children: Item[];
};

type MenuRequest = { id: number; x: number; y: number; items: Item[]; terminal_only: boolean };
type Panel = { x: number; y: number; opener?: HTMLButtonElement; items: Item[] };
type Menu = { id: number; panels: Panel[] };

function complete(id: number, command: number | null, useNativeMenu = false) {
  void invoke("complete_context_menu", { id, command, useNativeMenu }).catch(console.error);
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
  const root = useRef<HTMLDivElement>(null);
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
    const onMenu = ({ id, x, y, items, terminal_only }: MenuRequest) => {
      if (disposed || document.querySelector(":modal")) {
        complete(id, null);
        return;
      }
      const scale = window.devicePixelRatio;
      const anchor = { x: x / scale, y: y / scale };
      if (terminal_only && !document.elementFromPoint(anchor.x, anchor.y)?.closest(".terminal-content")) {
        complete(id, null, true);
        return;
      }
      if (pending.current === null) {
        previousFocus.current = rememberFocus();
      }
      pending.current = id;
      setMenu({ id, panels: [{ ...anchor, items }] });
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

  useEffect(() => {
    if (!menu) return;
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
  }, [menu, close]);

  useLayoutEffect(() => {
    if (!menu || !root.current) return;
    const panels = root.current.querySelectorAll<HTMLDivElement>(".context-menu");
    const edge = 6;
    panels.forEach((panel, index) => {
      const { x, y, opener } = menu.panels[index];
      const { width, height } = panel.getBoundingClientRect();
      const parent = opener?.getBoundingClientRect();
      const left = parent
        ? (parent.right + width <= window.innerWidth - edge ? parent.right : parent.left - width)
        : x;
      panel.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`;
      panel.style.top = `${Math.max(edge, Math.min(parent?.top ?? y, window.innerHeight - height - edge))}px`;
    });
    const active = panels[panels.length - 1];
    if (active && !active.contains(document.activeElement)) {
      (active.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? active).focus({ preventScroll: true });
    }
  }, [menu]);

  if (!menu) return null;

  const select = (index: number, item: Item, opener: HTMLButtonElement) => {
    if (item.command !== null) {
      close(item.command);
    } else if (item.children.length) {
      setMenu({ ...menu, panels: [...menu.panels.slice(0, index + 1), { x: 0, y: 0, opener, items: item.children }] });
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
          menu.panels[index].opener?.focus();
          setMenu({ ...menu, panels: menu.panels.slice(0, index) });
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

  return (
    <div ref={root} onContextMenu={(event) => event.preventDefault()}>
      {menu.panels.map((panel, index) => (
        <div
          key={`${menu.id}-${index}`}
          className="context-menu"
          role="menu"
          aria-label={panel.opener?.textContent?.trim() || "Context menu"}
          tabIndex={-1}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {panel.items.map((item, itemIndex) => (
            <button
              key={itemIndex}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!item.enabled}
              aria-haspopup={item.children.length ? "menu" : undefined}
              aria-expanded={item.children.length ? menu.panels[index + 1]?.opener?.dataset.index === String(itemIndex) : undefined}
              data-index={itemIndex}
              onClick={(event) => select(index, item, event.currentTarget)}
            >
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
              {item.children.length > 0 && <span className="context-menu-arrow" aria-hidden="true" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
