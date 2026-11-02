import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CommandLineIcon, File01Icon, FolderOpenIcon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import ResizeHandle from "./ResizeHandle";
import "./App.css";

function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(22);
  const [terminalHeight, setTerminalHeight] = useState(28);
  return (
    <div className="ide">
      <header className="toolbar">
        <h1>Personal IDE</h1>
        <div className="file-actions" aria-label="File actions">
          <span title="Open file — coming soon">
            <button disabled aria-label="Open file (coming soon)">
              <HugeiconsIcon icon={File01Icon} size={18} aria-hidden="true" focusable="false" />
              Open File
            </button>
          </span>
          <span title="Open folder — coming soon">
            <button disabled aria-label="Open folder (coming soon)">
              <HugeiconsIcon icon={FolderOpenIcon} size={18} aria-hidden="true" focusable="false" />
              Open Folder
            </button>
          </span>
          <span className="toolbar-note">Coming soon</span>
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

      <div className="workspace" style={{ gridTemplateColumns: sidebarVisible ? `${sidebarWidth}% 6px minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
        <aside id="files-panel" className="sidebar" hidden={!sidebarVisible} aria-labelledby="files-heading">
          <div className="panel-header">
            <h2 id="files-heading">Files</h2>
          </div>
          <p className="sidebar-empty">No folder open.</p>
        </aside>
        {sidebarVisible && <ResizeHandle panel="files-panel" label="Resize sidebar" orientation="vertical" value={sidebarWidth} onResize={setSidebarWidth} />}

        <main className="workbench" style={{ gridTemplateRows: terminalVisible ? `minmax(0, 1fr) 6px ${terminalHeight}%` : "minmax(0, 1fr)" }}>
          <section className="editor" aria-labelledby="editor-heading">
            <div className="panel-header">
              <h2 id="editor-heading">Editor</h2>
              <span>No file open</span>
            </div>
            <div className="editor-empty">
              <p>Your workspace is empty.</p>
              <p>File opening and editing are coming soon.</p>
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
