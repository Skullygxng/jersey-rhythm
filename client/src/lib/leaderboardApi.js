// Shared leaderboard client.
//
// A board needs somewhere to live. This module talks to the small JSON API that
// ships in `server/serve.js` (so `npm start` gives every player on that host the
// same board), and can be pointed at any other deployment from Settings.
// Everything degrades to the on-device board when no server is reachable.

import { getApiBase } from "./gameConfig.js";

const URL_KEY = "jr-leaderboard-url";
const ID_KEY = "jr-player-id";

function readLocal(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
}

function makeId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function getPlayerId() {
  let id = readLocal(ID_KEY);
  if (!id) {
    id = makeId();
    writeLocal(ID_KEY, id);
  }
  return id;
}

export function normaliseBase(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  const trimmed = value.replace(/\/+$/, "");
  if (/\/api$/i.test(trimmed)) return trimmed;
  return trimmed + "/api";
}

export function getBoardBaseUrl() {
  return readLocal(URL_KEY) || getApiBase();
}

export function setBoardBaseUrl(url) {
  const cleaned = String(url || "").trim();
  writeLocal(URL_KEY, cleaned);
  return cleaned;
}

function sameOriginBase() {
  try {
    if (!/^https?:$/i.test(window.location.protocol)) return "";
    return normaliseBase(window.location.origin);
  } catch {
    return "";
  }
}

function candidateBases() {
  const bases = [];
  const auto = getApiBase();
  if (auto) bases.push(auto);

  const configured = normaliseBase(readLocal(URL_KEY));
  if (configured && bases.indexOf(configured) === -1) bases.push(configured);

  const same = sameOriginBase();
  if (same && bases.indexOf(same) === -1) bases.push(same);
  return bases;
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("The board server returned something that is not JSON");
      }
    }
    if (!response.ok) {
      throw new Error(data.error || "Board request failed (" + response.status + ")");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function tryBases(run) {
  const bases = candidateBases();
  if (!bases.length) {
    return { ok: false, reason: "offline" };
  }
  let lastError = null;
  for (const base of bases) {
    try {
      const result = await run(base);
      return { ok: true, base, ...result };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, reason: "unreachable", error: errorMessage(lastError) };
}

function errorMessage(error) {
  if (!error) return "No board server";
  if (error.name === "AbortError") return "The board server timed out";
  return error.message || String(error);
}

export async function fetchLeaderboard({ songId, difficultyId, limit } = {}) {
  return tryBases(async (base) => {
    const params = new URLSearchParams();
    if (songId) params.set("songId", songId);
    if (difficultyId) params.set("difficultyId", difficultyId);
    params.set("limit", String(limit || 50));
    const data = await requestJson(base + "/leaderboard?" + params.toString());
    return { entries: Array.isArray(data.entries) ? data.entries : [] };
  });
}

export async function fetchBoardsIndex() {
  return tryBases(async (base) => {
    const data = await requestJson(base + "/boards");
    return { boards: Array.isArray(data.boards) ? data.boards : [] };
  });
}

export async function submitScore(entry, { playerName } = {}) {
  const payload = {
    playerId: getPlayerId(),
    playerName: playerName || "Player One",
    songId: entry.songId,
    songTitle: entry.songTitle,
    difficultyId: entry.difficultyId,
    difficultyLabel: entry.difficultyLabel,
    score: Math.round(Number(entry.score) || 0),
    accuracy: Math.round(Number(entry.accuracy) || 0),
    grade: entry.grade,
    maxCombo: Math.round(Number(entry.maxCombo) || 0),
    misses: Math.round(Number(entry.misses) || 0),
    chartSource: entry.chartSource || "auto",
    playedAt: entry.playedAt || new Date().toISOString()
  };

  return tryBases(async (base) => {
    const data = await requestJson(base + "/scores", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return {
      rank: data.rank || null,
      entries: Array.isArray(data.entries) ? data.entries : []
    };
  });
}

export function isSelf(entry) {
  return Boolean(entry && entry.playerId && entry.playerId === getPlayerId());
}

export const BOARD_SETUP_HINT =
  "Run `npm start` and everyone on that host shares the board, or paste a deployed API URL here.";
