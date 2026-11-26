import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, ViewPlugin } from "@codemirror/view";
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
import { editorColors } from "./editorColors";

const smoothCaret = ViewPlugin.define((view) => {
  const caret = createSmoothCaret(view.scrollDOM, () => {
    if (!view.state.selection.main.empty || view.state.selection.ranges.length > 1 || view.compositionStarted) return null;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    return rect && { left: rect.left, top: rect.top, height: rect.bottom - rect.top, color: "#f8f8f0" };
  });
  return { update: caret.update, destroy: caret.dispose };
});

const highlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: editorColors.magenta },
  { tag: tags.operator, color: editorColors.blue },
  { tag: [tags.name, tags.variableName, tags.propertyName, tags.macroName], color: editorColors.red },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.labelName], color: editorColors.blue },
  { tag: tags.definition(tags.name), color: editorColors.foreground },
  { tag: [tags.constant(tags.name), tags.character], color: "#d19a66" },
  { tag: tags.standard(tags.name), color: editorColors.yellow },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.annotation], color: editorColors.yellow },
  { tag: tags.modifier, color: editorColors.magenta },
  { tag: tags.self, color: editorColors.magenta },
  { tag: tags.special(tags.variableName), color: "#d19a66" },
  { tag: [tags.number, tags.atom, tags.bool, tags.null, tags.literal, tags.unit], color: "#d19a66" },
  { tag: tags.color, color: editorColors.cyan },
  { tag: tags.constant(tags.className), color: editorColors.yellow },
  { tag: [tags.string, tags.processingInstruction], color: editorColors.green },
  { tag: [tags.escape, tags.regexp, tags.special(tags.string)], color: editorColors.cyan },
  { tag: [tags.comment, tags.docComment, tags.meta], color: "#5c6370", fontStyle: "italic" },
  { tag: tags.link, color: editorColors.magenta, textDecoration: "underline" },
  { tag: tags.url, color: editorColors.magenta },
  { tag: tags.heading, color: editorColors.red, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, background: editorColors.magenta, color: "#f8f8f0" },
  { tag: tags.inserted, color: editorColors.yellow },
  { tag: tags.changed, color: editorColors.green },
  { tag: tags.deleted, color: editorColors.magenta },
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

export default function CodeEditor({ content, path, onChange, onPositionChange, invalidated }: { content: string; path: string; onChange: (content: string) => void; onPositionChange: (position: { line: number; column: number }) => void; invalidated: { paths: string[] } | null }) {
  const container = useRef<HTMLDivElement>(null);
  const lastInvalidation = useRef(invalidated);
  const sessions = useRef(new Map<string, { state: EditorState; top: number; left: number }>());

  useEffect(() => {
    if (!container.current) return;
    if (invalidated && invalidated !== lastInvalidation.current) {
      for (const file of invalidated.paths) sessions.current.delete(file);
    }
    lastInvalidation.current = invalidated;
    const cached = sessions.current.get(path);
    const lineEndings = preserveLineEndings(content);
    const view = new EditorView({
      parent: container.current,
      state: cached?.state ?? EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
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
            "&": { height: "100%", fontSize: "13px", color: editorColors.foreground, backgroundColor: "var(--background)" },
            ".cm-scroller": { overflow: "auto", fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontVariantLigatures: "contextual", lineHeight: "2" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: editorColors.cursor },
            ".cm-activeLine": { backgroundColor: "#383e4a" },
            ".cm-activeLineGutter": { backgroundColor: "#383e4a", color: editorColors.foreground },
            ".cm-content": { padding: "16px 0", caretColor: editorColors.cursor },
            ".cm-line": { padding: "0 16px" },
            ".cm-gutters": { backgroundColor: "var(--background)", color: "#495162", borderRight: "none" },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px", minWidth: "3ch" },
            ".cm-matchingBracket": { backgroundColor: "#3e4451", outline: "1px solid #4b5263" },
            ".cm-panels": { backgroundColor: "#21252b", color: editorColors.foreground, borderBottom: "1px solid #181a1f" },
            ".cm-textfield, .cm-button": { font: "inherit", color: editorColors.foreground, background: "#1d1f23", border: "1px solid #181a1f" },
            ".cm-button": { background: "#2c313a" },
            ".cm-searchMatch": { backgroundColor: "#314365" },
            ".cm-searchMatch-selected": { backgroundColor: "#42557b", outline: "1px solid #42557b" },
            ".cm-selectionMatch": { backgroundColor: "#abb2bf14" },
            ".cm-tooltip": { backgroundColor: "#21252b", border: "1px solid #181a1f", color: editorColors.foreground },
            "&.cm-focused": { outline: "none" },
            ".cm-content:focus-visible": { outline: "none" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: editorColors.selection },
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
  }, [content, path, onChange, onPositionChange, invalidated]);

  return <div className="code-editor" ref={container} />;
}
