import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPanel({ cwd }: { cwd: string | null }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const terminal = new Terminal({
      smoothScrollDuration: motion.matches ? 0 : 120,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: false,
      disableStdin: true,
      screenReaderMode: true,
      theme: {
        background: "#090909",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#404040",
      },
    });
    const updateMotion = () => { terminal.options.smoothScrollDuration = motion.matches ? 0 : 120; };
    motion.addEventListener("change", updateMotion);
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let disposed = false;
    let connected = false;
    let exited = false;
    const id = crypto.randomUUID();
    const report = (error: unknown) => {
      if (!disposed) terminal.writeln(`\r\nTerminal error: ${String(error)}`);
    };
    terminal.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "c" || key === "v")) {
        if (event.type === "keydown") {
          event.preventDefault();
          if (key === "c") {
            const selected = terminal.getSelection();
            if (selected) void navigator.clipboard.writeText(selected).catch(report);
          } else if (connected) {
            void navigator.clipboard.readText().then((text) => {
              if (!disposed && connected) terminal.paste(text);
            }).catch(report);
          }
        }
        return false;
      }
      return true;
    });
    let writes = Promise.resolve();
    const input = terminal.onData((data) => {
      if (connected) writes = writes.then(async () => {
        if (!disposed && connected) await invoke<void>("terminal_write", { id, data });
      }).catch(report);
    });
    let pendingSize: { cols: number; rows: number } | null = null;
    let resizing = false;
    const syncSize = async (cols: number, rows: number) => {
      pendingSize = { cols, rows };
      if (resizing || !connected || disposed) return;
      resizing = true;
      try {
        while (pendingSize && connected && !disposed) {
          const size = pendingSize;
          pendingSize = null;
          await invoke("terminal_resize", { id, ...size });
        }
      } catch (error) { if (connected && !disposed) report(error); }
      finally { resizing = false; }
    };
    const dimensions = terminal.onResize(({ cols, rows }) => { void syncSize(cols, rows); });
    const resize = () => {
      if (!disposed && element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    void document.fonts.ready.then(resize);
    resize();
    if (isTauri()) {
      const output = new Channel<{ type: "output"; data: number[] } | { type: "exit" } | { type: "error"; data: string }>();
      output.onmessage = (event) => {
        if (disposed || exited) return;
        if (event.type === "output") {
          connected = true;
          terminal.options.disableStdin = false;
          terminal.write(new Uint8Array(event.data));
        }
        else if (event.type === "error") report(event.data);
        else {
          exited = true;
          connected = false;
          terminal.options.disableStdin = true;
          terminal.writeln("\r\nShell exited.");
        }
      };
      void invoke("terminal_start", { id, cols: terminal.cols, rows: terminal.rows, output, cwd }).then(async () => {
        if (disposed) { await invoke("terminal_stop", { id }); return; }
        if (exited) return;
        connected = true;
        terminal.options.disableStdin = false;
        await syncSize(terminal.cols, terminal.rows);
      }).catch((error) => { if (!disposed) report(error); });
    } else {
      terminal.writeln("Open the desktop app to start a local shell.");
    }
    return () => {
      motion.removeEventListener("change", updateMotion);
      disposed = true;
      if (isTauri()) void invoke("terminal_stop", { id }).catch(() => {});
      connected = false;
      input.dispose();
      dimensions.dispose();
      observer.disconnect();
      terminal.dispose();
    };
  }, [cwd]);

  return <div ref={container} className="terminal-content" aria-label="Terminal output" />;
}
