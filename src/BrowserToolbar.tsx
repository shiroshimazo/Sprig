import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowLeft01Icon, ArrowRight01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import WindowControls from "./WindowControls";
import "./BrowserToolbar.css";

type BrowserAction =
  | { type: "back" | "forward" | "reload" }
  | { type: "navigate"; input: string };

export default function BrowserToolbar() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const editing = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = (url: string | null) => {
      if (!disposed && url && !editing.current) {
        setAddress(url);
        setError("");
      }
    };
    void getCurrentWebview().listen<string>("browser-address", ({ payload }) => update(payload))
      .then(async (stop) => {
        if (disposed) { stop(); return; }
        unlisten = stop;
        update(await invoke<string | null>("browser_control", { action: { type: "address" } }));
      })
      .catch((cause) => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  function run(action: BrowserAction) {
    editing.current = false;
    setError("");
    void invoke("browser_control", { action }).catch((cause) => setError(String(cause)));
  }

  return <header className="browser-toolbar" aria-label="Browser controls">
    <WindowControls />
    <div className="browser-navigation">
      <button type="button" aria-label="Back" title="Back" onClick={() => run({ type: "back" })}>
        <HugeiconsIcon icon={ArrowLeft01Icon} size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Forward" title="Forward" onClick={() => run({ type: "forward" })}>
        <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Reload" title="Reload" onClick={() => run({ type: "reload" })}>
        <HugeiconsIcon icon={RefreshIcon} size={15} aria-hidden="true" />
      </button>
    </div>
    <form className="browser-address" onSubmit={(event) => {
      event.preventDefault();
      if (address.trim()) run({ type: "navigate", input: address });
    }}>
      <input
        aria-label="Search or enter address"
        aria-describedby={error ? "browser-address-error" : undefined}
        placeholder="Search or enter address"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        value={address}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => { editing.current = true; setAddress(event.target.value); setError(""); }}
      />
      {error && <span id="browser-address-error" className="browser-address-error" role="alert">{error}</span>}
    </form>
    <div className="browser-drag" data-tauri-drag-region aria-hidden="true" />
  </header>;
}
