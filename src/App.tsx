import { useState } from "react";
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
          <button disabled title="File opening is coming soon">Open File</button>
          <button disabled title="Folder opening is coming soon">Open Folder</button>
          <span className="toolbar-note">Coming soon</span>
        </div>
        <div className="panel-actions" aria-label="Panel visibility">
          <button aria-controls="files-panel" aria-expanded={sidebarVisible} onClick={() => setSidebarVisible(!sidebarVisible)}>
            {sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          </button>
          <button aria-controls="terminal-panel" aria-expanded={terminalVisible} onClick={() => setTerminalVisible(!terminalVisible)}>
            {terminalVisible ? "Hide terminal" : "Show terminal"}
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
