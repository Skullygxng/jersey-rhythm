// A small ring buffer of the errors the game has hit on this device.
//
// On a phone there is no console to read, so a crash or a failed resource
// disappears. This keeps the last few and shows them in Settings → Diagnostics,
// where they can be copied into a bug report.
const MAX_ENTRIES = 40;
const entries = [];
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(entries.length);
    } catch {
      /* a bad subscriber must not break logging */
    }
  });
}

function describe(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value.message) return value.message;
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return String(value);
  }
}

export function pushError(source, message, detail) {
  const entry = {
    time: new Date().toISOString().slice(11, 19),
    source: String(source || "error"),
    message: describe(message).slice(0, 600),
    detail: detail ? String(detail).slice(0, 1200) : ""
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  notify();
  return entry;
}

export function getErrorLog() {
  return entries.slice();
}

export function subscribeErrorLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearErrorLog() {
  entries.length = 0;
  notify();
}

export function formatErrorLog() {
  if (!entries.length) return "";
  return entries
    .map(
      (entry) =>
        entry.time +
        " [" +
        entry.source +
        "] " +
        entry.message +
        (entry.detail ? "\n" + entry.detail : "")
    )
    .join("\n\n");
}

/** Hooks the browser's error channels once. Safe to call more than once. */
export function installErrorLog() {
  if (typeof window === "undefined" || window.__jrErrorLogInstalled) return;
  window.__jrErrorLogInstalled = true;

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target && target !== window && target.tagName) {
        pushError("resource", target.tagName + " failed to load", target.currentSrc || target.src || "");
        return;
      }
      pushError("error", event.message, event.error && event.error.stack);
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const name = reason && reason.name;
    // Autoplay blocks and aborted fetches are expected in normal play.
    if (name === "NotAllowedError" || name === "AbortError") return;
    pushError("promise", reason, reason && reason.stack);
  });

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    pushError("console", args.map(describe).join(" "));
    originalError(...args);
  };
}
