import assert from "node:assert/strict";
import { test } from "node:test";
import { smoothScroll } from "../src/smoothScroll.ts";

test("smooth wheel scrolling accumulates, clamps, reverses and cleans up", () => {
  const motion = Object.assign(new EventTarget(), { matches: false });
  const frames = new Map();
  let id = 0;
  const originals = [globalThis.window, globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.window = { matchMedia: () => motion };
  globalThis.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = (key) => frames.delete(key);
  const element = Object.assign(new EventTarget(), {
    scrollTop: 0, scrollLeft: 0, scrollHeight: 2000, scrollWidth: 1000, clientHeight: 400, clientWidth: 500,
  });
  const wheel = (values = {}) => {
    const event = Object.assign(new Event("wheel", { cancelable: true }), {
      deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...values,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const finish = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(performance.now() + 150);
  };
  const cleanup = smoothScroll(element, 26);
  try {
    assert.equal(wheel(), true);
    assert.equal(element.scrollTop, 0);
    wheel();
    finish();
    assert.equal(element.scrollTop, 200);
    wheel({ deltaY: 3, deltaMode: 1 });
    finish();
    assert.equal(element.scrollTop, 278);
    wheel({ deltaY: 1, deltaMode: 2 });
    finish();
    assert.equal(element.scrollTop, 678);
    wheel({ shiftKey: true });
    finish();
    assert.equal(element.scrollLeft, 100);
    wheel({ deltaY: 99999 });
    finish();
    assert.equal(element.scrollTop, 1600);
    wheel({ deltaY: -200 });
    wheel({ deltaY: 100 });
    finish();
    assert.equal(element.scrollTop, 1600);
    assert.equal(wheel({ ctrlKey: true }), false);
    wheel({ deltaY: -200 });
    element.dispatchEvent(new Event("keydown"));
    assert.equal(frames.size, 0);
    wheel({ deltaY: -200 });
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    assert.equal(frames.size, 0);
    assert.equal(wheel(), false);
    motion.matches = false;
    wheel({ deltaY: -200 });
    cleanup();
    assert.equal(frames.size, 0);
    assert.equal(wheel(), false);
  } finally {
    cleanup();
    [globalThis.window, globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = originals;
  }
});
