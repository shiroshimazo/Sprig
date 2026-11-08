export const terminalIcons = [
  { id: "terminal", label: "Terminal", src: null },
  { id: "codex", label: "Codex", src: "/terminal-icons/codex.svg" },
  { id: "claude-code", label: "Claude Code", src: "/terminal-icons/claudecode.svg" },
  { id: "antigravity", label: "Antigravity", src: "/terminal-icons/antigravity.svg" },
  { id: "opencode", label: "OpenCode", src: "/terminal-icons/opencode.svg" },
] as const;

export type TerminalIconId = typeof terminalIcons[number]["id"];

export function isTerminalIcon(value: unknown): value is TerminalIconId {
  return terminalIcons.some(({ id }) => id === value);
}
