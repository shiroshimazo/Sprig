import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { DETACHED_LABEL } from "./terminalRelay";
import type { DetachedWindowMessage } from "./terminalRelay";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { animate } from "animejs";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRightIcon, CommandLineIcon, File01Icon, Folder01Icon, FolderOpenIcon, GitBranchIcon, Menu01Icon, MultiplicationSignIcon, PlusSignIcon, SaveIcon, SidebarLeftIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { beyondDragThreshold, isOutsideWindow, type WindowBounds } from "./terminalDrag";
import ResizeHandle from "./ResizeHandle";
import FolderTree from "./FolderTree";
import CodeEditor from "./CodeEditor";
import TerminalPanel from "./TerminalPanel";
import type { TerminalPanelHandle } from "./TerminalPanel";
import { SourceControl, CommitHistory, useSourceControl } from "./SourceControl";
import WindowControls from "./WindowControls";
import TerminalTabIcon from "./TerminalTabIcon";
import type { TerminalIconId } from "./terminalIcons";
import "./App.css";

const MAX_TERMINALS = 4;

type TerminalTab = { id: string; name: string; cwd: string | null; icon?: TerminalIconId; detached?: boolean; sessionId?: string; detachOnReady?: boolean };

function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(22);
  const [terminalHeight, setTerminalHeight] = useState(28);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [folderPath, setFolderPath] = useState<string | null>(null);
  // The last open folder is restored on startup and saved whenever it
  // changes, so the folder survives closing the app or shutting down the PC.
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [creation, setCreation] = useState<{ kind: "file" | "folder" } | null>(null);
  const [sidebarMode, setSidebarMode] = useState<"files" | "source">("files");
  const sourceControl = useSourceControl(folderPath, sidebarMode === "source");
  const nextTerminalNumber = useRef(2);
  const [terminals, setTerminals] = useState<TerminalTab[]>(() => [{ id: crypto.randomUUID(), name: "Terminal 1", cwd: null }]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => terminals[0].id);
  // Tabs whose detach handoff is in flight. The roster must include these,
  // otherwise the shared window never mounts a pane and the handoff deadlocks.
  const [pendingDetach, setPendingDetach] = useState<string[]>([]);
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;
  const pendingRef = useRef(pendingDetach);
  pendingRef.current = pendingDetach;
  const rosterSignature = useRef("\0");
  const createDetached = useRef<(sourceId: string) => void>(() => {});
  const emitRoster = useCallback(() => {
    if (!isTauri()) return;
    const pending = pendingRef.current;
    const list = terminalsRef.current
      .filter((tab) => tab.sessionId && (tab.detached || pending.includes(tab.id)))
      .map(({ sessionId, name, cwd, icon }) => ({ id: sessionId!, name, cwd, icon }));
    const canCreate = terminalsRef.current.length < MAX_TERMINALS;
    const signature = JSON.stringify({ list, canCreate });
    if (rosterSignature.current === signature) return;
    rosterSignature.current = signature;
    void emitTo(DETACHED_LABEL, "detached-window", { type: "roster", terminals: list, canCreate } satisfies DetachedWindowMessage).catch(() => {});
  }, []);
  useEffect(() => { emitRoster(); }, [terminals, pendingDetach, emitRoster]);
  // Drop pending entries once they detach (handoff done) or after a short
  // grace period if the panel never reports back.
  useEffect(() => {
    setPendingDetach((current) => {
      const next = current.filter((id) => !terminals.some((tab) => tab.id === id && tab.detached));
      return next.length === current.length ? current : next;
    });
  }, [terminals]);
  // Re-send the roster when the shared detached window mounts or remounts.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<DetachedWindowMessage>("detached-window", ({ payload }) => {
      if (payload?.type === "ready") { rosterSignature.current = "\0"; emitRoster(); }
      else if (payload?.type === "create") createDetached.current(payload.sourceId);
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, [emitRoster]);
  const terminalViews = useRef(new Map<string, TerminalPanelHandle>());
  // Mark the tab pending, then ask its panel to detach. Roster readers see
  // pending tabs so the shared window can mount the pane during handoff.
  const requestPopOut = useCallback((id: string) => {
    if (!terminalsRef.current.find((tab) => tab.id === id)?.sessionId) return;
    setPendingDetach((current) => (current.includes(id) ? current : [...current, id]));
    terminalViews.current.get(id)?.popOut();
  }, []);
  createDetached.current = (sourceId) => {
    const current = terminalsRef.current;
    const source = current.find((tab) => tab.sessionId === sourceId && tab.detached);
    if (!source || current.length >= MAX_TERMINALS) return;
    const tab = { id: crypto.randomUUID(), name: `Terminal ${nextTerminalNumber.current++}`, cwd: source.cwd, detachOnReady: true };
    setTerminals((latest) => latest.length < MAX_TERMINALS && latest.some((item) => item.sessionId === sourceId && item.detached) ? [...latest, tab] : latest);
  };
  useEffect(() => {
    const ready = terminals.filter((tab) => tab.detachOnReady && tab.sessionId);
    if (!ready.length) return;
    for (const tab of ready) requestPopOut(tab.id);
    setTerminals((current) => current.map((tab) => ready.some((item) => item.id === tab.id) ? { ...tab, detachOnReady: false } : tab));
  }, [terminals, requestPopOut]);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const [dragGhost, setDragGhost] = useState<{ name: string } | null>(null);
  const tabDrag = useRef<{ pointerId: number; startX: number; startY: number; bounds: WindowBounds; tabId: string; tabName: string; active: boolean } | null>(null);
  const suppressTabClickUntil = useRef(0);
  const dockedTerminals = terminals.filter((tab) => !tab.detached);
  const selectedTerminalId = dockedTerminals.find((tab) => tab.id === activeTerminalId)?.id ?? dockedTerminals[0]?.id;
  const addTerminal = useCallback(() => {
    if (terminals.length >= MAX_TERMINALS) return;
    const tab = { id: crypto.randomUUID(), name: `Terminal ${nextTerminalNumber.current++}`, cwd: folderPath };
    setTerminals((current) => [...current, tab]);
    setActiveTerminalId(tab.id);
  }, [terminals.length, folderPath]);
  const closeTerminal = useCallback((id: string) => {
    const index = terminals.findIndex((tab) => tab.id === id);
    const next = terminals.filter((tab) => tab.id !== id);
    setTerminals(next);
    if (activeTerminalId === id) {
      setActiveTerminalId(next[Math.min(index, next.length - 1)]?.id ?? null);
    }
  }, [terminals, activeTerminalId]);
  const focusTerminalTab = useCallback((id: string) => {
    document.getElementById(`terminal-tab-${id}`)?.focus();
  }, []);
  // Drag a terminal tab out of the window to pop it into its own window.
  // The press only becomes a drag after a few pixels of movement so plain
  // clicks keep working; the geometry is computed in screen coordinates
  // because pointer capture does not reliably report out-of-window client
  // positions.
  const startTerminalDrag = (event: ReactPointerEvent<HTMLButtonElement>, tab: TerminalTab) => {
    if (event.button !== 0 || !isTauri()) return;
    tabDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds: { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight },
      tabId: tab.id,
      tabName: tab.name,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveTerminalDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = tabDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (!beyondDragThreshold(event.clientX - drag.startX, event.clientY - drag.startY)) return;
      drag.active = true;
      setDragGhost({ name: drag.tabName });
      return;
    }
    const ghost = dragGhostRef.current;
    if (!ghost) return;
    const x = Math.min(Math.max(event.clientX + 14, 8), Math.max(8, window.innerWidth - ghost.offsetWidth - 8));
    const y = Math.min(Math.max(event.clientY + 16, 8), Math.max(8, window.innerHeight - ghost.offsetHeight - 8));
    ghost.style.transform = `translate(${x}px, ${y}px)`;
    ghost.classList.toggle("terminal-drag-ghost--outside", isOutsideWindow(event.screenX, event.screenY, drag.bounds));
  };
  // A click may follow a released drag; swallow clicks for a short window
  // afterwards. A timestamp (not a flag) so stale state never eats later clicks.
  const noteDragEnded = () => { suppressTabClickUntil.current = Date.now() + 400; };
  const endTerminalDrag = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const drag = tabDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    tabDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.active) return;
    noteDragEnded();
    setDragGhost(null);
    if (commit && isOutsideWindow(event.screenX, event.screenY, drag.bounds)) {
      requestPopOut(drag.tabId);
    }
  };
  const cancelTerminalDrag = () => {
    if (tabDrag.current?.active) noteDragEnded();
    tabDrag.current = null;
    setDragGhost(null);
  };
  const dragging = dragGhost !== null;
  useEffect(() => {
    document.body.classList.toggle("terminal-dragging", dragging);
    if (!dragging) return () => document.body.classList.remove("terminal-dragging");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelTerminalDrag();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.classList.remove("terminal-dragging");
    };
  }, [dragging]);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Reopen the folder that was open during the previous run. The backend also
  // grants file system access to it, which a folder picked in an earlier
  // session would not have.
  useEffect(() => {
    let cancelled = false;
    const ready = () => { if (!cancelled) setWorkspaceReady(true); };
    if (!isTauri()) { ready(); return; }
    void invoke<{ folder: string | null }>("restore_workspace")
      .then((state) => {
        const folder = state?.folder;
        if (cancelled || !folder) return;
        setFolderPath(folder);
        setTerminals((current) => current.map((tab) => tab.detached ? tab : { ...tab, cwd: folder }));
        setSidebarVisible(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setDialogError(`Cannot reopen the last folder: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(ready);
    return () => { cancelled = true; };
  }, []);
  // Remember the open folder right away so it survives a crash or a shutdown.
  useEffect(() => {
    if (!workspaceReady || !folderPath) return;
    void invoke("save_workspace", { folder: folderPath }).catch(() => {});
  }, [folderPath, workspaceReady]);
  const dialogActive = useRef(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuButton = useRef<HTMLButtonElement>(null);
  const [fileContent, setFileContent] = useState("");
  const [, setContentRevision] = useState(0);
  const documents = useRef(new Map<string, { saved: string; current: string }>());
  const activePath = useRef<string | null>(null);
  const updateContent = useCallback((content: string) => {
    const document = activePath.current ? documents.current.get(activePath.current) : undefined;
    if (document) document.current = content;
    setContentRevision((revision) => revision + 1);
  }, []);

  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const readRequest = useRef(0);
  const saving = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<{ path: string } | null>(null);
  const [promptPath, setPromptPath] = useState<string | null>(null);
  const prompt = useRef<HTMLDialogElement>(null);
  const folderName = folderPath?.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
  const answer = useRef<((choice: "save" | "discard" | "cancel") => void) | null>(null);
  const guarding = useRef(false);
  const saveFile = useCallback(async (requestedPath?: string) => {
    const path = requestedPath ?? activePath.current;
    const document = path ? documents.current.get(path) : undefined;
    if (!path || !document || saving.current) return false;
    const content = document.current;
    const expectedContent = document.saved;
    saving.current = true;
    setSavePending(true);
    setSaveError(null);
    try {
      await invoke("save_file", { path, content, expectedContent });
      document.saved = content;
      if (activePath.current === path) setFileContent(content);
      return document.current === content;
    } catch (error) {
      setSaveError(`Cannot save ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      saving.current = false;
      setSavePending(false);
    }
  }, []);

  useEffect(() => {
    const dialog = prompt.current;
    if (!promptPath || !dialog) return;
    dialog.showModal();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animation = reducedMotion.matches ? null : animate(dialog, {
      opacity: [0, 1],
      duration: 120,
      ease: "outQuad",
    });
    const finish = () => { if (reducedMotion.matches) animation?.complete(); };
    reducedMotion.addEventListener("change", finish);
    return () => {
      reducedMotion.removeEventListener("change", finish);
      animation?.revert();
    };
  }, [promptPath]);

  function respond(choice: "save" | "discard" | "cancel") {
    prompt.current?.close();
    setPromptPath(null);
    answer.current?.(choice);
    answer.current = null;
  }

  const confirmLeaving = useCallback(async (paths: string[]) => {
    if (guarding.current || saving.current) return false;
    guarding.current = true;
    try {
      for (const path of paths) {
        const document = documents.current.get(path);
        if (!document || document.current === document.saved) continue;
        const choice = await new Promise<"save" | "discard" | "cancel">((resolve) => {
          answer.current = resolve;
          setPromptPath(path);
        });
        if (choice === "cancel") return false;
        if (choice === "save" && !await saveFile(path)) return false;
        if (choice === "discard") {
          document.current = document.saved;
          setDiscarded({ path });
          if (activePath.current === path) {
            setContentRevision((revision) => revision + 1);
          }
        }
      }
      return true;
    } finally { guarding.current = false; }
  }, [saveFile]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saving.current || [...documents.current.values()].some((document) => document.current !== document.saved)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await confirmLeaving([...documents.current.keys()])) {
          try { await appWindow.destroy(); }
          catch (error) { setSaveError(`Cannot close window: ${String(error)}`); }
        }
      }).then((stop) => { if (disposed) stop(); else unlisten = stop; })
        .catch((error) => setSaveError(`Cannot register close protection: ${String(error)}`));
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [confirmLeaving]);

  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [saveFile]);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFileMenuOpen(false);
        fileMenuButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fileMenuOpen]);

  const fileTabId = (path: string) => `file-tab-${encodeURIComponent(path)}`;

  async function openFile(path: string) {
    if (!openTabs.includes(path)) setOpenTabs((tabs) => [...tabs, path]);
    await activateFile(path);
  }

  async function activateFile(path: string) {
    if (path === activePath.current) return;
    const cached = documents.current.get(path);
    if (cached) {
      activePath.current = path;
      setFilePath(path);
      setFileContent(cached.saved);
      setContentRevision((revision) => revision + 1);
      setFileError(null);
      return;
    }
    const request = ++readRequest.current;
    setLoadingPath(path);
    setFileError(null);
    try {
      const content = await invoke<string>("read_file", { path });
      if (request !== readRequest.current) return;
      const document = { saved: content, current: content };
      documents.current.set(path, document);
      activePath.current = path;
      setFilePath(path);
      setFileContent(content);
      setContentRevision((revision) => revision + 1);
    } catch (error) {
      if (request === readRequest.current) {
        setFileError(`Cannot open ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (request === readRequest.current) setLoadingPath(null);
    }
  }

  async function closeTab(path: string) {
    const leaving = await confirmLeaving([path]);
    if (!leaving) return;
    const index = openTabs.indexOf(path);
    const next = openTabs.filter((tab) => tab !== path);
    setOpenTabs(next);
    if (activePath.current === path) {
      const neighbor = next[Math.min(Math.max(index, 0), next.length - 1)];
      if (neighbor !== undefined) {
        await activateFile(neighbor);
      } else {
        activePath.current = null;
        setFilePath(null);
        setFileContent("");
        setFileError(null);
      }
    }
  }

  function startCreation(kind: "file" | "folder") {
    if (!folderPath) return;
    setSidebarMode("files");
    setSidebarVisible(true);
    setCreation({ kind });
  }

  async function selectPath(directory: boolean) {
    if (dialogActive.current) return;
    setDialogError(null);
    if (!isTauri()) {
      setDialogError("Open the desktop app to use native file and folder dialogs.");
      return;
    }
    dialogActive.current = true;
    setDialogPending(true);
    try {
      const selected = await open({
        directory,
        recursive: directory,
        multiple: false,
        title: directory ? "Open Folder" : "Open File",
      });
      if (selected !== null) {
        if (directory) {
          if (!await confirmLeaving([...documents.current.keys()])) return;
          setFolderPath(selected);
          setTerminals((current) => current.map((tab) => tab.detached ? tab : { ...tab, cwd: selected }));
          setSidebarVisible(true);
        } else {
          void openFile(selected);
        }
      }
    } catch (error) {
      setDialogError(`Could not open ${directory ? "folder" : "file"} dialog: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      dialogActive.current = false;
      setDialogPending(false);
    }
  }
  return (
    <div className="ide">
      <dialog ref={prompt} className="unsaved-dialog" aria-labelledby="unsaved-title" onCancel={(event) => { event.preventDefault(); respond("cancel"); }}>
        <h2 id="unsaved-title">Save changes?</h2>
        <p>{promptPath}</p>
        <p>Save your edits or discard them before continuing.</p>
        <div>
          <button onClick={() => respond("save")}>Save</button>
          <button onClick={() => respond("discard")}>Discard</button>
          <button autoFocus onClick={() => respond("cancel")}>Cancel</button>
        </div>
      </dialog>
      {dragGhost && (
        <div ref={dragGhostRef} className="terminal-drag-ghost" style={{ transform: "translate(-1000px, -1000px)" }} aria-hidden="true">
          <HugeiconsIcon icon={CommandLineIcon} size={13} aria-hidden="true" focusable="false" />
          <span className="terminal-drag-ghost-name">{dragGhost.name}</span>
        </div>
      )}
      <header className="toolbar">
        <WindowControls />
        <div className="file-actions" aria-label="File actions" ref={fileMenuRef}>
          <button
            ref={fileMenuButton}
            aria-label={fileMenuOpen ? "Close file menu" : "Open file menu"}
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            aria-controls="file-menu"
            title="File menu"
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            <HugeiconsIcon icon={Menu01Icon} size={13} aria-hidden="true" focusable="false" />
          </button>
          {fileMenuOpen && (
            <div className="file-menu" id="file-menu" role="menu" aria-label="File actions">
              <button role="menuitem" disabled={dialogPending || !folderPath} onClick={() => { setFileMenuOpen(false); startCreation("file"); }}>
                <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden="true" focusable="false" />
                New File
              </button>
              <button role="menuitem" disabled={dialogPending || !folderPath} onClick={() => { setFileMenuOpen(false); startCreation("folder"); }}>
                <HugeiconsIcon icon={Folder01Icon} size={13} aria-hidden="true" focusable="false" />
                New Folder
              </button>
              <button role="menuitem" disabled={!filePath || savePending} onClick={() => { setFileMenuOpen(false); void saveFile(); }}>
                <HugeiconsIcon icon={SaveIcon} size={13} aria-hidden="true" focusable="false" />
                {savePending ? "Saving..." : "Save"}
              </button>
              <button role="menuitem" disabled={dialogPending} onClick={() => { setFileMenuOpen(false); void selectPath(false); }}>
                <HugeiconsIcon icon={File01Icon} size={13} aria-hidden="true" focusable="false" />
                Open File
              </button>
              <button role="menuitem" disabled={dialogPending} onClick={() => { setFileMenuOpen(false); void selectPath(true); }}>
                <HugeiconsIcon icon={FolderOpenIcon} size={13} aria-hidden="true" focusable="false" />
                Open Folder
              </button>
            </div>
          )}
          {dialogPending && <span className="toolbar-note" role="status">Dialog open…</span>}
        </div>
        <div
          className="toolbar-spacer"
          data-tauri-drag-region
          aria-hidden="true"
          onDoubleClick={() => { if (isTauri()) void getCurrentWindow().toggleMaximize().catch(() => {}); }}
        />
        <div className="panel-actions" aria-label="Panel visibility">
          <button
            aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            aria-controls="files-panel"
            aria-expanded={sidebarVisible}
            onClick={() => setSidebarVisible(!sidebarVisible)}
          >
            <HugeiconsIcon icon={SidebarLeftIcon} size={13} aria-hidden="true" focusable="false" />
          </button>
          <button
            aria-label={terminalVisible ? "Hide terminal" : "Show terminal"}
            title={terminalVisible ? "Hide terminal" : "Show terminal"}
            aria-controls="terminal-panel"
            aria-expanded={terminalVisible}
            onClick={() => setTerminalVisible(!terminalVisible)}
          >
            <HugeiconsIcon icon={TerminalIcon} size={13} aria-hidden="true" focusable="false" />
          </button>
        </div>
      </header>

      {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
      <div className="workspace" style={{ gridTemplateColumns: sidebarVisible ? `${sidebarWidth}% 4px minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
        <aside id="files-panel" className="sidebar" hidden={!sidebarVisible} aria-labelledby="files-heading">
          <div className="panel-header">
            <h2 id="files-heading">{sidebarMode === "files" ? "Files" : "Source Control"}</h2>
            {sidebarMode === "files" && <div className="creation-actions">
              <button disabled={!folderPath} title="New file" aria-label="New file" onClick={() => startCreation("file")}><HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden="true" /> File</button>
              <button disabled={!folderPath} title="New folder" aria-label="New folder" onClick={() => startCreation("folder")}><HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden="true" /> Folder</button>
            </div>}
          </div>
          <div className="sidebar-content">
            {sidebarMode === "source" ? <SourceControl control={sourceControl} path={folderPath} /> : folderPath ? <FolderTree key={folderPath} path={folderPath} name={folderName ?? folderPath} activePath={filePath} onOpenFile={openFile} creation={creation} onCreationDone={() => setCreation(null)} /> : <p className="sidebar-empty">No folder open.</p>}
          </div>
          <div className="sidebar-switch" aria-label="Sidebar views">
            <button
              type="button"
              aria-pressed={sidebarMode === "files"}
              aria-label="Files"
              title="Files"
              onClick={() => setSidebarMode("files")}
            >
              <HugeiconsIcon icon={File01Icon} size={12} aria-hidden="true" focusable="false" />
            </button>
            <button
              type="button"
              aria-pressed={sidebarMode === "source"}
              aria-label="Source Control"
              title="Source Control"
              onClick={() => setSidebarMode("source")}
            >
              <HugeiconsIcon icon={GitBranchIcon} size={12} aria-hidden="true" focusable="false" />
            </button>
          </div>
        </aside>
        {sidebarVisible && <ResizeHandle panel="files-panel" label="Resize sidebar" orientation="vertical" value={sidebarWidth} onResize={setSidebarWidth} />}

        <main className="workbench" style={{ gridTemplateRows: terminalVisible ? `minmax(0, 1fr) 4px ${terminalHeight}%` : "minmax(0, 1fr)" }}>
          {sidebarMode === "source" && <CommitHistory control={sourceControl} />}
          <section id="editor-pane" className="editor" style={sidebarMode === "source" ? { display: "none" } : undefined} role="tabpanel" aria-labelledby={filePath ? fileTabId(filePath) : "editor-heading"}>
            <div className="panel-header">
              <h2 id="editor-heading">Editor</h2>
              {openTabs.length > 0 && (
                <div className="file-tabs" role="tablist" aria-label="Open files">
                  {openTabs.map((tabPath) => {
                    const doc = documents.current.get(tabPath);
                    const dirty = doc ? doc.current !== doc.saved : false;
                    const selected = tabPath === filePath;
                    const name = tabPath.split(/[\\/]/).filter(Boolean).pop() ?? tabPath;
                    const id = fileTabId(tabPath);
                    return (
                      <div key={tabPath} className={`file-tab${selected ? " file-tab--active" : ""}`}>
                        <button
                          role="tab"
                          id={id}
                          aria-selected={selected}
                          aria-controls="editor-pane"
                          tabIndex={selected ? 0 : -1}
                          className="file-tab-select"
                          title={tabPath}
                          onClick={() => void activateFile(tabPath)}
                          onKeyDown={(event) => {
                            const current = openTabs.indexOf(tabPath);
                            let target: number | null = null;
                            if (event.key === "ArrowRight") target = (current + 1) % openTabs.length;
                            else if (event.key === "ArrowLeft") target = (current - 1 + openTabs.length) % openTabs.length;
                            else if (event.key === "Home") target = 0;
                            else if (event.key === "End") target = openTabs.length - 1;
                            if (target !== null) {
                              event.preventDefault();
                              void activateFile(openTabs[target]);
                              document.getElementById(fileTabId(openTabs[target]))?.focus();
                            }
                          }}
                        >
                          {dirty && <span className="file-tab-dot" role="img" aria-label="Unsaved changes" />}
                          <span className="file-tab-name">{name}</span>
                        </button>
                        <button className="file-tab-close" aria-label={`Close ${name}`} title={`Close ${name}`} onClick={() => void closeTab(tabPath)}>
                          <HugeiconsIcon icon={MultiplicationSignIcon} size={13} aria-hidden="true" focusable="false" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {filePath && <span className="cursor-position" aria-label={`Line ${cursorPosition.line}, column ${cursorPosition.column}`}>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>}
            </div>
            {loadingPath && <p className="file-message" role="status">Opening {loadingPath}...</p>}
            {fileError && (
              <div className="file-error">
                <div role="alert"><strong>File could not be opened</strong><p>{fileError}</p><p>Your current edits are unchanged. Check the file and try opening it again.</p></div>
                <button aria-label="Dismiss file error" onClick={() => setFileError(null)}>Dismiss</button>
              </div>
            )}
            {saveError && (
              <div className="file-error">
                <div role="alert"><strong>Action failed</strong><p>{saveError}</p><p>Your unsaved edits remain in memory.</p></div>
                <button aria-label="Dismiss save error" onClick={() => setSaveError(null)}>Dismiss</button>
              </div>
            )}
            {filePath ? (
              <CodeEditor content={fileContent} path={filePath} onChange={updateContent} onPositionChange={setCursorPosition} discarded={discarded} />
            ) : (
              <div className="editor-empty">
                <h2>No file open</h2>
                <p>{folderPath ? "Choose a file from the sidebar, or open another file." : "Open a file to edit, or a folder to browse your code."}</p>
                <div className="file-actions empty-actions" aria-label="Open a workspace">
                  <button disabled={dialogPending || !folderPath} title={folderPath ? "New file" : "Open a folder first"} onClick={() => startCreation("file")}>
                    <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden="true" focusable="false" />
                    New File
                  </button>
                  <button disabled={dialogPending} onClick={() => void selectPath(false)}>
                    <HugeiconsIcon icon={File01Icon} size={13} aria-hidden="true" focusable="false" />
                    Open File
                  </button>
                  <button disabled={dialogPending} onClick={() => void selectPath(true)}>
                    <HugeiconsIcon icon={FolderOpenIcon} size={13} aria-hidden="true" focusable="false" />
                    Open Folder
                  </button>
                </div>
              </div>
            )}
          </section>

          {terminalVisible && <ResizeHandle panel="terminal-panel" label="Resize terminal" orientation="horizontal" value={terminalHeight} onResize={setTerminalHeight} />}
          <section id="terminal-panel" className="terminal" hidden={!terminalVisible} aria-labelledby="terminal-heading">
            <div className="panel-header">
              <h2 id="terminal-heading">Terminal</h2>
              <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
                {dockedTerminals.map((tab) => {
                  const selected = tab.id === selectedTerminalId;
                  return (
                    <div key={tab.id} className={`terminal-tab${selected ? " terminal-tab--active" : ""}`}>
                      <button
                        role="tab"
                        id={`terminal-tab-${tab.id}`}
                        aria-selected={selected}
                        aria-controls={`terminal-pane-${tab.id}`}
                        tabIndex={selected ? 0 : -1}
                        className="terminal-tab-select"
                        title={`${tab.cwd ?? tab.name} — drag the tab outside the window to move it into its own window`}
                        onPointerDown={(event) => startTerminalDrag(event, tab)}
                        onPointerMove={moveTerminalDrag}
                        onPointerUp={(event) => endTerminalDrag(event, true)}
                        onPointerCancel={(event) => endTerminalDrag(event, false)}
                        onLostPointerCapture={cancelTerminalDrag}
                        onClick={() => {
                          if (Date.now() < suppressTabClickUntil.current) return;
                          setActiveTerminalId(tab.id);
                        }}
                        onKeyDown={(event) => {
                          const index = dockedTerminals.findIndex((item) => item.id === tab.id);
                          let target: TerminalTab | undefined;
                          if (event.key === "ArrowRight") target = dockedTerminals[(index + 1) % dockedTerminals.length];
                          else if (event.key === "ArrowLeft") target = dockedTerminals[(index - 1 + dockedTerminals.length) % dockedTerminals.length];
                          else if (event.key === "Home") target = dockedTerminals[0];
                          else if (event.key === "End") target = dockedTerminals[dockedTerminals.length - 1];
                          if (target) {
                            event.preventDefault();
                            setActiveTerminalId(target.id);
                            focusTerminalTab(target.id);
                          }
                        }}
                      >
                        <TerminalTabIcon value={tab.icon} />
                        {tab.name}
                      </button>
                      <button className="terminal-tab-add terminal-tab-popout" aria-label={`Pop out ${tab.name}`} title="Move terminal into a shared window" onClick={() => requestPopOut(tab.id)}>
                        <HugeiconsIcon icon={ArrowUpRightIcon} size={13} aria-hidden="true" focusable="false" />
                      </button>
                      <button className="terminal-tab-close" aria-label={`Close ${tab.name}`} title={`Close ${tab.name}`} onClick={() => closeTerminal(tab.id)}>
                        <HugeiconsIcon icon={MultiplicationSignIcon} size={13} aria-hidden="true" focusable="false" />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="terminal-tab-add"
                  aria-label="New terminal"
                  title={terminals.length >= MAX_TERMINALS ? "Terminal limit reached (4)" : "New terminal"}
                  disabled={terminals.length >= MAX_TERMINALS}
                  onClick={addTerminal}
                >
                  <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden="true" focusable="false" />
                </button>
              </div>
            </div>
            <div className="terminal-panes">
              {/* Wait for the restored folder so the shell starts in it. */}
              {workspaceReady && terminals.map((tab) => (
                <div
                  key={tab.id}
                  role="tabpanel"
                  id={`terminal-pane-${tab.id}`}
                  aria-labelledby={`terminal-tab-${tab.id}`}
                  hidden={tab.detached || tab.id !== selectedTerminalId}
                  className="terminal-pane"
                >
                  <TerminalPanel cwd={tab.cwd} name={tab.name} onIconChange={(icon) => {
                    setTerminals((current) => current.map((item) => item.id === tab.id && item.icon !== icon ? { ...item, icon } : item));
                  }} ref={(view) => { if (view) terminalViews.current.set(tab.id, view); else terminalViews.current.delete(tab.id); }} onSessionReady={(sessionId) => {
                    setTerminals((current) => current.map((item) => item.id === tab.id ? { ...item, sessionId } : item));
                  }} onCloseRequested={() => closeTerminal(tab.id)} onDetachedChange={(detached) => {
                    setTerminals((current) => current.map((item) => item.id === tab.id ? { ...item, detached } : item));
                    setPendingDetach((current) => current.filter((id) => id !== tab.id));
                    if (!detached) { setActiveTerminalId(tab.id); setTerminalVisible(true); }
                  }} />
                </div>
              ))}
              {dockedTerminals.length === 0 && (
                <div className="terminal-empty">
                  <p>{terminals.length ? "Terminals are open in separate app windows. Close those windows to dock them here." : "No terminal open."}</p>
                  <button className="terminal-empty-action" disabled={terminals.length >= MAX_TERMINALS} onClick={addTerminal}>Open Terminal</button>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
