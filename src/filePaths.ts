import { isWindows } from "./lib/platform.ts";

// The file tree compares paths that come from different sources: the backend
// lists folders with canonical Windows paths ("\\?\C:\..."), while the OS
// watcher reports plain absolute paths. Both are brought into one shape
// before they are compared.

const UNC_PREFIX = "\\\\?\\UNC\\";
const LONG_PREFIX = "\\\\?\\";
const DRIVE_ROOT = /^[a-zA-Z]:$/;

export function stripVerbatimPrefix(path: string): string {
  if (path.slice(0, UNC_PREFIX.length).toUpperCase() === UNC_PREFIX) {
    return `\\\\${path.slice(UNC_PREFIX.length)}`;
  }
  return path.startsWith(LONG_PREFIX) ? path.slice(LONG_PREFIX.length) : path;
}

export function fileName(path: string): string {
  return path.split(isWindows() ? /[\\/]/ : "/").pop() ?? path;
}

/**
 * Brings a path into one comparable shape: the "\\?\" prefix Windows APIs
 * add is stripped, "/" becomes "\", trailing separators are dropped (a drive
 * root keeps its separator) and the result is lower cased on Windows.
 */
export function normalizePath(value: string): string {
  const windows = isWindows();
  if (!windows && value.startsWith("/")) return value.replace(/\/+$/, "") || "/";
  const text = stripVerbatimPrefix(value).replace(/\//g, "\\");
  const trimmed = text.replace(/\\+$/, "");
  // "C:" on its own means "the current folder on drive C", so a drive root
  // keeps its separator.
  const result = DRIVE_ROOT.test(trimmed) ? `${trimmed}\\` : trimmed;
  return windows ? result.toLowerCase() : result;
}

/**
 * True when the target is the folder itself or a path inside it.
 */
export function isInsideFolder(folder: string, target: string): boolean {
  const base = normalizePath(folder);
  const child = normalizePath(target);
  if (!base || !child) return false;
  if (child === base) return true;
  // The separator stops "C:\proj" from matching "C:\project".
  const separator = base.startsWith("/") ? "/" : "\\";
  return child.startsWith(base.endsWith(separator) ? base : `${base}${separator}`);
}
