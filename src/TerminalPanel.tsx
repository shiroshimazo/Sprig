import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPanel() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const terminal = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: false,
      disableStdin: true,
      screenReaderMode: true,
      theme: {
        background: "#090909",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#404040",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    terminal.writeln("Shell not connected. Terminal setup is in progress.");
    let disposed = false;
    const resize = () => {
      if (!disposed && element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    void document.fonts.ready.then(resize);
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
      terminal.dispose();
    };
  }, []);

  return <div ref={container} className="terminal-content" aria-label="Terminal output" />;
}
