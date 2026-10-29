// Zero-build module loader: fetches the source files as text, transforms
// JSX with the vendored Babel build, rewrites import specifiers to blob
// URLs and executes the graph as native ES modules. Every import — bare
// ones included — is pre-fetched and served from blobs, so the engine
// itself never performs a module fetch from the network or disk.
const JSX_URLS = [".jsx"];

const BARE_MAP = {
  "react": "./vendor/react.js",
  "react/jsx-runtime": "./vendor/jsx-runtime.js",
  "react/jsx-dev-runtime": "./vendor/jsx-runtime.js",
  "react-dom": "./vendor/react-dom.js",
  "react-dom/client": "./vendor/react-dom.js",
  "react-router-dom": "./vendor/react-router-dom.js",
  "socket.io-client": "./vendor/socket-io-client.js"
};

const moduleCache = new Map();

const IMPORT_RE = /((?:\bfrom\s*|\bimport\s*\(\s*))(["'])([^"'\n]+)\2/g;

const statusEl = document.getElementById("root");
let lastModule = "startup";
let watchdogTimer = null;

function setStatus(text) {
  if (statusEl) {
    statusEl.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;color:#b7bfd9;font-family:system-ui;font-size:15px;gap:8px">' +
      text +
      "</div>";
  }
}

let errorBox = null;

function showError(detail) {
  // One box, reused: a repeating failure used to stack a new full-screen
  // overlay for every rejection until the page was a wall of red.
  if (!errorBox || !errorBox.isConnected) {
    errorBox = document.createElement("div");
    errorBox.style.cssText =
      "position:fixed;inset:0;z-index:9999;overflow:auto;background:rgba(3,4,12,0.96);color:#ff9ed6;padding:20px;font-family:monospace;font-size:12px;white-space:pre-wrap";
    document.body.appendChild(errorBox);
  }
  errorBox.textContent = String(detail);
}

function showStuck() {
  setStatus(
    "Still loading after 12s (stuck on: " + lastModule + ") — restart the page; if it repeats, report this line."
  );
}

window.addEventListener("error", (event) => {
  const detail = (event.error && (event.error.message + "\n" + event.error.stack)) || event.message;
  console.error("[boot error]", detail);
  const m = /blob:[^\s)"']+/.exec(detail);
  const hit = m && blobRegistry.find((r) => r.blobUrl === m[0]);
  if (hit) {
    console.error("[failing module]", hit.url, "\n[head]", hit.code.slice(0, 400));
  }
  showError("Error: " + detail + (hit ? "\n\n[failing module]\n" + hit.url + "\n\n[head]\n" + hit.code.slice(0, 400) : ""));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const name = reason && reason.name;
  // Blocked autoplay and aborted requests happen in normal play, not at boot.
  if (name === "NotAllowedError" || name === "AbortError") return;
  const detail = (reason && (reason.message + "\n" + reason.stack)) || String(reason);
  showError("Rejection: " + detail + "\n\n(last module: " + lastModule + ")");
});

setStatus("Loading Jersey Rhythm…");

const blobRegistry = [];

async function toBlobUrl(url) {
  if (moduleCache.has(url)) return moduleCache.get(url);

  const promise = (async () => {
    lastModule = url.split("/").pop() || url;
    setStatus("Loading " + lastModule + "…");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Cannot load " + url + " (" + response.status + ")");
    }

    let code = await response.text();

    if (JSX_URLS.some((suffix) => url.endsWith(suffix))) {
      if (!window.Babel) {
        throw new Error("Babel did not load; JSX cannot be transformed.");
      }
      setStatus("Preparing game code…");
      code = window.Babel.transform(code, {
        presets: [["react", { runtime: "classic" }]],
        filename: url.split("/").pop() || "module.jsx"
      }).code;
    }

    const pending = [];
    code.replace(IMPORT_RE, (match, prefix, quote, spec) => {
      let depUrl = null;
      if (BARE_MAP[spec]) {
        depUrl = new URL(BARE_MAP[spec], location.href).href;
      } else if (spec.startsWith(".") || spec.startsWith("/")) {
        depUrl = new URL(spec, url).href;
      }
      if (depUrl) pending.push([spec, depUrl]);
      return match;
    });

    const resolved = {};
    await Promise.all(pending.map(async ([spec, depUrl]) => {
      resolved[spec] = await toBlobUrl(depUrl);
    }));

    code = code.replace(IMPORT_RE, (match, prefix, quote, spec) => {
      if (Object.prototype.hasOwnProperty.call(resolved, spec)) {
        return prefix + quote + resolved[spec] + quote;
      }
      if (BARE_MAP[spec] || spec.startsWith(".") || spec.startsWith("/")) {
        console.warn("[unresolved import]", url, "->", spec);
      }
      return match;
    });

    const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    blobRegistry.push({ blobUrl, url, code });
    console.log("[module]", url.split("/").pop() || url, code.length + " chars");
    return blobUrl;
  })();

  moduleCache.set(url, promise);
  return promise;
}

try {
  const entryUrl = new URL("./entry.jsx", location.href).href;
  const entryBlobUrl = await toBlobUrl(entryUrl);
  setStatus("Starting…");
  lastModule = "entry evaluation";

  watchdogTimer = setTimeout(showStuck, 12000);

  await import(entryBlobUrl);

  clearTimeout(watchdogTimer);
} catch (error) {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  let detail = (error && error.stack) || String(error);
  const m = /blob:[^\s)"']+[)]?/.exec(detail);
  if (m) {
    const clean = m[0].replace(/[:)]+$/, "");
    const hit = blobRegistry.find((r) => r.blobUrl === clean);
    if (hit) {
      detail +=
        "\n\n──── failed module ────\n" +
        hit.url +
        "\n\n──── source head ────\n" +
        hit.code.slice(0, 500);
      console.error("[failing module]", hit.url);
      console.error("[source head]", hit.code.slice(0, 500));
    }
  }
  showError(detail);
  console.error(error);
}