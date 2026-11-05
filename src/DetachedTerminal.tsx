import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createTerminalView } from "./terminalView";
import type { OwnerMessage, ViewMessage } from "./terminalRelay";

export default function DetachedTerminal({ id }: { id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const dock = useRef(() => {});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let attached = false;
    let closing = false;
    let exited = false;
    let messages = Promise.resolve();
    const unlisteners: (() => void)[] = [];
    const window = getCurrentWindow();
    const send = (message: ViewMessage) => {
      messages = messages.then(async () => { if (!disposed) await emitTo("main", `terminal-view-${id}`, message); })
        .catch((error) => { if (!disposed) setError(String(error)); });
    };
    const view = createTerminalView(container.current, {
      input: (data) => { if (attached && !exited) send({ type: "input", data }); },
      resize: (cols, rows) => { if (attached && !closing) send({ type: "resize", cols, rows }); },
      canFit: () => attached && !closing,
    });
    const { terminal } = view;
    dock.current = () => {
      if (!attached || closing) return;
      closing = true;
      terminal.options.disableStdin = true;
      send({ type: "dock" });
    };
    const setup = async () => {
      const output = await listen<OwnerMessage>("terminal-owner", ({ payload }) => {
        if (disposed) return;
        if (payload.type === "snapshot" && !attached) {
          terminal.resize(payload.cols, payload.rows);
          terminal.write(payload.text, () => {
            if (disposed) return;
            attached = true; exited = payload.exited;
            terminal.options.disableStdin = exited;
            terminal.scrollToLine(payload.viewport);
            send({ type: "attached" });
            void window.show().then(() => { view.fit(); terminal.focus(); }).catch((error) => setError(String(error)));
          });
        } else if (payload.type === "output") terminal.write(new Uint8Array(payload.data));
        else if (payload.type === "error") view.report(payload.data);
        else if (payload.type === "exit") {
          exited = true; terminal.options.disableStdin = true; terminal.writeln("\r\nShell exited.");
        } else if (payload.type === "drain") {
          terminal.write("", () => { if (!disposed) send({ type: "drained" }); });
        }
      });
      if (disposed) { output(); return; }
      unlisteners.push(output);
      const close = await window.onCloseRequested((event) => {
        // Only intercept the first close: it triggers the dock handshake.
        // Once docking started (or the terminal never attached), let the
        // window close normally instead of trapping the user.
        if (attached && !closing) event.preventDefault();
        if (attached) dock.current();
      });
      if (disposed) { close(); return; }
      unlisteners.push(close);
      send({ type: "ready" });
    };
    void setup().catch((error) => { if (!disposed) { setError(String(error)); void window.show(); } });
    return () => { disposed = true; unlisteners.forEach((stop) => stop()); view.dispose(); };
  }, [id]);
  return <main className="detached-terminal">
    <header className="panel-header"><h2>Terminal</h2><button className="terminal-empty-action" onClick={() => dock.current()}>Dock terminal</button></header>
    {error && <p role="alert" className="dialog-error">{error}</p>}
    <div ref={container} className="terminal-content" aria-label="Detached terminal output" />
  </main>;
}
