import React from "react";
import ReactDOM from "react-dom/client";
// The full subset sets are needed so box drawing and block characters (U+2500-259F)
// come from Cascadia itself. The latin-only files leave them to a fallback font whose
// metrics differ from the terminal cell, which breaks block art.
import "@fontsource/cascadia-mono/400.css";
import "@fontsource/cascadia-mono/600.css";
import "@fontsource/cascadia-code/400.css";
import "@fontsource/cascadia-code/400-italic.css";
import "@fontsource/cascadia-code/600.css";
import "@fontsource/cascadia-code/600-italic.css";
import App from "./App";
import DetachedTerminal from "./DetachedTerminal";
import { installInputCarets } from "./smoothCaret";
import "./smoothCaret.css";

const stopInputCarets = installInputCarets();
if (import.meta.hot) import.meta.hot.dispose(stopInputCarets);

const detached = new URLSearchParams(window.location.search).get("detached");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detached ? <DetachedTerminal /> : <App />}
  </React.StrictMode>,
);
