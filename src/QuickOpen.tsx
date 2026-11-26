import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { MultiplicationSignIcon } from "@hugeicons/core-free-icons";
import FileTypeIcon from "./FileTypeIcon";
import { quickOpenMatches, type WorkspaceFile } from "./quickOpenFiles";
import "./QuickOpen.css";

const VISIBLE_RESULTS = 100;

export default function QuickOpen({ folder, onSelect, onDismiss }: {
  folder: string;
  onSelect: (path: string) => void;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const activeOption = useRef<HTMLLIElement>(null);
  const request = useRef<Promise<WorkspaceFile[]> | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const matches = useMemo(() => files ? quickOpenMatches(files, query) : [], [files, query]);
  const results = matches.slice(0, VISIBLE_RESULTS);

  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    modal.showModal();
    return () => modal.close();
  }, []);

  useEffect(() => {
    let active = true;
    request.current ??= invoke<WorkspaceFile[]>("list_workspace_files", { path: folder });
    void request.current.then(
      (entries) => { if (active) setFiles(entries); },
      (reason: unknown) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [folder]);

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [matches, selected]);

  function dismiss() {
    dialog.current?.close();
    onDismiss();
  }

  function choose(path: string) {
    dismiss();
    onSelect(path);
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((index) => (index + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[selected].path);
    }
  }

  return (
    <dialog ref={dialog} className="quick-open" aria-labelledby="quick-open-label" onCancel={(event) => {
      event.preventDefault();
      dismiss();
    }}>
      <div className="quick-open-header">
        <label id="quick-open-label" htmlFor="quick-open-query">Quick Open</label>
        <input
          id="quick-open-query"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="quick-open-results"
          aria-expanded={results.length > 0}
          aria-activedescendant={results.length ? `quick-open-result-${selected}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by filename"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={navigate}
        />
        <button type="button" aria-label="Close Quick Open" title="Close (Esc)" onClick={dismiss}>
          <HugeiconsIcon icon={MultiplicationSignIcon} size={16} aria-hidden="true" focusable="false" />
        </button>
      </div>
      {error ? <p role="alert">Could not list workspace files. {error}</p>
        : files === null ? <p role="status">Loading files…</p>
        : !results.length && <p role="status">{files.length ? "No matching files." : "No files in this folder."}</p>}
      <ul id="quick-open-results" role="listbox" aria-label="Workspace files" hidden={!results.length}>
        {results.map((file, index) => (
          <li
            key={file.path}
            id={`quick-open-result-${index}`}
            ref={index === selected ? activeOption : undefined}
            role="option"
            aria-selected={index === selected}
            title={file.relativePath}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(file.path)}
          >
            <FileTypeIcon name={file.name} />
            <span>{file.name}</span>
            {file.relativePath !== file.name && <span className="quick-open-path">{file.relativePath}</span>}
          </li>
        ))}
      </ul>
      {matches.length > results.length && <p role="status">Showing {results.length} of {matches.length} matches. Keep typing to narrow results.</p>}
    </dialog>
  );
}
