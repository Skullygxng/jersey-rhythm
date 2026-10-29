import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./client/src/app/App.jsx";
import ErrorBoundary from "./client/src/app/ErrorBoundary.jsx";
import { installErrorLog } from "./client/src/lib/errorLog.js";

installErrorLog();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);