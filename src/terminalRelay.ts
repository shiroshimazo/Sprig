export const DETACHED_LABEL = "detached-terminals";
export const MAIN_LABEL = "main";

export type TerminalEvent = { type: "output"; data: number[] } | { type: "exit" } | { type: "error"; data: string };

// Messages the detached window sends to the main window, scoped by the
// `terminal-view-<id>` event name.
export type ViewMessage =
  | { type: "ready" } | { type: "attached" } | { type: "dock" } | { type: "drained" } | { type: "close" }
  | { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };

// Messages the main window sends to the detached window. Per-terminal
// payloads are wrapped in an envelope with the terminal id; window-level
// payloads travel on the "detached-window" event instead.
export type OwnerMessage = TerminalEvent
  | { type: "snapshot"; text: string; cols: number; rows: number; viewport: number; exited: boolean }
  | { type: "drain" };

export type OwnerEnvelope = { id: string; message: OwnerMessage };

export type DetachedTerminalInfo = { id: string; name: string; cwd: string | null };

// Window-level messages between the shared detached window and the main window.
export type DetachedWindowMessage =
  | { type: "ready" }
  | { type: "create"; sourceId: string }
  | { type: "roster"; terminals: DetachedTerminalInfo[]; canCreate: boolean };

// Pause delivery during handoff so the snapshot and live output never overlap.
export class TerminalRelay {
  detached = false;
  paused = false;
  private pending: TerminalEvent[] = [];
  private local: (event: TerminalEvent) => void;
  private remote: (event: TerminalEvent) => void;
  constructor(local: (event: TerminalEvent) => void, remote: (event: TerminalEvent) => void) {
    this.local = local; this.remote = remote;
  }
  receive(event: TerminalEvent) {
    if (this.paused) { this.pending.push(event); return; }
    this.local(event);
    if (this.detached) this.remote(event);
  }
  pause() { this.paused = true; }
  resume(detached: boolean) {
    this.detached = detached;
    this.paused = false;
    const pending = this.pending;
    this.pending = [];
    for (const event of pending) this.receive(event);
  }
}
