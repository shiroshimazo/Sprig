import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./SourceControl.css";

type Change = { path: string; original: string | null; index: string; worktree: string };
type Commit = { sha: string; subject: string; author: string; date: string };
type Snapshot = { branch: string; changes: Change[]; commits: Commit[] };
type Action = "stage" | "unstage" | "commit" | "push";

export function useSourceControl(path: string | null, active: boolean, onChanged?: () => void) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    if (!path || locked.current || mutating.current) return;
    const request = ++generation.current;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!isTauri()) throw new Error("Open the desktop app to use Source Control.");
      const result = await invoke<Snapshot>("git_snapshot", { path });
      if (request === generation.current) setData(result);
    } catch (error) {
      if (request === generation.current) { setError(String(error)); setData(null); }
    } finally {
      if (request === generation.current) { locked.current = false; setBusy(false); }
    }
  }, [path]);
  useEffect(() => {
    generation.current++;
    locked.current = false;
    setData(null);
    setError(null);
    setNotice("");
    setBusy(false);
    if (active) void refresh();
    return () => { generation.current++; };
  }, [path, active, refresh]);
  useEffect(() => {
    if (!active) return;
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [active, refresh]);
  const act = async (action: Action, file?: string, message?: string) => {
    if (!path || locked.current || mutating.current) return false;
    const request = ++generation.current;
    locked.current = true;
    mutating.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    let succeeded = false;
    try {
      await invoke("git_action", { path, action, file, message });
      succeeded = true;
      if (request === generation.current) {
        setNotice(action === "commit" ? "Commit created." : action === "push" ? "Push completed." : "Staging updated.");
        const result = await invoke<Snapshot>("git_snapshot", { path });
        if (request === generation.current) setData(result);
      }
      // The files changed their commit state, so the file tree has to be
      // marked again.
      onChanged?.();
    } catch (error) {
      if (request === generation.current) setError(String(error));
    } finally {
      mutating.current = false;
      if (request === generation.current) { locked.current = false; setBusy(false); }
    }
    return succeeded && request === generation.current;
  };
  return { data, error, busy, notice, refresh, act };
}

type Control = ReturnType<typeof useSourceControl>;

export function SourceControl({ control, path }: { control: Control; path: string | null }) {
  const [message, setMessage] = useState("");
  const { data, busy, error, notice, act, refresh } = control;
  useEffect(() => { setMessage(""); }, [path]);
  if (!path) return <p className="sidebar-empty">Open a repository folder to see Source Control.</p>;
  const staged = data?.changes.filter((file) => file.index !== " " && file.index !== "?") ?? [];
  const unstaged = data?.changes.filter((file) => file.worktree !== " ") ?? [];
  const commit = async () => { if (await act("commit", undefined, message)) setMessage(""); };
  return <div className="source-control" aria-busy={busy}>
    <div className="source-toolbar"><strong title={data?.branch}>{data?.branch ?? "Repository"}</strong><button disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
    {error && <p className="source-error" role="alert">{error}</p>}
    <p className="source-status" role="status">{busy ? "Working…" : notice}</p>
    {data && <>
      <label htmlFor="commit-message">Commit message</label>
      <textarea id="commit-message" value={message} disabled={busy} placeholder="Describe your changes" onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && staged.length && message.trim() && !busy) { event.preventDefault(); void commit(); }
      }} />
      <div className="source-actions"><button disabled={busy || !staged.length || !message.trim()} onClick={() => void commit()}>Commit staged</button><button disabled={busy || !data.commits.length} onClick={() => void act("push")}>Push</button></div>
      <p className="source-hint">Saved files only. Ctrl+Enter commits staged changes.</p>
      {[{ title: "Staged changes", files: staged, action: "unstage" as const }, { title: "Changes", files: unstaged, action: "stage" as const }].map((group) => <section key={group.title}>
        <h3>{group.title} <span>{group.files.length}</span></h3>
        <ul>{group.files.map((file) => <li key={file.path}>
          <span className="source-file" title={file.original ? `${file.original} → ${file.path}` : file.path}>{file.path}</span>
          <code title="Git file status">{group.action === "stage" ? file.worktree : file.index}</code>
          <button disabled={busy} aria-label={`${group.action === "stage" ? "Stage" : "Unstage"} ${file.path}`} onClick={() => void act(group.action, file.path)}>{group.action === "stage" ? "+" : "−"}</button>
        </li>)}</ul>
      </section>)}
      {!data.changes.length && <p className="source-clean">Working tree clean</p>}
    </>}
  </div>;
}

export function CommitHistory({ control }: { control: Control }) {
  const { data } = control;
  return <section className="commit-history" aria-label="Commit history">
    <div className="panel-header"><h2>Commit History</h2><span className="source-hint">{data?.branch} · latest 100 commits</span></div>
    {!data ? <p className="sidebar-empty">Select a repository to load history.</p> : !data.commits.length ? <p className="sidebar-empty">No commits yet.</p> : <div className="commit-scroll"><table>
      <thead><tr><th scope="col">SHA</th><th scope="col">Subject</th><th scope="col">Author</th><th scope="col">Date</th></tr></thead>
      <tbody>{data.commits.map((commit) => <tr key={commit.sha}>
        <td><code title={commit.sha}>{commit.sha.slice(0, 7)}</code></td><td>{commit.subject}</td><td>{commit.author}</td><td><time dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
