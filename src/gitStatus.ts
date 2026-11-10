import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type GitStatusEntry = { path: string; index: string; worktree: string };

// Lists the absolute paths of the files that have changes which are not
// committed yet. The list is refreshed when the folder changes, when the
// caller bumps the revision, and when the window regains focus so changes
// made outside the app show up too.
export function useGitStatus(path: string | null, revision: number): string[] {
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [focused, setFocused] = useState(0);
  useEffect(() => {
    const onFocus = () => setFocused((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!path || !isTauri()) {
      setEntries([]);
      return;
    }
    let disposed = false;
    void invoke<GitStatusEntry[]>("git_status", { path })
      .then((result) => { if (!disposed) setEntries(result); })
      .catch(() => { if (!disposed) setEntries([]); });
    return () => { disposed = true; };
  }, [path, revision, focused]);
  return useMemo(() => entries.map((entry) => entry.path), [entries]);
}
