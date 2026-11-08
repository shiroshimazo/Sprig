import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { handleShiftEnter } from "./terminalKeys";
import { terminalBackground } from "./terminalBackground";
import { createTerminalSuggestions } from "./terminalSuggestions";
import { isTerminalIcon } from "./terminalIcons";
import { createSmoothCaret } from "./smoothCaret";
import type { TerminalIconId } from "./terminalIcons";
import "@xterm/xterm/css/xterm.css";

export function createTerminalView(element: HTMLElement, handlers: {
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  canFit: () => boolean;
  appChanged?: (icon: TerminalIconId) => void;
}) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const terminal = new Terminal({
    smoothScrollDuration: motion.matches ? 0 : 120,
    fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 13, lineHeight: 1,
    cursorBlink: false, disableStdin: true, screenReaderMode: true,
    theme: { background: "#090909", foreground: "#e5e5e5", cursor: "#e5e5e5", selectionBackground: "#404040" },
  });
  const updateMotion = () => { terminal.options.smoothScrollDuration = motion.matches ? 0 : 120; };
  motion.addEventListener("change", updateMotion);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(element);
  // The DOM renderer exposes the real cursor, including app-controlled visibility and wide characters.
  let nativeCursor: Element | null = null;
  let cursorClasses: string[] = [];
  const restoreCursor = () => nativeCursor?.classList.add(...cursorClasses);
  const hideCursor = () => {
    const cursor = element.querySelector(".xterm-cursor");
    if (cursor !== nativeCursor) { restoreCursor(); nativeCursor = cursor; cursorClasses = []; }
    const classes = Array.from(cursor?.classList ?? []).filter((name) => name.startsWith("xterm-cursor-"));
    if (classes.length) cursorClasses = classes;
    cursor?.classList.remove(...cursorClasses);
    return cursor;
  };
  const caret = createSmoothCaret(element, () => {
    if (terminal.hasSelection() || terminal.options.disableStdin) return null;
    const cursor = element.querySelector(".xterm-cursor");
    if (!cursor) return null;
    const rect = cursor.getBoundingClientRect();
    return { left: rect.left, top: rect.top, height: rect.height, color: terminal.options.theme?.cursor || "#e5e5e5" };
  }, (hidden) => { if (hidden) hideCursor(); else restoreCursor(); });
  const cursorFrame = terminal.onRender(() => {
    if (element.classList.contains("smooth-caret-active")) hideCursor();
    caret.update();
  });
  const cursorSelection = terminal.onSelectionChange(caret.update);
  let disposed = false;
  const suggestions = createTerminalSuggestions(terminal, element, handlers.input);
  const report = (error: unknown) => { if (!disposed) terminal.writeln(`\r\nTerminal error: ${String(error)}`); };
  terminal.attachCustomKeyEventHandler((event) => {
    if (!suggestions.key(event)) return false;
    if (!handleShiftEnter(event, (data) => terminal.input(data, true))) return false;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "c" || key === "v")) {
      if (event.type === "keydown") {
        event.preventDefault();
        if (key === "c") {
          const selected = terminal.getSelection();
          if (selected) void navigator.clipboard.writeText(selected).catch(report);
        } else if (!terminal.options.disableStdin) {
          void navigator.clipboard.readText().then((text) => {
            if (!disposed && !terminal.options.disableStdin) terminal.paste(text);
          }).catch(report);
        }
      }
      return false;
    }
    return true;
  });
  const input = terminal.onData(suggestions.input);
  const app = terminal.parser.registerOscHandler(777, (data) => {
    if (suggestions.receive(data)) return true;
    const prefix = "sprig;app=";
    if (!data.startsWith(prefix)) return false;
    const icon = data.slice(prefix.length);
    if (isTerminalIcon(icon)) handlers.appChanged?.(icon);
    return true;
  });
  const dimensions = terminal.onResize(({ cols, rows }) => handlers.resize(cols, rows));
  let background = "";
  const frame = terminal.onRender(() => {
    const buffer = terminal.buffer.active;
    const top = buffer.getLine(buffer.viewportY);
    const bottom = buffer.getLine(buffer.viewportY + terminal.rows - 1);
    const color = terminalBackground([
      bottom?.getCell(0), bottom?.getCell(terminal.cols - 1), top?.getCell(0), top?.getCell(terminal.cols - 1),
    ], terminal.options.theme);
    if (color !== background) {
      background = color;
      element.style.setProperty("--terminal-background", color);
    }
  });
  const fit = () => {
    if (!disposed && handlers.canFit() && element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
  };
  const observer = new ResizeObserver(fit);
  observer.observe(element);
  void document.fonts.ready.then(fit);
  return { terminal, fit, report, suggestions, dispose: () => {
    disposed = true;
    motion.removeEventListener("change", updateMotion);
    cursorFrame.dispose(); cursorSelection.dispose(); caret.dispose();
    suggestions.dispose(); input.dispose(); app.dispose(); frame.dispose(); dimensions.dispose(); observer.disconnect(); terminal.dispose();
    element.style.removeProperty("--terminal-background");
  } };
}
