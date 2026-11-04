import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/cascadia-mono/latin-400.css";
import "@fontsource/cascadia-mono/latin-600.css";
import "@fontsource/cascadia-code/latin-400.css";
import "@fontsource/cascadia-code/latin-400-italic.css";
import "@fontsource/cascadia-code/latin-600.css";
import "@fontsource/cascadia-code/latin-600-italic.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
