import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardPasteIcon, Copy01Icon, CopyPlusIcon, Delete02Icon, Edit01Icon, FolderOpenIcon, LinkSquare01Icon, ScissorIcon } from "@hugeicons/core-free-icons";
import { ContextMenuPopup, type ContextMenuItem } from "./ContextMenu";
import type { FileEntry } from "./FolderTree";
import { fileName, isInsideFolder, stripVerbatimPrefix } from "./filePaths";
import { toast } from "./components/ui/toast-stack";

export type FileTreeMenuTarget = { entry: FileEntry; x: number; y: number; opener: HTMLButtonElement };
export type ChangeTreeEntry = (path: string, operation: () => Promise<boolean>) => Promise<boolean | null>;
type Action =
  | { type: "copy" | "move"; folder: string }
  | { type: "rename"; name: string }
  | { type: "duplicate" | "trash" | "open" | "reveal" };

const actionSuccess: Partial<Record<Action["type"], string>> = {
  copy: "Copied",
  move: "Moved",
  rename: "Renamed",
  duplicate: "Duplicated",
  trash: "Moved to Trash",
};

export default function FileTreeMenu({ root, target, dismiss, changeEntry, onChanged, onRename }: {
  root: string;
  target: FileTreeMenuTarget | null;
  dismiss: (restoreFocus: boolean) => void;
  changeEntry: ChangeTreeEntry;
  onChanged: (paths: string[], removed?: string) => void;
  onRename: (entry: FileEntry, submit: (name: string, onError: (message: string) => void) => Promise<boolean>) => void;
}) {
  const [clipboard, setClipboard] = useState<{ path: string; cut: boolean } | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<FileEntry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const callbacks = useRef({ changeEntry, onChanged });
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    callbacks.current = { changeEntry, onChanged };
  }, [changeEntry, onChanged]);

  useLayoutEffect(() => {
    if (!deleteEntry) return;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, [deleteEntry]);

  async function run(operation: () => Promise<boolean>, onError = (message: string) => toast.error("File action failed", message)) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function perform(path: string, action: Action, onError?: (message: string) => void) {
    return run(async () => {
      const mutatesSource = action.type === "rename" || action.type === "trash" || action.type === "move";
      const invokeAction = () => invoke<boolean>("file_tree_action", { root, path, action });
      const changed = mutatesSource ? await callbacks.current.changeEntry(path, invokeAction) : await invokeAction();
      if (changed === null) return false;
      if (changed && mounted.current) {
        callbacks.current.onChanged("folder" in action ? [path, action.folder] : [path], mutatesSource ? path : undefined);
        const title = actionSuccess[action.type];
        if (title) toast.success(title, action.type === "rename" ? action.name : fileName(path));
      }
      if (action.type === "move" || (changed && mutatesSource)) {
        setClipboard((current) => current && (action.type === "move" || isInsideFolder(path, current.path)) ? null : current);
      }
      return true;
    }, onError);
  }

  const items: ContextMenuItem[] = [];
  if (target) {
    const { entry } = target;
    const path = entry.path;
    const canChange = path !== root && !entry.isSymlink;
    const item = (label: string, icon: typeof Copy01Icon, action: () => void, options: Partial<ContextMenuItem> = {}) => {
      items.push({ label, icon: <HugeiconsIcon icon={icon} size={14} aria-hidden="true" />, action, enabled: !busy, ...options });
    };
    if (canChange) {
      item("Copy", Copy01Icon, () => setClipboard({ path, cut: false }));
      item("Cut", ScissorIcon, () => setClipboard({ path, cut: true }));
    }
    if (entry.isDirectory && clipboard) {
      item("Paste", ClipboardPasteIcon, () => void perform(clipboard.path, { type: clipboard.cut ? "move" : "copy", folder: path }), {
        enabled: !busy && !isInsideFolder(clipboard.path, path),
      });
    }
    if (canChange) {
      item("Duplicate", CopyPlusIcon, () => void perform(path, { type: "duplicate" }));
      item("Rename", Edit01Icon, () => {
        onRename(entry, (name, reportError) => perform(path, { type: "rename", name }, reportError));
      }, { separator: true });
    }
    item("Copy Path", Copy01Icon, () => void run(async () => {
      await navigator.clipboard.writeText(stripVerbatimPrefix(path));
      toast.success("Path copied");
      return true;
    }));
    if (!entry.isSymlink) {
      item("Open with External App", LinkSquare01Icon, () => void perform(path, { type: "open" }), { separator: true });
      item("Show in File Manager", FolderOpenIcon, () => void perform(path, { type: "reveal" }));
    }
    if (canChange) item("Delete…", Delete02Icon, () => {
      setError("");
      setDeleteEntry(entry);
    }, { separator: true, destructive: true });
  }

  return <>
    {target && <ContextMenuPopup
      panel={{ x: target.x, y: target.y, items }}
      close={(_, restoreFocus = true) => dismiss(restoreFocus)}
      label={`Actions for ${target.entry.name}`}
    />}
    {busy && !deleteEntry && <p className="file-tree-action-status" role="status">Working…</p>}
    {deleteEntry && <dialog ref={dialog} className="app-dialog confirmation-dialog" aria-labelledby="tree-action-title" onCancel={(event) => {
      event.preventDefault();
      if (!running.current) { setDeleteEntry(null); setError(""); }
    }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (await perform(deleteEntry.path, { type: "trash" }, setError)) setDeleteEntry(null);
      }}>
        <h2 id="tree-action-title">Move to Trash?</h2>
        <p>{deleteEntry.name}</p>
        {error && <p className="file-tree-action-error" role="alert">{error}</p>}
        <div className="confirmation-dialog-actions">
          <button type="button" ref={cancel} disabled={busy} onClick={() => { setDeleteEntry(null); setError(""); }}>Cancel</button>
          <button className="delete-confirm" type="submit" disabled={busy}>
            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
            {busy ? "Working…" : "Move to Trash"}
          </button>
        </div>
      </form>
    </dialog>}
  </>;
}
