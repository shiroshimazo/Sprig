import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileTree, FileTreeFile, FileTreeFolder } from "./components/motion/file-tree";

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
  createdPath: string | null;
};

const RETRY_SUFFIX = "::retry";
const LOADING_SUFFIX = "::loading";
const EMPTY_SUFFIX = "::empty";

export default function FolderTree({ path, name = path, activePath, onOpenFile, createdPath }: FolderTreeProps) {
  const cache = useRef(new Map<string, CacheEntry>());
  const pending = useRef(new Set<string>());
  const reload = useRef(new Set<string>());
  const lastCreated = useRef(createdPath);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((version) => version + 1), []);

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

  useEffect(() => {
    if (createdPath === lastCreated.current) return;
    lastCreated.current = createdPath;
    cache.current.clear();
    for (const folder of pending.current) reload.current.add(folder);
    for (const folder of expandedIds) void load(folder);
    bump();
  }, [createdPath, expandedIds, load, bump]);

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
    if (value.endsWith(RETRY_SUFFIX)) {
      void load(value.slice(0, -RETRY_SUFFIX.length));
      return;
    }
    if (value.endsWith(LOADING_SUFFIX) || value.endsWith(EMPTY_SUFFIX)) return;
    // Folders are toggled by the tree itself; only open files here.
    for (const cached of cache.current.values()) {
      const hit = cached.entries?.find((entry) => entry.path === value);
      if (hit) {
        if (!(hit.isDirectory && !hit.isSymlink)) onOpenFile(value);
        return;
      }
    }
  }, [load, onOpenFile]);

  const renderEntry = (entry: FileEntry): ReactNode => {
    if (entry.isDirectory && !entry.isSymlink) {
      return renderFolder(entry.path, entry.name);
    }
    return (
      <FileTreeFile
        key={entry.path}
        value={entry.path}
        name={entry.name + (entry.isSymlink ? " (link)" : "")}
        title={entry.path}
      />
    );
  };

  const renderFolder = (folderPath: string, folderName: string): ReactNode => {
    const cached = cache.current.get(folderPath);
    let children: ReactNode;
    if (!cached || cached.loading) {
      children = (
        <FileTreeFile value={`${folderPath}${LOADING_SUFFIX}`} name="Loading folder..." disabled />
      );
    } else if (cached.error) {
      children = (
        <FileTreeFile
          value={`${folderPath}${RETRY_SUFFIX}`}
          name="Couldn't load folder — select to retry"
          title={cached.error}
        />
      );
    } else if (cached.entries && cached.entries.length === 0) {
      children = (
        <FileTreeFile value={`${folderPath}${EMPTY_SUFFIX}`} name="Empty folder." disabled />
      );
    } else {
      children = cached.entries!.map(renderEntry);
    }
    return (
      <FileTreeFolder key={folderPath} value={folderPath} name={folderName} title={folderPath}>
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
      {renderFolder(path, name)}
    </FileTree>
  );
}
