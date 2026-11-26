import assert from "node:assert/strict";
import { test } from "node:test";
import xterm from "@xterm/xterm";
import { createTerminalSnapshot } from "../src/terminalSnapshot.ts";

const { Terminal } = xterm;
const write = (terminal, data) => new Promise((resolve) => terminal.write(data, resolve));

test("terminal snapshots preserve Codex mouse reporting and restore encoding changes", async (t) => {
  const owner = new Terminal();
  const serialize = createTerminalSnapshot(owner);
  t.after(() => owner.dispose());

  await write(owner, "\x1b[?1049h\x1b[?1003;1006h");
  for (const [change, tracking, sgr, pixels] of [
    ["", "any", 1, 2],
    ["\x1b[?1016h", "any", 2, 1],
    ["\x1b[?1016l", "any", 2, 2],
    ["\x1b[?1006h\x1bc", "none", 2, 2],
  ]) {
    await write(owner, change);
    const detached = new Terminal();
    t.after(() => detached.dispose());
    const reports = [];
    detached.onData((data) => reports.push(data));
    await write(detached, serialize());
    await write(detached, "\x1b[?1006$p\x1b[?1016$p");

    assert.equal(detached.modes.mouseTrackingMode, tracking);
    assert.deepEqual(reports, [`\x1b[?1006;${sgr}$y`, `\x1b[?1016;${pixels}$y`]);
  }
});
