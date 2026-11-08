import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalBackground } from "../src/terminalBackground.ts";

const theme = { background: "#090909", foreground: "#e5e5e5" };
const cell = (mode = "default", value = 0, inverse = false) => ({
  isInverse: () => Number(inverse),
  getBgColor: () => value, getFgColor: () => value,
  isBgRGB: () => mode === "rgb", isFgRGB: () => mode === "rgb",
  isBgPalette: () => mode === "palette", isFgPalette: () => mode === "palette",
});

test("terminal padding follows the common screen edge background and resets for the shell", () => {
  assert.equal(terminalBackground([cell("rgb", 0x181818), cell("rgb", 0x181818), cell("rgb", 0x303030), cell()], theme), "#181818");
  assert.equal(terminalBackground([cell(), cell(), cell(), cell()], theme), "#090909");
  assert.equal(terminalBackground([undefined], theme), "#090909");
});

test("terminal padding resolves ANSI colors, grayscale, true color, and inverse backgrounds", () => {
  assert.equal(terminalBackground([cell("palette", 234)], theme), "rgb(28, 28, 28)");
  assert.equal(terminalBackground([cell("palette", 67)], theme), "rgb(95, 135, 175)");
  assert.equal(terminalBackground([cell("palette", 1)], theme), "#cc0000");
  assert.equal(terminalBackground([cell("palette", 1)], { ...theme, red: "#123456" }), "#123456");
  assert.equal(terminalBackground([cell("default", 0, true)], theme), "#e5e5e5");
  assert.equal(terminalBackground([cell("rgb", 0x010203, true)], theme), "#010203");
});
