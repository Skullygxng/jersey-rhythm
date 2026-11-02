// City Runner — the approved Direction B character, and the frame system it
// will run on.
//
// The animation is defined by a manifest, not by geometry. A manifest lists the
// frames with the beat position each one lands on, plus the foot anchor and the
// height the character should be drawn at, so:
//
// - clean, individually exported PNGs can be dropped in and referenced by name;
// - an optimised atlas can be used instead, with source rectangles;
// - in-between frames can be added later (8 -> 16 -> 24) without touching the
//   four-beat choreography, because each frame carries its own beat.
//
// Until those clean assets exist, the loader falls back to the handoff reference
// sheet: it crops the eight grid cells and trims them, which is what the current
// preview shows. That path is marked as a reference fallback, never as
// production: the sheet is annotated (arrows, motion marks, captions) and those
// marks ride along inside each crop.
//
// Timing: nothing here reads a clock. The caller passes a beat position from
// timeline.js — beatPosition(now, beatMs) — and the frame is chosen from it.

export const CITY_RUNNER_MANIFEST = "art/cityrunner/manifest.json";
export const CITY_RUNNER_SHEET = "art/cityrunner/eight_pose_reference.png";

// Measured from the handoff sheet: two rows of four cells, with the second row
// starting 525 px lower so the captions between the rows stay out.
export const CITY_RUNNER_GRID = {
  columns: 4,
  rows: 2,
  originX: 30,
  originY: 255,
  cellWidth: 266,
  cellHeight: 440,
  rowStride: 525
};

export const CITY_RUNNER_FRAME_COUNT = CITY_RUNNER_GRID.columns * CITY_RUNNER_GRID.rows;

// The default four-beat loop. A manifest may extend it, but this is the
// choreography every frame is written against.
export const CITY_RUNNER_LOOP_BEATS = 4;

// Height the reference-sheet fallback draws the figure at when scale is 1.
const SHEET_REFERENCE_HEIGHT = 420;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 0..4 position inside the loop, wrapping both ways. */
export function loopBeat(beatPos, beats = CITY_RUNNER_LOOP_BEATS) {
  const span = Number.isFinite(beats) && beats > 0 ? beats : CITY_RUNNER_LOOP_BEATS;
  const value = Number.isFinite(beatPos) ? beatPos : 0;
  return ((value % span) + span) % span;
}

/** The sheet fallback's 8th-of-a-loop mapping (0..7), kept for comparison. */
export function frameIndexAt(beatPos) {
  const t = loopBeat(beatPos);
  return Math.min(CITY_RUNNER_FRAME_COUNT - 1, Math.floor((t / CITY_RUNNER_LOOP_BEATS) * CITY_RUNNER_FRAME_COUNT));
}

/** Source rectangle of a frame inside the reference sheet. */
export function frameRect(index) {
  const safe =
    ((Math.round(index) % CITY_RUNNER_FRAME_COUNT) + CITY_RUNNER_FRAME_COUNT) % CITY_RUNNER_FRAME_COUNT;
  const column = safe % CITY_RUNNER_GRID.columns;
  const row = Math.floor(safe / CITY_RUNNER_GRID.columns);
  return {
    x: CITY_RUNNER_GRID.originX + column * CITY_RUNNER_GRID.cellWidth,
    y: CITY_RUNNER_GRID.originY + row * CITY_RUNNER_GRID.rowStride,
    w: CITY_RUNNER_GRID.cellWidth,
    h: CITY_RUNNER_GRID.cellHeight
  };
}

/**
 * Validate and normalise a manifest. Returns null when the manifest cannot be
 * trusted, so the caller can fall back rather than draw something wrong.
 *
 * Accepted shape:
 * {
 *   version: 1, loopBeats: 4, referenceHeight: 420,
 *   mode: "frames" | "atlas",
 *   atlas: { src }                       // atlas mode only
 *   frames: [{ src | (x,y,width,height), beat, footX, footY }]
 * }
 */
export function normaliseManifest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const list = Array.isArray(raw.frames) ? raw.frames : null;
  if (!list || list.length < 1) return null;

  const mode = raw.mode === "atlas" ? "atlas" : raw.mode === "frames" ? "frames" : null;
  if (!mode) return null;
  if (mode === "atlas" && (!raw.atlas || typeof raw.atlas.src !== "string")) return null;

  const loopBeats = Number(raw.loopBeats) > 0 ? Number(raw.loopBeats) : CITY_RUNNER_LOOP_BEATS;
  const referenceHeight = Number(raw.referenceHeight) > 0 ? Number(raw.referenceHeight) : SHEET_REFERENCE_HEIGHT;

  const frames = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") return null;
    const beat = Number(entry.beat);
    if (!Number.isFinite(beat) || beat < 0 || beat >= loopBeats) return null;
    const footX = Number.isFinite(Number(entry.footX)) ? clamp(Number(entry.footX), 0, 1) : 0.5;
    const footY = Number.isFinite(Number(entry.footY)) ? clamp(Number(entry.footY), 0, 1) : 1;

    if (mode === "frames") {
      if (typeof entry.src !== "string" || !entry.src) return null;
      frames.push({ src: entry.src, beat, footX, footY });
    } else {
      const x = Number(entry.x);
      const y = Number(entry.y);
      const width = Number(entry.width);
      const height = Number(entry.height);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
      frames.push({ x, y, width, height, beat, footX, footY });
    }
  }

  frames.sort((a, b) => a.beat - b.beat);
  const beats = new Set();
  for (const frame of frames) {
    const key = frame.beat.toFixed(4);
    if (beats.has(key)) return null;
    beats.add(key);
  }

  return { version: 1, mode, loopBeats, referenceHeight, atlas: raw.atlas || null, frames };
}

