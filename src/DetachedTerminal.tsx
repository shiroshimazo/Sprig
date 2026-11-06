import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDownLeftIcon, CommandLineIcon, MultiplicationSignIcon } from "@hugeicons/core-free-icons";
import { createTerminalView } from "./terminalView";
import { MAIN_LABEL } from "./terminalRelay";
import type { DetachedWindowMessage, DetachedTerminalInfo, OwnerEnvelope, ViewMessage } from "./terminalRelay";
import WindowControls from "./WindowControls";

// One PTY-backed xterm view per hosted terminal. The shell never kills a
// session on its own — closing the window docks everything back through the
// owner in the main window.
function HostedTerminal({ id, active, onError }: {
  id: string;
  active: boolean;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ReturnType<typeof createTerminalView> | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let attached = false;
    let closing = false;
    let exited = false;
    let messages = Promise.resolve();
    const send = (message: ViewMessage) => {
      messages = messages.then(async () => { if (!disposed) await emitTo(MAIN_LABEL, `terminal-view-${id}`, message); })
        .catch((error: unknown) => { if (!disposed) onError(String(error)); });
    };
    const view = createTerminalView(element, {
      input: (data) => { if (attached && !exited) send({ type: "input", data }); },
      resize: (cols, rows) => { if (attached && !closing) send({ type: "resize", cols, rows }); },
      canFit: () => attached && !closing,
    });
    viewRef.current = view;
    const { terminal } = view;
    const unlisteners: (() => void)[] = [];
    const setup = async () => {
      const output = await listen<OwnerEnvelope>("terminal-owner", ({ payload }) => {
        if (disposed || !payload || payload.id !== id) return;
        const message = payload.message;
        if (message.type === "snapshot" && !attached) {
          terminal.resize(message.cols, message.rows);
          terminal.write(message.text, () => {
            if (disposed) return;
            attached = true; exited = message.exited;
            terminal.options.disableStdin = exited;
            terminal.scrollToLine(message.viewport);
            send({ type: "attached" });
            if (isTauri()) {
              void getCurrentWindow().show()
                .then(() => { if (!disposed) { view.fit(); terminal.focus(); } })
                .catch((error: unknown) => { if (!disposed) onError(String(error)); });
            }
          });
        } else if (message.type === "output") terminal.write(new Uint8Array(message.data));
        else if (message.type === "error") view.report(message.data);
        else if (message.type === "exit") {
          exited = true; terminal.options.disableStdin = true; terminal.writeln("\r\nShell exited.");
        } else if (message.type === "drain") {
          terminal.write("", () => { if (!disposed) send({ type: "drained" }); });
        }
      });
      if (disposed) { output(); return; }
      unlisteners.push(output);
      const close = await getCurrentWindow().onCloseRequested((event) => {
        // Intercept the first close and dock: never kill a live session.
        if (attached && !closing) {
          closing = true;
          terminal.options.disableStdin = true;
          event.preventDefault();
          send({ type: "dock" });
        }
      });
      if (disposed) { close(); return; }
      unlisteners.push(close);
      send({ type: "ready" });
    };
    void setup().catch((error: unknown) => {
      if (!disposed) { onError(String(error)); if (isTauri()) void getCurrentWindow().show().catch(() => {}); }
    });
    return () => {
      disposed = true;
      unlisteners.forEach((stop) => stop());
      viewRef.current = null;
      view.dispose();
    };
  }, [id, onError]);

  // Refit and focus when this terminal becomes the visible tab.
  useEffect(() => {
    if (!active) return;
    const view = viewRef.current;
    if (view) { view.fit(); view.terminal.focus(); }
  }, [active]);

  return (
    <div
      ref={container}
      className="terminal-content detached-pane"
      role="tabpanel"
      id={`detached-pane-${id}`}
      aria-labelledby={`detached-tab-${id}`}
      hidden={!active}
      aria-label="Detached terminal output"
    />
  );
}

