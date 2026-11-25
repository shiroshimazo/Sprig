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

type IconStyle = readonly [icon: typeof File01Icon, color: string];

const configFile = [FileCogIcon, "#a6b5cc"] as const;
const scriptFile = [TerminalIcon, "#85c97a"] as const;
const gitFile = [GitBranchIcon, "#f17c60"] as const;

const types = [
  [Html5Icon, "#e34f26", ["html", "htm", "xhtml"]],
  [Css3Icon, "#75aaff", ["css", "scss", "sass", "less"]],
  [JavaScriptIcon, "#f7df1e", ["js", "mjs", "cjs"]],
  [Typescript01Icon, "#4ba0ee", ["ts", "mts", "cts"]],
  [ReactIcon, "#61dafb", ["jsx", "tsx"]],
  [PythonIcon, "#ffd343", ["py", "pyw", "pyi"]],
  [JavaIcon, "#ff9966", ["java"]],
  [PhpIcon, "#b4a7eb", ["php"]],
  [SqlIcon, "#6ed4c0", ["sql"]],
  [FileCodeIcon, "#ef956c", ["rs", "swift"]],
  [FileCodeIcon, "#61c7de", ["go", "c", "cpp", "h", "hpp"]],
  [FileCodeIcon, "#c395ed", ["cs", "kt"]],
  [FileCodeIcon, "#f17c86", ["rb"]],
  [...scriptFile, ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]],
  [FileBracesIcon, "#e8ca78", ["json", "jsonc", "json5"]],
  [Xml01Icon, "#e2a471", ["xml"]],
  [...configFile, ["yml", "yaml", "toml", "ini", "cfg", "conf", "lock"]],
  [FileTextIcon, "#8bbbe8", ["md", "mdx", "txt", "rst", "log"]],
  [Pdf01Icon, "#f17c86", ["pdf"]],
  [FileSpreadsheetIcon, "#6bc99c", ["csv", "tsv", "xls", "xlsx", "ods"]],
  [FileImageIcon, "#a9a0f5", ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif"]],
  [FileAudioIcon, "#e3a0cd", ["mp3", "wav", "ogg", "flac", "m4a"]],
  [FileVideoIcon, "#c395ed", ["mp4", "webm", "mov", "mkv"]],
  [FileZipIcon, "#d7b07a", ["zip", "tar", "gz", "7z", "rar"]],
] as const;

const stylesByExtension = new Map<string, IconStyle>(
  types.flatMap(([icon, color, extensions]) => extensions.map((extension) => [extension, [icon, color]] as const)),
);

const stylesByName = new Map<string, IconStyle>([
  [".git", gitFile],
  [".gitignore", gitFile],
  [".gitattributes", gitFile],
  [".gitmodules", gitFile],
  [".env", configFile],
  ["dockerfile", configFile],
  ["makefile", scriptFile],
  ["license", [LicenseIcon, "#d7b07a"]],
]);

export default function FileTypeIcon({ name }: { name: string }) {
  const filename = name.toLowerCase();
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot + 1) : "";
  const [icon, color] = stylesByName.get(filename)
    ?? (filename.startsWith(".env.") ? configFile : stylesByExtension.get(extension))
    ?? [File01Icon, "currentColor"];

  return <HugeiconsIcon icon={icon} color={color} size={13} aria-hidden="true" focusable="false" />;
}
