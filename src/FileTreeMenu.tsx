import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardPasteIcon, Copy01Icon, CopyPlusIcon, Delete02Icon, Edit01Icon, FolderOpenIcon, LinkSquare01Icon, ScissorIcon } from "@hugeicons/core-free-icons";
import { ContextMenuPopup, type ContextMenuItem } from "./ContextMenu";
import type { FileEntry } from "./FolderTree";
import { isInsideFolder, stripVerbatimPrefix } from "./filePaths";

export type FileTreeMenuTarget = { entry: FileEntry; x: number; y: number; opener: HTMLButtonElement };
export type ChangeTreeEntry = (path: string, operation: () => Promise<boolean>) => Promise<boolean | null>;
type Action =
  | { type: "copy" | "move"; folder: string }
  | { type: "rename"; name: string }
  | { type: "duplicate" | "trash" | "open" | "reveal" };

export default function FileTreeMenu({ root, target, dismiss, changeEntry, onChanged }: {
  root: string;
  target: FileTreeMenuTarget | null;
  dismiss: (restoreFocus: boolean) => void;
  changeEntry: ChangeTreeEntry;
  onChanged: (paths: string[], removed?: string) => void;
}) {
  const [clipboard, setClipboard] = useState<{ path: string; cut: boolean } | null>(null);
  const [prompt, setPrompt] = useState<{ type: "rename" | "trash"; entry: FileEntry } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    if (!prompt) return;
    const element = dialog.current;
    element?.showModal();
    if (prompt.type === "rename") {
      nameInput.current?.focus();
      nameInput.current?.select();
    } else cancel.current?.focus();
    return () => element?.close();
  }, [prompt]);

  async function run(operation: () => Promise<boolean>) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      return await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function perform(path: string, action: Action) {
    return run(async () => {
      const mutatesSource = action.type === "rename" || action.type === "trash" || action.type === "move";
      const invokeAction = () => invoke<boolean>("file_tree_action", { root, path, action });
      const changed = mutatesSource ? await changeEntry(path, invokeAction) : await invokeAction();
      if (changed === null) return false;
      if (changed && mounted.current) {
        onChanged("folder" in action ? [path, action.folder] : [path], mutatesSource ? path : undefined);
      }
      if (action.type === "move" || (changed && mutatesSource && clipboard && isInsideFolder(path, clipboard.path))) {
        setClipboard(null);
      }
      return true;
    });
  }

  function ask(type: "rename" | "trash", entry: FileEntry) {
    setError("");
    setName(entry.name);
    setPrompt({ type, entry });
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
      item("Copy", Copy01Icon, () => { setError(""); setClipboard({ path, cut: false }); });
      item("Cut", ScissorIcon, () => { setError(""); setClipboard({ path, cut: true }); });
    }
    if (entry.isDirectory && clipboard) {
      item("Paste", ClipboardPasteIcon, () => void perform(clipboard.path, { type: clipboard.cut ? "move" : "copy", folder: path }), {
        enabled: !busy && !isInsideFolder(clipboard.path, path),
      });
    }
    if (canChange) {
      item("Duplicate", CopyPlusIcon, () => void perform(path, { type: "duplicate" }));
      item("Rename", Edit01Icon, () => ask("rename", entry), { separator: true });
    }
    item("Copy Path", Copy01Icon, () => void run(async () => {
      await navigator.clipboard.writeText(stripVerbatimPrefix(path));
      return true;
    }));
    if (!entry.isSymlink) {
      item("Open with External App", LinkSquare01Icon, () => void perform(path, { type: "open" }), { separator: true });
      item("Show in File Manager", FolderOpenIcon, () => void perform(path, { type: "reveal" }));
    }
    if (canChange) item("Delete…", Delete02Icon, () => ask("trash", entry), { separator: true, destructive: true });
  }

  return <>
    {target && <ContextMenuPopup
      panel={{ x: target.x, y: target.y, items }}
      close={(_, restoreFocus = true) => dismiss(restoreFocus)}
      label={`Actions for ${target.entry.name}`}
    />}
    {error && !prompt && <p className="file-tree-action-error" role="alert">{error}</p>}
    {busy && !prompt && <p className="file-tree-action-status" role="status">Working…</p>}
    {prompt && <dialog ref={dialog} className="unsaved-dialog file-tree-dialog" aria-labelledby="tree-action-title" onCancel={(event) => {
      event.preventDefault();
      if (!running.current) { setPrompt(null); setError(""); }
    }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (prompt.type === "rename" && name === prompt.entry.name) {
          setPrompt(null);
          return;
        }
        const action = prompt.type === "rename" ? { type: "rename" as const, name } : { type: "trash" as const };
        if (await perform(prompt.entry.path, action)) setPrompt(null);
      }}>
        <h2 id="tree-action-title">{prompt.type === "rename" ? "Rename item" : "Move to Trash?"}</h2>
        {prompt.type === "rename" ? <label>New name<input ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} required disabled={busy} /></label>
          : <p>{prompt.entry.name}</p>}
        {error && <p className="file-tree-action-error" role="alert">{error}</p>}
        <div className="file-tree-dialog-actions">
          <button type="button" ref={cancel} disabled={busy} onClick={() => { setPrompt(null); setError(""); }}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? "Working…" : prompt.type === "rename" ? "Rename" : "Move to Trash"}</button>
        </div>
      </form>
    </dialog>}
  </>;
}
