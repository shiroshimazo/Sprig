import { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";

export function createTerminalSnapshot(terminal: Terminal) {
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);

  // SerializeAddon saves mouse tracking but omits the encoding used for reports.
  let mouseEncoding: 1006 | 1016 | null = null;
  terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    for (const mode of params) {
      if (mode === 1006 || mode === 1016) mouseEncoding = mode;
    }
    return false;
  });
  terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    if (params.includes(1006) || params.includes(1016)) mouseEncoding = null;
    return false;
  });
  terminal.parser.registerEscHandler({ final: "c" }, () => {
    mouseEncoding = null;
    return false;
  });

  return () => serializer.serialize() + (mouseEncoding === null ? "" : `\x1b[?${mouseEncoding}h`);
}
