import { useEffect, useRef } from "react";
import { EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";

export default function CodeEditor({ content, path }: { content: string; path: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: content,
        extensions: [
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
