import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./app/App";
import ErrorBoundary from "./app/ErrorBoundary.jsx";
import { installErrorLog } from "./lib/errorLog.js";
import "./styles.css";

installErrorLog();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </React.StrictMode>
);
