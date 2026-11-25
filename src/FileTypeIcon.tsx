import {
  Css3Icon,
  File01Icon,
  FileAudioIcon,
  FileBracesIcon,
  FileCodeIcon,
  FileCogIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  FileZipIcon,
  GitBranchIcon,
  Html5Icon,
  JavaIcon,
  JavaScriptIcon,
  LicenseIcon,
  Pdf01Icon,
  PhpIcon,
  PythonIcon,
  ReactIcon,
  SqlIcon,
  TerminalIcon,
  Typescript01Icon,
  Xml01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const types = [
  [Html5Icon, ["html", "htm", "xhtml"]],
  [Css3Icon, ["css", "scss", "sass", "less"]],
  [JavaScriptIcon, ["js", "mjs", "cjs"]],
  [Typescript01Icon, ["ts", "mts", "cts"]],
  [ReactIcon, ["jsx", "tsx"]],
  [PythonIcon, ["py", "pyw", "pyi"]],
  [JavaIcon, ["java"]],
  [PhpIcon, ["php"]],
  [SqlIcon, ["sql"]],
  [FileCodeIcon, ["rs", "go", "c", "cpp", "h", "hpp", "cs", "rb", "swift", "kt"]],
  [TerminalIcon, ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]],
  [FileBracesIcon, ["json", "jsonc", "json5"]],
  [Xml01Icon, ["xml"]],
  [FileCogIcon, ["yml", "yaml", "toml", "ini", "cfg", "conf", "lock"]],
  [FileTextIcon, ["md", "mdx", "txt", "rst", "log"]],
  [Pdf01Icon, ["pdf"]],
  [FileSpreadsheetIcon, ["csv", "tsv", "xls", "xlsx", "ods"]],
  [FileImageIcon, ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif"]],
  [FileAudioIcon, ["mp3", "wav", "ogg", "flac", "m4a"]],
  [FileVideoIcon, ["mp4", "webm", "mov", "mkv"]],
  [FileZipIcon, ["zip", "tar", "gz", "7z", "rar"]],
] as const;

const iconsByExtension = new Map<string, typeof File01Icon>(
  types.flatMap(([icon, extensions]) => extensions.map((extension) => [extension, icon] as const)),
);

const iconsByName = new Map<string, typeof File01Icon>([
  [".gitignore", GitBranchIcon],
  [".gitattributes", GitBranchIcon],
  [".gitmodules", GitBranchIcon],
  [".env", FileCogIcon],
  ["dockerfile", FileCogIcon],
  ["makefile", TerminalIcon],
  ["license", LicenseIcon],
]);

export default function FileTypeIcon({ name }: { name: string }) {
  const filename = name.toLowerCase();
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot + 1) : "";
  const icon = iconsByName.get(filename)
    ?? (filename.startsWith(".env.") ? FileCogIcon : iconsByExtension.get(extension))
    ?? File01Icon;

  return <HugeiconsIcon icon={icon} size={13} aria-hidden="true" focusable="false" />;
}
