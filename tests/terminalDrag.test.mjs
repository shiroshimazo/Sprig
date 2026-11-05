import assert from "node:assert/strict";
import { test } from "node:test";
import { beyondDragThreshold, isOutsideWindow, outsideWindow, windowLocalPoint } from "../src/terminalDrag.ts";

test("terminal drag launches only when released outside window bounds", () => {
  assert.equal(outsideWindow(0, 0, 800, 600), false);
  assert.equal(outsideWindow(799, 599, 800, 600), false);
  for (const [x, y] of [[-1, 200], [800, 200], [200, -1], [200, 600]]) {
    assert.equal(outsideWindow(x, y, 800, 600), true);
  }
});

test("drag threshold ignores sub-threshold jitter", () => {
  assert.equal(beyondDragThreshold(0, 0), false);
  assert.equal(beyondDragThreshold(5, 0), false);
  assert.equal(beyondDragThreshold(-4, 5), true);
  assert.equal(beyondDragThreshold(6, 0), true);
});

test("screen coordinates convert to window-local points", () => {
  const bounds = { x: 1200, y: 300, width: 800, height: 600 };
  assert.deepEqual(windowLocalPoint(1200, 300, bounds), { x: 0, y: 0 });
  assert.deepEqual(windowLocalPoint(1900, 700, bounds), { x: 700, y: 400 });
  assert.equal(isOutsideWindow(1300, 400, bounds), false);
  assert.equal(isOutsideWindow(1199, 400, bounds), true);
  assert.equal(isOutsideWindow(2000, 400, bounds), true);
  const negativeOrigin = { x: -1600, y: -200, width: 1000, height: 800 };
  assert.equal(isOutsideWindow(-1500, 100, negativeOrigin), false);
  assert.equal(isOutsideWindow(-1700, 100, negativeOrigin), true);
});
