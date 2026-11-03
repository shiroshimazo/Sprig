import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HugeiconsIcon } from "@hugeicons/react";
import { CommandLineIcon, File01Icon, FolderOpenIcon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import ResizeHandle from "./ResizeHandle";
import FolderTree from "./FolderTree";
import CodeEditor from "./CodeEditor";
import "./App.css";

function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(22);
  const [terminalHeight, setTerminalHeight] = useState(28);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialogActive = useRef(false);
  const [fileContent, setFileContent] = useState("");
  const [currentContent, setCurrentContent] = useState("");
  const documents = useRef(new Map<string, { saved: string; current: string }>());
  const activePath = useRef<string | null>(null);
  const updateContent = useCallback((content: string) => {
    const document = activePath.current ? documents.current.get(activePath.current) : undefined;
    if (document) document.current = content;
    setCurrentContent(content);
  }, []);
  const isDirty = currentContent !== fileContent;
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const readRequest = useRef(0);
  const saving = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<{ path: string } | null>(null);
  const [promptPath, setPromptPath] = useState<string | null>(null);
  const prompt = useRef<HTMLDialogElement>(null);
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
    if (promptPath) prompt.current?.showModal();
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
          if (activePath.current === path) setCurrentContent(document.saved);
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

  async function openFile(path: string) {
    if (path !== activePath.current && !await confirmLeaving(activePath.current ? [activePath.current] : [])) return;
    const request = ++readRequest.current;
    setLoadingPath(path);
    setFileError(null);
    try {
      const cached = documents.current.get(path);
      const content = cached?.saved ?? await invoke<string>("read_file", { path });
      if (request !== readRequest.current) return;
      const document = cached ?? { saved: content, current: content };
      documents.current.set(path, document);
      activePath.current = path;
      setFilePath(path);
      setFileContent(content);
      setCurrentContent(document.current);
    } catch (error) {
      if (request === readRequest.current) {
        setFileError(`Cannot open ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (request === readRequest.current) setLoadingPath(null);
    }
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
      <header className="toolbar">
        <h1>Personal IDE</h1>
        <div className="file-actions" aria-label="File actions">
          <button disabled={!filePath || savePending} title="Save (Ctrl+S)" onClick={() => void saveFile()}>{savePending ? "Saving..." : "Save"}</button>
          <span title="Open file">
            <button disabled={dialogPending} aria-label="Open file" title="Open file" onClick={() => selectPath(false)}>
              <HugeiconsIcon icon={File01Icon} size={18} aria-hidden="true" focusable="false" />
              Open File
            </button>
          </span>
          <span title="Open folder">
            <button disabled={dialogPending} aria-label="Open folder" title="Open folder" onClick={() => selectPath(true)}>
              <HugeiconsIcon icon={FolderOpenIcon} size={18} aria-hidden="true" focusable="false" />
              Open Folder
            </button>
          </span>
          {dialogPending && <span className="toolbar-note" role="status">Dialog open…</span>}
        </div>
        <div className="panel-actions" aria-label="Panel visibility">
          <button
            aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            aria-controls="files-panel"
            aria-expanded={sidebarVisible}
            onClick={() => setSidebarVisible(!sidebarVisible)}
          >
            <HugeiconsIcon icon={SidebarLeftIcon} size={18} aria-hidden="true" focusable="false" />
          </button>
          <button
            aria-label={terminalVisible ? "Hide terminal" : "Show terminal"}
            title={terminalVisible ? "Hide terminal" : "Show terminal"}
            aria-controls="terminal-panel"
            aria-expanded={terminalVisible}
            onClick={() => setTerminalVisible(!terminalVisible)}
          >
            <HugeiconsIcon icon={CommandLineIcon} size={18} aria-hidden="true" focusable="false" />
          </button>
        </div>
      </header>

      {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
      <div className="workspace" style={{ gridTemplateColumns: sidebarVisible ? `${sidebarWidth}% 6px minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
        <aside id="files-panel" className="sidebar" hidden={!sidebarVisible} aria-labelledby="files-heading">
          <div className="panel-header">
            <h2 id="files-heading">Files</h2>
          </div>
          {folderPath ? <FolderTree key={folderPath} path={folderPath} activePath={filePath} onOpenFile={openFile} /> : <p className="sidebar-empty">No folder open.</p>}
        </aside>
        {sidebarVisible && <ResizeHandle panel="files-panel" label="Resize sidebar" orientation="vertical" value={sidebarWidth} onResize={setSidebarWidth} />}

        <main className="workbench" style={{ gridTemplateRows: terminalVisible ? `minmax(0, 1fr) 6px ${terminalHeight}%` : "minmax(0, 1fr)" }}>
          <section className="editor" aria-labelledby="editor-heading">
            <div className="panel-header">
              <h2 id="editor-heading">Editor</h2>
              <span className="selected-path" title={filePath ?? undefined}>{filePath ?? "No file open"}</span>
              {filePath && <span role="status">{isDirty ? "Unsaved changes" : "Unchanged"}</span>}
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
              <>
                <p className="file-message">Ctrl+S: save; Ctrl+Z: undo; Ctrl+Y: redo; Ctrl+F: find/replace. Closing the app discards unsaved edits.</p>
                <CodeEditor content={fileContent} path={filePath} onChange={updateContent} discarded={discarded} />
              </>
            ) : (
              <div className="editor-empty"><p>Select a file to get started.</p></div>
            )}
          </section>

          {terminalVisible && <ResizeHandle panel="terminal-panel" label="Resize terminal" orientation="horizontal" value={terminalHeight} onResize={setTerminalHeight} />}
          <section id="terminal-panel" className="terminal" hidden={!terminalVisible} aria-labelledby="terminal-heading">
            <div className="panel-header">
              <h2 id="terminal-heading">Terminal</h2>
              <span>Not connected</span>
            </div>
            <p className="terminal-empty">Shell connection is coming soon.</p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
