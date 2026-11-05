import assert from "node:assert/strict";
import { test } from "node:test";
import { handleShiftEnter } from "../src/terminalKeys.ts";

test("Shift+Enter sends one modified Enter sequence and suppresses native Enter", () => {
  const sent = [];
  for (const type of ["keydown", "keypress", "keyup"]) {
    const event = Object.assign(new Event(type, { cancelable: true }), { key: "Enter", shiftKey: true });
    assert.equal(handleShiftEnter(event, (data) => sent.push(data)), false);
    assert.equal(event.defaultPrevented, true);
  }
  assert.deepEqual(sent, ["\u001b[13;2u"]);
});

test("plain Enter, other modifiers, composition and other keys keep native handling", () => {
  for (const changes of [{ shiftKey: false }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { key: "a" }]) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter", shiftKey: true }, changes);
    assert.equal(handleShiftEnter(event, () => assert.fail("Unexpected terminal input")), true);
    assert.equal(event.defaultPrevented, false);
  }
});
