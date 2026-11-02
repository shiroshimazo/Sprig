import "./App.css";

function App() {
  return (
    <div className="ide">
      <header className="toolbar">
        <h1>Personal IDE</h1>
        <div className="file-actions" aria-label="File actions">
          <button disabled title="File opening is coming soon">Open File</button>
          <button disabled title="Folder opening is coming soon">Open Folder</button>
          <span className="toolbar-note">Coming soon</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-labelledby="files-heading">
          <div className="panel-header">
            <h2 id="files-heading">Files</h2>
          </div>
          <p className="sidebar-empty">No folder open.</p>
        </aside>

        <main className="workbench">
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

          <section className="terminal" aria-labelledby="terminal-heading">
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
