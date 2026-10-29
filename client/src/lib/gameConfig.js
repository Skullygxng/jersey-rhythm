// Where the shared services live.
//
// Precedence: window.__JR_CONFIG__ (written by scripts/writeConfig.js at build
// time, or client/config.js in dev) -> a saved override from Settings -> same
// origin when served over http(s).
//
// No import.meta here on purpose: the in-app zero-build host pre-transforms
// modules and rejects import.meta, which used to break boot.

const CONFIG =
  typeof window !== "undefined" && window.__JR_CONFIG__ ? window.__JR_CONFIG__ : {};

const API_KEY = "jr-leaderboard-url";

function trimBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function asApiBase(value) {
  const base = trimBase(value);
  if (!base) return "";
  return /\/api$/i.test(base) ? base : base + "/api";
}

export function getApiBase() {
  const configured = trimBase(CONFIG.apiBase);
  if (configured) return asApiBase(configured);

  // The board URL saved from Settings wins over this origin: it is the one
  // place the player says where their server lives.
  try {
    const saved = trimBase(localStorage.getItem(API_KEY));
    if (saved) return asApiBase(saved);
  } catch {
    /* storage is optional */
  }

  if (typeof window !== "undefined" && /^https?:$/i.test(window.location.protocol)) {
    return trimBase(window.location.origin) + "/api";
  }

  return "";
}

export function getSocketUrl() {
  const configured = trimBase(CONFIG.socketUrl);
  if (configured) return configured;

  const api = getApiBase();
  if (api) return api.replace(/\/api$/i, "");

  return "";
}

export function isSharedServerConfigured() {
  return Boolean(getApiBase());
}

/**
 * Where audio/video/covers are served from, when they are not on this origin.
 * Points at the folder that *is* `media/` (the one holding `imports/`), e.g.
 * "https://your-name.github.io/jersey-media". Empty means same origin.
 */
export function getMediaBase() {
  return trimBase(CONFIG.mediaBase);
}

/** True for an audio-only build (videos omitted to fit a small host). */
export function isAudioOnly() {
  return CONFIG.mediaMode === "audio";
}
