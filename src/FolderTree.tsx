import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileTree, FileTreeFile, FileTreeFolder } from "./components/motion/file-tree";
import { isInsideFolder } from "./filePaths";

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
};

type CacheEntry = {
  entries?: FileEntry[];
  error?: string;
  loading: boolean;
};

type FolderTreeProps = {
  path: string;
  name?: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  creation: { kind: "file" | "folder" } | null;
  onCreationDone: () => void;
  changedPaths?: string[];
  refreshToken?: number;
  onFilesChanged?: () => void;
};

type FsChangedPayload = { paths?: string[] };

const RETRY_SUFFIX = "::retry";
const LOADING_SUFFIX = "::loading";
const EMPTY_SUFFIX = "::empty";
// Disk changes arrive in bursts (a copy, a checkout, a build), so the tree
// waits for the burst to settle before it re-reads the folders.
const RELOAD_DEBOUNCE_MS = 120;

export default function FolderTree({ path, name = path, activePath, onOpenFile, creation, onCreationDone, changedPaths = [], refreshToken, onFilesChanged }: FolderTreeProps) {
  const cache = useRef(new Map<string, CacheEntry>());
  const pending = useRef(new Set<string>());
  const reload = useRef(new Set<string>());
  const lastCreation = useRef<typeof creation>(null);
  const selectedFolder = useRef(path);
  // The workspace root bounds the watcher, so it is also the fallback
  // boundary when a changed path matches no loaded folder.
  const rootPath = useRef(path);
  rootPath.current = path;
  // The parent may hand over a new callback on every render, so the disk
  // listener reads it from a ref instead of resubscribing.
  const filesChanged = useRef(onFilesChanged);
  filesChanged.current = onFilesChanged;
  // Folders that have to be re-read once the current burst of disk changes
  // settles, and the timer of that burst.
  const queued = useRef(new Set<string>());
  const debounce = useRef<number | null>(null);
  const [draft, setDraft] = useState<{ parent: string; kind: "file" | "folder" } | null>(null);
  const [entryName, setEntryName] = useState("");
  const [creationError, setCreationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((version) => version + 1), []);

  // A file is marked when it has changes that are not committed yet. A folder
  // is marked when it holds a file with such changes.
  const changed = useMemo(() => new Set(changedPaths), [changedPaths]);
  const isChanged = useCallback((target: string) => {
    if (!changed.size) return false;
    if (changed.has(target)) return true;
    for (const entry of changed) {
      if (entry.startsWith(`${target}\\`) || entry.startsWith(`${target}/`)) return true;
    }
    return false;
  }, [changed]);

  const load = useCallback(async (folder: string): Promise<void> => {
    if (pending.current.has(folder)) return;
    pending.current.add(folder);
    const previous = cache.current.get(folder);
    cache.current.set(folder, { entries: previous?.entries, loading: true, error: undefined });
    bump();
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path: folder });
      cache.current.set(folder, { entries, loading: false });
    } catch (cause) {
      cache.current.set(folder, {
        error: cause instanceof Error ? cause.message : String(cause),
        loading: false,
      });
    } finally {
      pending.current.delete(folder);
      bump();
      if (reload.current.delete(folder)) void load(folder);
    }
  }, [bump]);

  // Re-reads a folder. When a load is already running the folder goes into
  // the reload set, so it is listed again once the running load finishes.
  const reloadFolder = useCallback((folder: string) => {
    if (pending.current.has(folder)) {
      reload.current.add(folder);
      return;
    }
    void load(folder);
  }, [load]);

  // A burst of disk changes collapses into a single pass over the folders.
  const flush = useCallback(() => {
    debounce.current = null;
    const folders = [...queued.current];
    queued.current.clear();
    for (const folder of folders) reloadFolder(folder);
    filesChanged.current?.();
  }, [reloadFolder]);

  const queueReload = useCallback((folders: Iterable<string>) => {
    for (const folder of folders) queued.current.add(folder);
    if (debounce.current !== null) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(flush, RELOAD_DEBOUNCE_MS);
  }, [flush]);

  // Works out which of the already loaded folders a disk change touches and
  // queues them for a re-read.
  const handleDiskChange = useCallback((changed: string[]) => {
    if (!changed.length) return;
    const loaded = [...cache.current.keys()];
    const affected = new Set<string>();
    let reloadAll = false;
    for (const target of changed) {
      let matched = false;
      for (const folder of loaded) {
        if (isInsideFolder(folder, target)) {
          affected.add(folder);
          matched = true;
        }
      }
      // A change under the workspace root that matches no loaded folder means
      // the reported path is spelled differently than the cached keys. Every
      // loaded folder is re-read then, so a path format mismatch can never
      // make the tree miss an update.
      if (!matched && isInsideFolder(rootPath.current, target)) reloadAll = true;
    }
    if (reloadAll) for (const folder of loaded) affected.add(folder);
    queueReload(affected);
  }, [queueReload]);

  // Watch the workspace so changes on disk reach the tree. A watcher that
  // fails must never break the tree, so its errors are ignored.
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("watch_folder", { path }).catch(() => {});
    return () => { void invoke("unwatch_folder", { path }).catch(() => {}); };
  }, [path]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<FsChangedPayload>("fs-changed", ({ payload }) => {
      handleDiskChange(payload?.paths ?? []);
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, [handleDiskChange]);

  // A pending reload must not fire after the tree is gone.
  useEffect(() => () => {
    if (debounce.current !== null) window.clearTimeout(debounce.current);
  }, []);

  // The manual refresh only re-reads the folders that are already loaded, so
  // the tree keeps its expansion, its selection and its open file.
  useEffect(() => {
    if (!refreshToken) return;
    for (const folder of cache.current.keys()) reloadFolder(folder);
  }, [refreshToken, reloadFolder]);

  useEffect(() => {
    if (!creation || creation === lastCreation.current || creatingRef.current) return;
    lastCreation.current = creation;
    const parent = selectedFolder.current;
    setDraft({ parent, kind: creation.kind });
    setEntryName("");
    setCreationError(null);
    setExpandedIds((ids) => ids.includes(parent) ? ids : [...ids, parent]);
    if (!cache.current.has(parent)) void load(parent);
  }, [creation, load]);

  useEffect(() => { if (draft && !creating) input.current?.focus(); }, [draft, creating]);

  async function submitCreation() {
    if (!draft || creatingRef.current) return;
    if (!entryName.trim()) { setCreationError("Enter a name."); return; }
    creatingRef.current = true;
    setCreating(true);
    setCreationError(null);
    try {
      const created = await invoke<string>(draft.kind === "file" ? "create_file" : "create_folder", { parent: draft.parent, name: entryName });
      if (pending.current.has(draft.parent)) reload.current.add(draft.parent);
      else await load(draft.parent);
      setDraft(null);
      onCreationDone();
      if (draft.kind === "file") onOpenFile(created);
    } catch (error) { setCreationError(error instanceof Error ? error.message : String(error)); }
    finally { creatingRef.current = false; setCreating(false); }
  }

  const handleExpand = useCallback((next: string[]) => {
    const open = new Set(expandedIds);
    for (const id of next) {
      if (!open.has(id)) {
        const cached = cache.current.get(id);
        if (!cached || cached.error) void load(id);
      }
    }
    setExpandedIds(next);
  }, [expandedIds, load]);

  const handleValueChange = useCallback((value: string) => {
    if (value === path) { selectedFolder.current = path; return; }
    if (value.endsWith(RETRY_SUFFIX)) {
      void load(value.slice(0, -RETRY_SUFFIX.length));
      return;
    }
    if (value.endsWith(LOADING_SUFFIX) || value.endsWith(EMPTY_SUFFIX)) return;
    // Folders are toggled by the tree itself; only open files here.
    for (const cached of cache.current.values()) {
      const hit = cached.entries?.find((entry) => entry.path === value);
      if (hit) {
        selectedFolder.current = hit.isDirectory && !hit.isSymlink ? hit.path : value.slice(0, Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")));
        if (!(hit.isDirectory && !hit.isSymlink)) onOpenFile(value);
        return;
      }
    }
  }, [load, onOpenFile, path]);

  const renderEntry = (entry: FileEntry): ReactNode => {
    if (entry.isDirectory && !entry.isSymlink) {
      return renderFolder(entry.path, entry.name);
    }
    const changedEntry = isChanged(entry.path);
    return (
      <FileTreeFile
        key={entry.path}
        value={entry.path}
        name={entry.name + (entry.isSymlink ? " (link)" : "")}
        title={changedEntry ? `${entry.path} — not committed yet` : entry.path}
        className={changedEntry ? "file-tree-row--changed" : undefined}
      />
    );
  };

  const renderFolder = (folderPath: string, folderName: string, isRoot = false): ReactNode => {
    const cached = cache.current.get(folderPath);
    let children: ReactNode;
    if (cached?.entries) {
      // A folder that is re-read keeps its entries on screen, so the tree
      // never flickers back to the loading placeholder.
      children = cached.entries.length === 0
        ? <FileTreeFile value={`${folderPath}${EMPTY_SUFFIX}`} name="Empty folder." disabled />
        : cached.entries.map(renderEntry);
    } else if (cached?.error) {
      children = (
        <FileTreeFile
          value={`${folderPath}${RETRY_SUFFIX}`}
          name="Couldn't load folder — select to retry"
          title={cached.error}
        />
      );
    } else {
      children = (
        <FileTreeFile value={`${folderPath}${LOADING_SUFFIX}`} name="Loading folder..." disabled />
      );
    }
    const changedFolder = !isRoot && isChanged(folderPath);
    return (
      <FileTreeFolder key={folderPath} value={folderPath} name={folderName} title={changedFolder ? `${folderPath} — not committed yet` : folderPath} className={changedFolder ? "file-tree-row--changed" : undefined}>
        {draft?.parent === folderPath && <FileTreeFile value={`${folderPath}::create`} name={`New ${draft.kind}`} content={
          <form className="inline-create" onSubmit={(event) => { event.preventDefault(); void submitCreation(); }} onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" && !creatingRef.current) { event.preventDefault(); setDraft(null); onCreationDone(); }
          }}>
            <input ref={input} aria-label={`New ${draft.kind} name`} aria-invalid={!!creationError} aria-describedby={creationError ? "creation-error" : undefined} placeholder={draft.kind === "file" ? "File name" : "Folder name"} value={entryName} disabled={creating} onChange={(event) => setEntryName(event.target.value)} autoComplete="off" spellCheck={false} />
            {creationError && <p id="creation-error" role="alert">{creationError}</p>}
          </form>
        } />}
        {children}
      </FileTreeFolder>
    );
  };

  return (
    <FileTree
      ariaLabel="Folder tree"
      value={activePath}
      onValueChange={handleValueChange}
      expandedIds={expandedIds}
      onExpandedChange={handleExpand}
      indent={18}
    >
      {renderFolder(path, name, true)}
    </FileTree>
  );
}
