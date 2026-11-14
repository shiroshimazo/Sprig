// The file tree compares paths that come from different sources: the backend
// lists folders with canonical Windows paths ("\\?\C:\..."), while the OS
// watcher reports plain absolute paths. Both are brought into one shape
// before they are compared.

const UNC_PREFIX = "\\\\?\\UNC\\";
const LONG_PREFIX = "\\\\?\\";
const DRIVE_ROOT = /^[a-zA-Z]:$/;

// `process` does not exist in the browser context of the Tauri webview, so
// the platform check has to survive an undefined global.
declare const process: { platform?: string } | undefined;

function isWindows(): boolean {
  if (typeof process !== "undefined" && process.platform) return process.platform === "win32";
  // Without `process` the user agent is the only hint left.
  return typeof navigator !== "undefined" && /win/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

/**
 * Brings a path into one comparable shape: the "\\?\" prefix Windows APIs
 * add is stripped, "/" becomes "\", trailing separators are dropped (a drive
 * root keeps its separator) and the result is lower cased on Windows.
 */
export function normalizePath(value: string): string {
  let text = value.trim();
  if (text.slice(0, UNC_PREFIX.length).toUpperCase() === UNC_PREFIX) {
    // "\\?\UNC\server\share" is the long form of "\\server\share".
    text = `\\\\${text.slice(UNC_PREFIX.length)}`;
  } else if (text.startsWith(LONG_PREFIX)) {
    text = text.slice(LONG_PREFIX.length);
  }
  text = text.replace(/\//g, "\\");
  const trimmed = text.replace(/\\+$/, "");
  // "C:" on its own means "the current folder on drive C", so a drive root
  // keeps its separator.
  const result = DRIVE_ROOT.test(trimmed) ? `${trimmed}\\` : trimmed;
  return isWindows() ? result.toLowerCase() : result;
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
  return child.startsWith(base.endsWith("\\") ? base : `${base}\\`);
}
