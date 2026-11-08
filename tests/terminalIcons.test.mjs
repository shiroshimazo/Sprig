import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isTerminalIcon } from "../src/terminalIcons.ts";

test("terminal app markers accept supported choices and reject arbitrary values", () => {
  for (const icon of ["terminal", "codex", "claude-code", "antigravity", "opencode"]) {
    assert.equal(isTerminalIcon(icon), true);
  }
  for (const icon of [undefined, null, "", "unknown", "__proto__", "https://example.com/icon.svg", {}, 0]) {
    assert.equal(isTerminalIcon(icon), false);
  }
});

test("PowerShell detects executed commands without matching ordinary output or arguments", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File",
    fileURLToPath(new URL("./terminalApps.test.ps1", import.meta.url)),
  ], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
