import { getMediaBase } from "../lib/gameConfig.js";
import { importedSongs } from "./importedSongs.js";

// Bundled songs ship "/media/imports/..." URLs. When the media lives elsewhere
// (a public Pages media repo, a CDN), the base replaces that "/media" prefix.
function withMediaBase(url) {
  if (!url) return url;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  const base = getMediaBase();
  if (base) return base + url.replace(/^\/media/, "");
  // Relative to the document, so the same build works at "/" (the app's web
  // view, the Node server) and under a sub-path (GitHub Pages project sites).
  return url.replace(/^\/media\//, "media/");
}

// A difficulty is playable when it either carries a chart or is marked for
// audio-driven generation (in-app uploads ship no chart at all).
export function isPlayableDifficulty(difficulty) {
  if (!difficulty) return false;
  if (difficulty.auto) return true;
  return (difficulty.chart || []).length > 0;
}

export function isPlayableSong(song) {
  if (!song?.audioUrl) return false;
  return Object.values(song.difficulties || {}).some(isPlayableDifficulty);
}

const builtInSongs = importedSongs.filter(isPlayableSong).map((song) => ({
  ...song,
  audioUrl: withMediaBase(song.audioUrl),
  videoUrl: withMediaBase(song.videoUrl),
  coverUrl: withMediaBase(song.coverUrl)
}));

// Mutable on purpose: in-app uploads join the same array so every screen that
// reads `songs` sees them after a library refresh.
export const songs = [...builtInSongs];

const listeners = new Set();

export function subscribeSongs(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUploadedSongs(uploaded) {
  for (let i = songs.length - 1; i >= 0; i -= 1) {
    if (songs[i].uploaded) songs.splice(i, 1);
  }
  for (const song of uploaded) songs.push(song);
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a bad subscriber must not break the library */
    }
  });
}

export function findSong(id) {
  return songs.find((song) => song.id === id) || null;
}
