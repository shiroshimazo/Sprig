import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";

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

export default function CodeEditor({ content, path }: { content: string; path: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          languageFor(path),
          syntaxHighlighting(defaultHighlightStyle),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          indentOnInput(),
          bracketMatching(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": `File contents: ${path}`,
            "aria-readonly": "true",
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
            "&.cm-focused": { outline: "none" },
            ".cm-content:focus-visible": { outline: "2px solid var(--text)", outlineOffset: "-2px" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#404040" },
          }, { dark: true }),
        ],
      }),
    });
    return () => view.destroy();
  }, [content, path]);

  return <div className="code-editor" ref={container} />;
}
