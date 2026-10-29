const SCORES_KEY = "jersey-rhythm-scores-v1";
const PROFILE_KEY = "jersey-rhythm-profile-v1";
const MAX_SCORES = 500;

function readJson(key, fallback) {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function loadScores() {
  const value = readJson(SCORES_KEY, []);
  return Array.isArray(value) ? value : [];
}

export function saveScoreEntry(entry) {
  const scores = loadScores();
  scores.push(entry);
  // Keep localStorage bounded: a long session must not hit the quota.
  const trimmed = scores.length > MAX_SCORES ? scores.slice(-MAX_SCORES) : scores;
  writeJson(SCORES_KEY, trimmed);
  return trimmed;
}

export function loadProfileSettings() {
  const value = readJson(PROFILE_KEY, null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { username: "Player One" };
  }
  return { username: "Player One", ...value };
}

export function saveProfileSettings(settings) {
  writeJson(PROFILE_KEY, settings);
}
