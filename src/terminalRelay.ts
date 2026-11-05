export type TerminalEvent = { type: "output"; data: number[] } | { type: "exit" } | { type: "error"; data: string };
export type ViewMessage =
  | { type: "ready" } | { type: "attached" } | { type: "dock" } | { type: "drained" }
  | { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };
export type OwnerMessage = TerminalEvent
  | { type: "snapshot"; text: string; cols: number; rows: number; viewport: number; exited: boolean }
  | { type: "drain" };

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
