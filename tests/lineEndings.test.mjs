import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { preserveLineEndings } from "../src/lineEndings.ts";

for (const original of ["a\r\nb\r\n", "a\nb\n", "a\rb\r", "a\r\nb\nc\r", ""]) {
  test(`preserves endings in ${JSON.stringify(original)}`, () => {
    const endings = preserveLineEndings(original);
    let state = EditorState.create({ doc: original, extensions: [history(), endings.extensions] });
    const dispatch = (transaction) => { state = transaction.state; };
    for (let position = 0; position < 2; position++) {
      dispatch(state.update({ changes: { from: position, insert: "X" }, annotations: Transaction.userEvent.of("input.type") }));
    }
    assert.equal(state.field(endings.rawText), "XX" + original);
    undo({ state, dispatch });
    assert.equal(state.field(endings.rawText), original);
    redo({ state, dispatch });
    assert.equal(state.field(endings.rawText), "XX" + original);
    dispatch(state.update({ changes: { from: state.doc.length, insert: "\nend" } }));
    assert.equal(state.field(endings.rawText), "XX" + original + (original.match(/\r\n|\r|\n/)?.[0] ?? "\n") + "end");
  });
}

test("preserves untouched mixed endings around multiple replacements", () => {
  const endings = preserveLineEndings("a\r\nb\nc\rd");
  const state = EditorState.create({ doc: "a\r\nb\nc\rd", extensions: endings.extensions });
  const changed = state.update({ changes: [{ from: 2, to: 3, insert: "B" }, { from: 6, to: 7, insert: "D" }] }).state;
  assert.equal(changed.field(endings.rawText), "a\r\nB\nc\rD");
  const joined = changed.update({ changes: { from: 1, to: 2 } }).state;
  assert.equal(joined.field(endings.rawText), "aB\nc\rD");
});
