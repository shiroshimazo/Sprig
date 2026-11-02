import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { CommandLineIcon, File01Icon, FolderOpenIcon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import ResizeHandle from "./ResizeHandle";
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
          setFolderPath(selected);
          setSidebarVisible(true);
        } else {
          setFilePath(selected);
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
      <header className="toolbar">
        <h1>Personal IDE</h1>
        <div className="file-actions" aria-label="File actions">
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
          <div className="sidebar-empty">
            <p className="selected-path" title={folderPath ?? undefined}>{folderPath ?? "No folder open."}</p>
            {folderPath && <p>Folder browsing is coming soon.</p>}
          </div>
        </aside>
        {sidebarVisible && <ResizeHandle panel="files-panel" label="Resize sidebar" orientation="vertical" value={sidebarWidth} onResize={setSidebarWidth} />}

        <main className="workbench" style={{ gridTemplateRows: terminalVisible ? `minmax(0, 1fr) 6px ${terminalHeight}%` : "minmax(0, 1fr)" }}>
          <section className="editor" aria-labelledby="editor-heading">
            <div className="panel-header">
              <h2 id="editor-heading">Editor</h2>
              <span className="selected-path" title={filePath ?? undefined}>{filePath ?? "No file open"}</span>
            </div>
            <div className="editor-empty">
              <p>{filePath ? "File selected." : "Select a file to get started."}</p>
              <p>File reading and editing are coming soon.</p>
            </div>
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
