import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Settings from "./Settings";
import { loadAndApplyTheme, watchTheme } from "./theme";
import "./index.css";

const params = new URLSearchParams(window.location.search);
loadAndApplyTheme();
watchTheme();

const isSettings = params.get("window") === "settings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSettings ? <Settings /> : <App />}
  </React.StrictMode>,
);