export default function DetachedTerminal() {
  const [tabs, setTabs] = useState<DetachedTerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const everNonEmpty = useRef(false);
  const tabsRef = useRef<DetachedTerminalInfo[]>([]);
  tabsRef.current = tabs;
  const reportError = useCallback((message: string) => setError(message), []);

  const sendView = useCallback((id: string, message: ViewMessage) => {
    void emitTo(MAIN_LABEL, `terminal-view-${id}`, message).catch((error: unknown) => setError(String(error)));
  }, []);
  const dockTab = useCallback((id: string) => sendView(id, { type: "dock" }), [sendView]);
  const closeTab = useCallback((id: string) => sendView(id, { type: "close" }), [sendView]);

  // The main window owns the terminal list; this window just mirrors it.
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const stopListen = await listen<DetachedWindowMessage>("detached-window", ({ payload }) => {
        if (disposed || payload.type !== "roster") return;
        const list = payload.terminals;
        if (list.length > 0) everNonEmpty.current = true;
        tabsRef.current = list;
        setTabs(list);
        setActiveId((current) => (current && list.some((tab) => tab.id === current) ? current : list[0]?.id ?? null));
      });
      if (disposed) { stopListen(); return; }
      stop = stopListen;
      void emitTo(MAIN_LABEL, "detached-window", { type: "ready" } satisfies DetachedWindowMessage)
        .catch((error: unknown) => { if (!disposed) setError(String(error)); });
    })().catch((error: unknown) => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; stop?.(); };
  }, []);

  // Once the window had terminals and lost them all (or the last one docked),
  // close the empty window instead of lingering.
  useEffect(() => {
    if (tabs.length === 0 && everNonEmpty.current && isTauri()) {
      void getCurrentWindow().close().catch((error: unknown) => setError(String(error)));
    }
  }, [tabs.length]);

  const focusTab = (id: string) => document.getElementById(`detached-tab-${id}`)?.focus();
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: DetachedTerminalInfo) => {
    const list = tabsRef.current;
    const index = list.findIndex((item) => item.id === tab.id);
    let target: DetachedTerminalInfo | undefined;
    if (event.key === "ArrowRight") target = list[(index + 1) % list.length];
    else if (event.key === "ArrowLeft") target = list[(index - 1 + list.length) % list.length];
    else if (event.key === "Home") target = list[0];
    else if (event.key === "End") target = list[list.length - 1];
    if (target) {
      event.preventDefault();
      setActiveId(target.id);
      focusTab(target.id);
    }
  };

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const headerName = activeTab?.name ?? "Terminals";

  return (
    <main className="detached-terminal" aria-label="Detached terminals">
      <header className="toolbar detached-toolbar">
        <WindowControls />
        <div
          className="toolbar-spacer"
          data-tauri-drag-region
          aria-hidden="true"
          onDoubleClick={() => { if (isTauri()) void getCurrentWindow().toggleMaximize().catch(() => {}); }}
        />
        <span className="detached-terminal-name" title={headerName}>{headerName}</span>
      </header>
      <h2 className="sr-only">Detached terminals</h2>
      {error && <p role="alert" className="dialog-error">{error}</p>}
      {tabs.length > 0 && (
        <div className="detached-tabs" role="tablist" aria-label="Detached terminals">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div key={tab.id} className={`terminal-tab${active ? " terminal-tab--active" : ""}`}>
                <button
                  role="tab"
                  id={`detached-tab-${tab.id}`}
                  aria-selected={active}
                  aria-controls={`detached-pane-${tab.id}`}
                  tabIndex={active ? 0 : -1}
                  className="detached-tab-select"
                  title={tab.cwd ?? tab.name}
                  onClick={() => setActiveId(tab.id)}
                  onKeyDown={(event) => onTabKeyDown(event, tab)}
                >
                  {tab.name}
                </button>
                <button className="terminal-tab-add detached-tab-action" aria-label={`Dock ${tab.name} back to the main window`} title="Dock back to main window" onClick={() => dockTab(tab.id)}>
                  <HugeiconsIcon icon={ArrowDownLeftIcon} size={13} aria-hidden="true" focusable="false" />
                </button>
                <button className="terminal-tab-add detached-tab-action" aria-label={`Close ${tab.name}`} title={`Close ${tab.name}`} onClick={() => closeTab(tab.id)}>
                  <HugeiconsIcon icon={MultiplicationSignIcon} size={13} aria-hidden="true" focusable="false" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="detached-panes">
        {tabs.map((tab) => (
          <HostedTerminal key={tab.id} id={tab.id} active={tab.id === activeId} onError={reportError} />
        ))}
      </div>
      {tabs.length === 0 && (
        <div className="detached-empty">
          <HugeiconsIcon icon={CommandLineIcon} size={20} aria-hidden="true" focusable="false" />
          <p>No terminals here yet.</p>
          <p>Use the ↗ button on a terminal tab in the main window to move it into this window.</p>
        </div>
      )}
    </main>
  );
}
