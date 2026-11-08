import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap, lineNumbers, ViewPlugin } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { css } from "@codemirror/lang-css";
import { preserveLineEndings } from "./lineEndings";
import { smoothScroll } from "./smoothScroll";
import { createSmoothCaret } from "./smoothCaret";

const smoothCaret = ViewPlugin.define((view) => {
  const caret = createSmoothCaret(view.scrollDOM, () => {
    if (!view.state.selection.main.empty || view.state.selection.ranges.length > 1 || view.compositionStarted) return null;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    return rect && { left: rect.left, top: rect.top, height: rect.bottom - rect.top, color: "#f8f8f0" };
  });
  return { update: caret.update, destroy: caret.dispose };
});

// One Dark Theme by Joshua Azemoh — applied to the code editor only.
// Source: https://github.com/azemoh/vscode-onedark (themes/OneDarkTheme-color-theme.json)
const highlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: "#c678dd" },
  { tag: tags.operator, color: "#61afef" },
  { tag: [tags.name, tags.variableName, tags.propertyName, tags.macroName], color: "#e06c75" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.labelName], color: "#61afef" },
  { tag: tags.definition(tags.name), color: "#abb2bf" },
  { tag: [tags.constant(tags.name), tags.character], color: "#d19a66" },
  { tag: tags.standard(tags.name), color: "#e5c07b" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.annotation], color: "#e5c07b" },
  { tag: tags.modifier, color: "#c678dd" },
  { tag: tags.self, color: "#c678dd" },
  { tag: tags.special(tags.variableName), color: "#d19a66" },
  { tag: [tags.number, tags.atom, tags.bool, tags.null, tags.literal, tags.unit], color: "#d19a66" },
  { tag: tags.color, color: "#56b6c2" },
  { tag: tags.constant(tags.className), color: "#e5c07b" },
  { tag: [tags.string, tags.processingInstruction], color: "#98c379" },
  { tag: [tags.escape, tags.regexp, tags.special(tags.string)], color: "#56b6c2" },
  { tag: [tags.comment, tags.docComment, tags.meta], color: "#5c6370", fontStyle: "italic" },
  { tag: tags.link, color: "#c678dd", textDecoration: "underline" },
  { tag: tags.url, color: "#c678dd" },
  { tag: tags.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, background: "#c678dd", color: "#f8f8f0" },
  { tag: tags.inserted, color: "#e5c07b" },
  { tag: tags.changed, color: "#98c379" },
  { tag: tags.deleted, color: "#c678dd" },
]);

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "js": case "mjs": case "cjs": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "ts": case "mts": case "cts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "java": return java();
    case "sql": return sql();
    case "css": return css();
    default: return [];
  }
}

export default function CodeEditor({ content, path, onChange, onPositionChange, discarded }: { content: string; path: string; onChange: (content: string) => void; onPositionChange: (position: { line: number; column: number }) => void; discarded: { path: string } | null }) {
  const container = useRef<HTMLDivElement>(null);
  const lastDiscard = useRef(discarded);
  const sessions = useRef(new Map<string, { state: EditorState; top: number; left: number }>());

  useEffect(() => {
    if (!container.current) return;
    if (discarded && discarded !== lastDiscard.current) sessions.current.delete(discarded.path);
    lastDiscard.current = discarded;
    const cached = sessions.current.get(path);
    const lineEndings = preserveLineEndings(content);
    const view = new EditorView({
      parent: container.current,
      state: cached?.state ?? EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          smoothCaret,
          languageFor(path),
          syntaxHighlighting(highlighting),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          indentOnInput(),
          bracketMatching(),
          history(),
          lineEndings.extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.field(lineEndings.rawText));
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              onPositionChange({ line: line.number, column: head - line.from + 1 });
            }
          }),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.contentAttributes.of({
            "aria-label": `File contents: ${path}`,
            tabindex: "0",
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px", color: "#abb2bf", backgroundColor: "#090909" },
            ".cm-scroller": { overflow: "auto", fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontVariantLigatures: "contextual", lineHeight: "2" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f8f8f0" },
            ".cm-activeLine": { backgroundColor: "#383e4a" },
            ".cm-activeLineGutter": { backgroundColor: "#383e4a", color: "#abb2bf" },
            ".cm-content": { padding: "16px 0", caretColor: "#f8f8f0" },
            ".cm-line": { padding: "0 16px" },
            ".cm-gutters": { backgroundColor: "#090909", color: "#495162", borderRight: "none" },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px", minWidth: "3ch" },
            ".cm-matchingBracket": { backgroundColor: "#3e4451", outline: "1px solid #4b5263" },
            ".cm-panels": { backgroundColor: "#21252b", color: "#abb2bf", borderBottom: "1px solid #181a1f" },
            ".cm-textfield, .cm-button": { font: "inherit", color: "#abb2bf", background: "#1d1f23", border: "1px solid #181a1f" },
            ".cm-button": { background: "#2c313a" },
            ".cm-searchMatch": { backgroundColor: "#314365" },
            ".cm-searchMatch-selected": { backgroundColor: "#42557b", outline: "1px solid #42557b" },
            ".cm-selectionMatch": { backgroundColor: "#abb2bf14" },
            ".cm-tooltip": { backgroundColor: "#21252b", border: "1px solid #181a1f", color: "#abb2bf" },
            "&.cm-focused": { outline: "none" },
            ".cm-content:focus-visible": { outline: "none" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#3e4451" },
          }, { dark: true }),
        ],
      }),
    });
    const stopSmoothScroll = smoothScroll(view.scrollDOM, view.defaultLineHeight);
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    onPositionChange({ line: line.number, column: head - line.from + 1 });
    if (cached) {
      view.requestMeasure({
        read: () => null,
        write: () => {
          view.scrollDOM.scrollTop = cached.top;
          view.scrollDOM.scrollLeft = cached.left;
        },
      });
    }
    return () => {
      stopSmoothScroll();
      sessions.current.set(path, {
        state: view.state,
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      });
      view.destroy();
    };
  }, [content, path, onChange, onPositionChange, discarded]);

  return <div className="code-editor" ref={container} />;
}
