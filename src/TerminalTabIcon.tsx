import { HugeiconsIcon } from "@hugeicons/react";
import { CommandLineIcon } from "@hugeicons/core-free-icons";
import { terminalIcons } from "./terminalIcons";
import type { TerminalIconId } from "./terminalIcons";

export default function TerminalTabIcon({ value = "terminal" }: {
  value?: TerminalIconId;
}) {
  const selected = terminalIcons.find(({ id }) => id === value) ?? terminalIcons[0];
  return (
    <span className="terminal-tab-icon" role="img" aria-label={selected.label} title={selected.label}>
      {selected.src ? (
        <img src={selected.src} width={14} height={14} alt="" />
      ) : (
        <HugeiconsIcon icon={CommandLineIcon} size={14} aria-hidden="true" focusable="false" />
      )}
    </span>
  );
}
