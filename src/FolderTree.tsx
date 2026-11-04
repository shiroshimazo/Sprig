import { useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, FolderOpenIcon } from "@hugeicons/core-free-icons";

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
};

type FolderTreeProps = {
  path: string;
  name?: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
};

export default function FolderTree({ path, name = path, activePath, onOpenFile }: FolderTreeProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const contentId = useId();

  async function load() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      setEntries(await invoke<FileEntry[]>("list_directory", { path }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  function toggle() {
    setExpanded(!expanded);
    if (!expanded && entries === null) void load();
  }

  return (
    <div className="folder-node">
      <button className="folder-toggle" title={path} aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
        <span className="folder-arrow" aria-hidden="true">{expanded ? "−" : "+"}</span>
        <HugeiconsIcon icon={FolderOpenIcon} size={15} aria-hidden="true" focusable="false" />
        <span className="entry-name">{name}</span>
      </button>
      <div id={contentId} hidden={!expanded} className="folder-contents">
        {loading && <p className="folder-message" role="status">Loading folder...</p>}
        {error && <div className="folder-message"><p role="alert">{error}</p><button className="folder-retry" onClick={() => void load()}>Retry</button></div>}
        {entries?.length === 0 && <p className="folder-message">Empty folder.</p>}
        {entries && entries.length > 0 && (
          <ul className="folder-list">
            {entries.map((entry) => (
              <li key={entry.path}>
                {entry.isDirectory && !entry.isSymlink ? (
                  <FolderTree path={entry.path} name={entry.name} activePath={activePath} onOpenFile={onOpenFile} />
                ) : (
                  <button className="file-entry" title={entry.path} aria-current={activePath === entry.path ? "true" : undefined} onClick={() => onOpenFile(entry.path)}>
                    <HugeiconsIcon icon={File01Icon} size={15} aria-hidden="true" focusable="false" />
                    <span className="entry-name">{entry.name}{entry.isSymlink ? " (link)" : ""}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
