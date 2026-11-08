import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { SerializeAddon } from "@xterm/addon-serialize";
import { createTerminalView } from "./terminalView";
import { DETACHED_LABEL, TerminalRelay } from "./terminalRelay";
import type { TerminalEvent, OwnerEnvelope, OwnerMessage, ViewMessage } from "./terminalRelay";
import type { TerminalIconId } from "./terminalIcons";

export type TerminalPanelHandle = { popOut: () => void };

export default function TerminalPanel({ cwd, name, onDetachedChange, onCloseRequested, onSessionReady, onIconChange, ref }: {
  cwd: string | null; name: string; onDetachedChange: (detached: boolean) => void; onCloseRequested?: () => void; onSessionReady: (id: string | undefined) => void; onIconChange: (icon: TerminalIconId) => void; ref?: Ref<TerminalPanelHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const popOut = useRef(() => {});
  const changed = useRef(onDetachedChange);
  changed.current = onDetachedChange;
  const closeRequested = useRef(onCloseRequested);
  closeRequested.current = onCloseRequested;
  const sessionReady = useRef(onSessionReady);
  sessionReady.current = onSessionReady;
  const iconChanged = useRef(onIconChange);
  iconChanged.current = onIconChange;
  useImperativeHandle(ref, () => ({ popOut: () => popOut.current() }), []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let connected = false;
    let exited = false;
    let opening = false;
    let docking = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const id = crypto.randomUUID();
    let writes = Promise.resolve();
    let messages = Promise.resolve();
    let resizing = false;
    let pendingSize: { cols: number; rows: number } | null = null;
    const sendInput = (data: string) => {
      if (connected) writes = writes.then(async () => {
        if (!disposed && connected) await invoke("terminal_write", { id, data });
      }).catch((error) => view.report(error));
    };
    const syncSize = async (cols: number, rows: number) => {
      pendingSize = { cols, rows };
      if (resizing || !connected || disposed) return;
      resizing = true;
      try {
        while (pendingSize && connected && !disposed) {
          const size = pendingSize; pendingSize = null;
          await invoke("terminal_resize", { id, ...size });
        }
      } catch (error) { if (!disposed && connected) view.report(error); }
      finally { resizing = false; }
    };
    const send = (message: OwnerMessage) => {
      messages = messages.then(async () => { if (!disposed) await emitTo(DETACHED_LABEL, "terminal-owner", { id, message } satisfies OwnerEnvelope); })
        .catch((error) => { if (!disposed) { view.report(error); dock(); } });
    };
    const view = createTerminalView(element, {
      input: (data) => { if (!relay.detached) sendInput(data); },
      resize: (cols, rows) => { void syncSize(cols, rows); },
      canFit: () => !relay.detached && !relay.paused,
      appChanged: (icon) => iconChanged.current(icon),
    });
    const { terminal } = view;
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    const relay = new TerminalRelay((event) => {
      if (disposed) return;
      if (event.type === "output") terminal.write(new Uint8Array(event.data));
      else if (event.type === "error") view.report(event.data);
      else {
        exited = true; connected = false; terminal.options.disableStdin = true;
        iconChanged.current("terminal");
        terminal.writeln("\r\nShell exited.");
      }
    }, send);
    const dock = () => {
      clearTimeout(timeout);
      if (disposed) return;
      opening = false; docking = false;
      relay.resume(false);
      terminal.options.disableStdin = !connected;
      changed.current(false);
      requestAnimationFrame(() => { if (!disposed) { view.fit(); terminal.focus(); } });
    };
    const unlisteners: (() => void)[] = [];
    const subscribe = async () => {
      const stop = await listen<ViewMessage>(`terminal-view-${id}`, ({ payload }) => {
        if (disposed) return;
        if (payload.type === "ready" && opening && !relay.paused && !relay.detached) {
          relay.pause();
          terminal.write("", () => {
            if (disposed || !opening) return;
            send({ type: "snapshot", text: serializer.serialize(), cols: terminal.cols, rows: terminal.rows, viewport: terminal.buffer.active.viewportY, exited });
          });
        } else if (payload.type === "ready" && relay.detached && !docking) {
          // The detached window lost its views (e.g. reload). Send a fresh
          // snapshot so scrollback is never blank.
          terminal.write("", () => {
            if (disposed || !relay.detached) return;
            send({ type: "snapshot", text: serializer.serialize(), cols: terminal.cols, rows: terminal.rows, viewport: terminal.buffer.active.viewportY, exited });
          });
        } else if (payload.type === "attached" && opening && relay.paused) {
          clearTimeout(timeout); opening = false;
          relay.resume(true);
          terminal.options.disableStdin = true;
          changed.current(true);
        } else if (payload.type === "input" && relay.detached) sendInput(payload.data);
        else if (payload.type === "resize" && relay.detached && !docking) {
          if (Number.isInteger(payload.cols) && Number.isInteger(payload.rows) && payload.cols > 0 && payload.rows > 0 && payload.cols <= 1000 && payload.rows <= 1000) terminal.resize(payload.cols, payload.rows);
        } else if (payload.type === "close" && relay.detached) {
          closeRequested.current?.();
        } else if (payload.type === "dock" && relay.detached && !docking) {
          docking = true; relay.pause(); send({ type: "drain" });
          timeout = setTimeout(dock, 5000);
        } else if (payload.type === "drained" && docking) dock();
      });
      if (disposed) stop(); else unlisteners.push(stop);
      const closed = await listen("terminal-window-closed", () => { if (relay.detached || opening) dock(); });
      if (disposed) closed(); else unlisteners.push(closed);
    };
    const listenersReady = isTauri() ? subscribe() : Promise.resolve();
    void listenersReady.catch(view.report);
    popOut.current = () => {
      if (!isTauri() || !connected || disposed || opening || relay.detached) return;
      opening = true;
      timeout = setTimeout(() => { view.report("Pop-out window did not connect. Terminal restored."); dock(); }, 15000);
      void listenersReady.then(() => invoke("terminal_popout", { id }))
        .catch((error) => { view.report(error); dock(); });
    };
    view.fit();
    if (isTauri()) {
      const output = new Channel<TerminalEvent>();
      output.onmessage = (event) => { if (!disposed) relay.receive(event); };
      void invoke("terminal_start", { id, cols: terminal.cols, rows: terminal.rows, output, cwd }).then(async () => {
        if (disposed) { await invoke("terminal_stop", { id }); return; }
        if (exited) return;
        connected = true; terminal.options.disableStdin = false;
        sessionReady.current(id);
        await syncSize(terminal.cols, terminal.rows);
      }).catch(view.report);
    } else terminal.writeln("Open the desktop app to start a local shell.");
    return () => {
      disposed = true; connected = false; clearTimeout(timeout);
      sessionReady.current(undefined);
      popOut.current = () => {};
      unlisteners.forEach((stop) => stop());
      if (isTauri()) {
        void invoke("terminal_stop", { id }).catch(() => {});
      }
      view.dispose();
    };
  }, [cwd, name]);
  return <div ref={container} className="terminal-content" aria-label="Terminal output" />;
}
