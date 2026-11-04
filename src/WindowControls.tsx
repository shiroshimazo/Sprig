import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const glyphStroke = "rgba(0, 0, 0, 0.55)";

function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true" focusable="false">
      <path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke={glyphStroke} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true" focusable="false">
      <path d="M3 6H9" stroke={glyphStroke} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ZoomGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true" focusable="false">
      <path d="M3 6H9M6 3V9" stroke={glyphStroke} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const sync = () => void appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    sync();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void appWindow.onResized(sync)
      .then((stop) => { if (disposed) stop(); else unlisten = stop; })
      .catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  if (!isTauri()) return null;
  const appWindow = getCurrentWindow();

  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        type="button"
        className="traffic traffic--close"
        aria-label="Close window"
        title="Close"
        onClick={() => void appWindow.close().catch(() => {})}
      >
        <CloseGlyph />
      </button>
      <button
        type="button"
        className="traffic traffic--minimize"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void appWindow.minimize().catch(() => {})}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="traffic traffic--zoom"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        aria-pressed={isMaximized}
        title={isMaximized ? "Restore" : "Zoom"}
        onClick={() => void appWindow.toggleMaximize().catch(() => {})}
      >
        <ZoomGlyph />
      </button>
    </div>
  );
}
