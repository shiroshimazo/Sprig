import { isWindows } from "./lib/platform.ts";

export type WorkspaceFile = { path: string; relativePath: string };
export type QuickOpenFile = WorkspaceFile & { name: string };

export function quickOpenMatches(files: readonly WorkspaceFile[], query: string): QuickOpenFile[] {
  const windows = isWindows();
  const needle = (windows ? query.replace(/\\/g, "/") : query).trim().toLowerCase();
  const exact: QuickOpenFile[] = [];
  const prefix: QuickOpenFile[] = [];
  const filename: QuickOpenFile[] = [];
  const paths: QuickOpenFile[] = [];

  for (const file of files) {
    const relativePath = windows ? file.relativePath.replace(/\\/g, "/") : file.relativePath;
    const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const lowerName = name.toLowerCase();
    const match = { ...file, relativePath, name };
    if (lowerName === needle) exact.push(match);
    else if (lowerName.startsWith(needle)) prefix.push(match);
    else if (lowerName.includes(needle)) filename.push(match);
    else if (relativePath.toLowerCase().includes(needle)) paths.push(match);
  }

  return exact.concat(prefix, filename, paths);
}
