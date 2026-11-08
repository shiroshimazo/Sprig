import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/cascadia-mono/latin-400.css";
import "@fontsource/cascadia-mono/latin-600.css";
import "@fontsource/cascadia-code/latin-400.css";
import "@fontsource/cascadia-code/latin-400-italic.css";
import "@fontsource/cascadia-code/latin-600.css";
import "@fontsource/cascadia-code/latin-600-italic.css";
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
