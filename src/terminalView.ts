import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { handleShiftEnter } from "./terminalKeys";
import "@xterm/xterm/css/xterm.css";

export function createTerminalView(element: HTMLElement, handlers: {
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  canFit: () => boolean;
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
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => webgl.dispose());
  try { terminal.loadAddon(webgl); }
  catch (error) { webgl.dispose(); console.warn("WebGL unavailable; using the terminal DOM renderer.", error); }
  let disposed = false;
  const report = (error: unknown) => { if (!disposed) terminal.writeln(`\r\nTerminal error: ${String(error)}`); };
  terminal.attachCustomKeyEventHandler((event) => {
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
  const input = terminal.onData(handlers.input);
  const dimensions = terminal.onResize(({ cols, rows }) => handlers.resize(cols, rows));
  const fit = () => {
    if (!disposed && handlers.canFit() && element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
  };
  const observer = new ResizeObserver(fit);
  observer.observe(element);
  void document.fonts.ready.then(fit);
  return { terminal, fit, report, dispose: () => {
    disposed = true;
    motion.removeEventListener("change", updateMotion);
    input.dispose(); dimensions.dispose(); observer.disconnect(); terminal.dispose();
  } };
}
