// Tracks the player adds from their own device.
//
// A browser cannot write into the repository's media folder, so uploads live in
// IndexedDB as blobs and are exposed as object URLs. The chart for them is built
// from the audio at play time, exactly like the bundled tracks.

const DB_NAME = "jersey-rhythm-library";
const DB_VERSION = 1;
const STORE = "tracks";
const LABELS = { easy: "Easy", normal: "Normal", hard: "Hard" };
const MAX_BYTES = 60 * 1024 * 1024;

const objectUrls = [];

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("This browser cannot store files"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Storage unavailable"));
  });
}

function runStore(mode, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        const request = action(store);
        if (request) {
          request.onsuccess = () => {
            result = request.result;
          };
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("Storage failed"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("Storage aborted"));
        };
      })
  );
}

function parseName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  if (base.includes(" - ")) {
    const parts = base.split(" - ");
    const artist = (parts.shift() || "").trim();
    const title = parts.join(" - ").trim();
    return { artist: artist || "Unknown Artist", title: title || base };
  }
  return { artist: "Unknown Artist", title: base || "Untitled" };
}

function toSong(record, audioUrl) {
  const difficulties = {};
  for (const id of Object.keys(LABELS)) {
    difficulties[id] = {
      label: LABELS[id],
      bpm: Number(record.bpm) || 0,
      auto: true,
      chart: []
    };
  }

  return {
    id: record.id,
    title: record.title,
    artist: record.artist,
    audioUrl,
    videoUrl: "",
    coverUrl: "",
    chartSource: "auto",
    uploaded: true,
    difficulties
  };
}

export async function listTracks() {
  try {
    const records = await runStore("readonly", (store) => store.getAll());
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export async function loadUploadedSongs() {
  const records = await listTracks();

  while (objectUrls.length) {
    const url = objectUrls.pop();
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* revoking is best effort */
    }
  }

  return records
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((record) => {
      let audioUrl = "";
      try {
        audioUrl = URL.createObjectURL(record.blob);
        objectUrls.push(audioUrl);
      } catch {
        audioUrl = "";
      }
      return toSong(record, audioUrl);
    })
    .filter((song) => song.audioUrl);
}

export async function addUploadedTrack(file) {
  if (!file) throw new Error("No file selected");
  if (file.size > MAX_BYTES) throw new Error("That track is over 60MB");

  const { artist, title } = parseName(file.name || "Untitled");
  const id = "upload-" + hashString([file.name, file.size, file.lastModified].join(":"));

  await runStore("readwrite", (store) =>
    store.put({
      id,
      title,
      artist,
      blob: file,
      mime: file.type || "audio/mpeg",
      size: file.size,
      createdAt: Date.now()
    })
  );

  return { id, title, artist };
}

export async function removeUploadedTrack(id) {
  if (!id) return;
  await runStore("readwrite", (store) => store.delete(id));
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.indexOf("jr-autochart-") === 0 && key.indexOf(id) !== -1) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* cache cleanup is best effort */
  }
}
