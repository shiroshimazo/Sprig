import { StateEffect, StateField } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

const restoreText = StateEffect.define<string>();

export function preserveLineEndings(original: string) {
  const separator = original.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const rawText = StateField.define<string>({
    create: () => original,
    update(value, transaction) {
      const restored = [...transaction.effects].reverse().find((effect) => effect.is(restoreText));
      if (restored) return restored.value as string;
      if (!transaction.docChanged) return value;

      // CodeMirror counts every line ending as one character; disk text may use two.
      const extraOffsets: number[] = [];
      const endings = /\r\n|\r|\n/g;
      let match: RegExpExecArray | null;
      let extra = 0;
      while ((match = endings.exec(value))) {
        if (match[0] === "\r\n") {
          extraOffsets.push(match.index - extra);
          extra++;
        }
      }
      const rawOffset = (position: number) => {
        let low = 0;
        let high = extraOffsets.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (extraOffsets[middle] < position) low = middle + 1;
          else high = middle;
        }
        return position + low;
      };
      let result = "";
      let cursor = 0;
      transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
        result += value.slice(cursor, rawOffset(from)) + inserted.toString().replace(/\n/g, separator);
        cursor = rawOffset(to);
      });
      return result + value.slice(cursor);
    },
  });
  return {
    rawText,
    extensions: [
      rawText,
      invertedEffects.of((transaction) => transaction.docChanged
        ? [restoreText.of(transaction.startState.field(rawText))]
        : []),
    ],
  };
}
