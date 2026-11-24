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

function CaptionGlyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" />
    </svg>
  );
}

export default function WindowControls({ windows }: { windows: boolean }) {
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

  const close = (
    <button
      type="button"
      className={windows ? "caption-button caption-button--close" : "traffic traffic--close"}
      aria-label="Close window"
      title="Close"
      onClick={() => void appWindow.close().catch(() => {})}
    >
      {windows ? <CaptionGlyph path="M2 2L10 10M10 2L2 10" /> : <CloseGlyph />}
    </button>
  );

  return (
    <div className={windows ? "window-controls window-controls--windows" : "window-controls"} aria-label="Window controls">
      {!windows && close}
      <button
        type="button"
        className={windows ? "caption-button" : "traffic traffic--minimize"}
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void appWindow.minimize().catch(() => {})}
      >
        {windows ? <CaptionGlyph path="M1 6H11" /> : <MinimizeGlyph />}
      </button>
      <button
        type="button"
        className={windows ? "caption-button" : "traffic traffic--zoom"}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        aria-pressed={isMaximized}
        title={isMaximized ? "Restore" : windows ? "Maximize" : "Zoom"}
        onClick={() => void appWindow.toggleMaximize().catch(() => {})}
      >
        {windows ? <CaptionGlyph path={isMaximized ? "M1.5 3.5H8.5V10.5H1.5ZM3.5 3.5V1.5H10.5V8.5H8.5" : "M1.5 1.5H10.5V10.5H1.5Z"} /> : <ZoomGlyph />}
      </button>
      {windows && close}
    </div>
  );
}