/**
 * Which frame is showing at a beat position: the last frame at or before it,
 * wrapping to the last frame of the loop before the first one. The lookup only
 * walks the sorted list, so adding in-between frames changes nothing else.
 */
export function pickFrameIndex(frames, beatPos, loopBeats = CITY_RUNNER_LOOP_BEATS) {
  if (!Array.isArray(frames) || !frames.length) return -1;
  const t = loopBeat(beatPos, loopBeats);
  let chosen = frames.length - 1;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index].beat <= t) chosen = index;
    else break;
  }
  return chosen;
}

/**
 * Trim each sheet cell to the figure's own alpha bounds, once per load, so the
 * feet share a baseline whatever padding the sheet gave each pose.
 */
export function measureFrames(image, documentRef) {
  const doc = documentRef || (typeof document === "undefined" ? null : document);
  if (!doc || !image || !image.naturalWidth) return [];

  const canvas = doc.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);

  const frames = [];
  for (let index = 0; index < CITY_RUNNER_FRAME_COUNT; index += 1) {
    const rect = frameRect(index);
    const data = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    let minX = rect.w;
    let minY = rect.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        if (data[(y * rect.w + x) * 4 + 3] < 24) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      frames.push(null);
      continue;
    }
    frames.push({
      beat: (index / CITY_RUNNER_FRAME_COUNT) * CITY_RUNNER_LOOP_BEATS,
      image,
      sx: rect.x + minX,
      sy: rect.y + minY,
      sw: maxX - minX + 1,
      sh: maxY - minY + 1,
      footX: 0.5,
      footY: 1
    });
  }
  return frames.filter(Boolean);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("City Runner asset did not load: " + src));
    element.src = src;
  });
}

/** Read and normalise a manifest; resolves null when it is absent or unusable. */
export async function loadManifest(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    const raw = await response.json();
    return normaliseManifest(raw);
  } catch {
    return null;
  }
}

function resolvePath(base, src) {
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  const slash = base.lastIndexOf("/");
  return slash >= 0 ? base.slice(0, slash + 1) + src : src;
}

/**
 * Load the frame set: the manifest's clean frames when they exist, otherwise the
 * annotated reference sheet. The returned mode says which one was used, so the
 * preview and the page can be honest about it.
 */
const loadCache = new Map();

export async function loadCityRunner(options = {}) {
  const manifestUrl = options.manifestUrl === undefined ? CITY_RUNNER_MANIFEST : options.manifestUrl;
  const sheetUrl = options.sheetUrl === undefined ? CITY_RUNNER_SHEET : options.sheetUrl;
  const cacheKey = manifestUrl + "|" + sheetUrl;
  if (loadCache.has(cacheKey)) return loadCache.get(cacheKey);

  const manifest = await loadManifest(manifestUrl);
  if (manifest) {
    if (manifest.mode === "atlas") {
      const image = await loadImage(resolvePath(manifestUrl, manifest.atlas.src));
      const frames = manifest.frames.map((frame) => ({
        beat: frame.beat,
        image,
        sx: frame.x,
        sy: frame.y,
        sw: frame.width,
        sh: frame.height,
        footX: frame.footX,
        footY: frame.footY
      }));
      const result = {
        mode: "manifest",
        source: "atlas",
        frames,
        beats: manifest.loopBeats,
        referenceHeight: manifest.referenceHeight
      };
      loadCache.set(cacheKey, result);
      return result;
    }

    const frames = [];
    for (const frame of manifest.frames) {
      const image = await loadImage(resolvePath(manifestUrl, frame.src));
      frames.push({
        beat: frame.beat,
        image,
        sx: 0,
        sy: 0,
        sw: image.naturalWidth,
        sh: image.naturalHeight,
        footX: frame.footX,
        footY: frame.footY
      });
    }
    const result = {
      mode: "manifest",
      source: "frames",
      frames,
      beats: manifest.loopBeats,
      referenceHeight: manifest.referenceHeight
    };
    loadCache.set(cacheKey, result);
    return result;
  }

  const image = await loadImage(sheetUrl);
  const result = {
    mode: "reference-sheet",
    source: "reference-sheet",
    frames: measureFrames(image),
    beats: CITY_RUNNER_LOOP_BEATS,
    referenceHeight: SHEET_REFERENCE_HEIGHT
  };
  loadCache.set(cacheKey, result);
  return result;
}

/**
 * Draw the pose the song clock is on.
 *
 * `beatPos` comes from timeline.js (beatPosition(now, beatMs)); this function
 * never reads a clock of its own. Frames are scaled to a shared on-screen
 * height (`referenceHeight`) so a frame exported at a different size does not
 * change the character's size.
 */
export function drawCityRunner(ctx, options) {
  const {
    frames,
    beats = CITY_RUNNER_LOOP_BEATS,
    referenceHeight = SHEET_REFERENCE_HEIGHT,
    x,
    ground,
    beatPos,
    scale = 1,
    alpha = 1
  } = options;
  if (!Array.isArray(frames) || !frames.length) return false;

  const index = pickFrameIndex(frames, beatPos, beats);
  const frame = frames[index];
  if (!frame) return false;

  const drawScale = (scale * referenceHeight) / frame.sh;
  const width = frame.sw * drawScale;
  const height = frame.sh * drawScale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    frame.image,
    frame.sx,
    frame.sy,
    frame.sw,
    frame.sh,
    x - width * frame.footX,
    ground - height * frame.footY,
    width,
    height
  );
  ctx.restore();
  return true;
}
