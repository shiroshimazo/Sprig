import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { preserveLineEndings } from "./lineEndings";

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "js": case "mjs": case "cjs": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "ts": case "mts": case "cts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "java": return java();
    case "sql": return sql();
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
          languageFor(path),
          syntaxHighlighting(defaultHighlightStyle),
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
            "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--background)" },
            ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.5" },
            ".cm-content": { padding: "16px 0" },
            ".cm-line": { padding: "0 16px" },
            ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-muted)", borderRight: "1px solid var(--border)" },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px", minWidth: "3ch" },
            ".cm-matchingBracket": { backgroundColor: "#353535", outline: "1px solid #777" },
            ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--text)" },
            ".cm-textfield, .cm-button": { font: "inherit", color: "var(--text)", background: "var(--control)", border: "1px solid #555" },
            ".cm-searchMatch": { backgroundColor: "#49422c", outline: "1px solid #9b8954" },
            ".cm-searchMatch-selected": { backgroundColor: "#665734" },
            "&.cm-focused": { outline: "none" },
            ".cm-content:focus-visible": { outline: "2px solid var(--text)", outlineOffset: "-2px" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#404040" },
          }, { dark: true }),
        ],
      }),
    });
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
