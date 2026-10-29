// Audio-driven chart generation (v4).
//
// Rebuilt around what published mappers actually do (osu!mania ranking
// criteria, BSMG mapping guides, StepMania/ITG charting notes):
//
//  - every note sits on a real onset that supports it; onsets vote for grid
//    slots, they never become notes directly;
//  - the grid is 1/16 of a tracked beat, and difficulty is expressed as a
//    notes-per-bar budget, not as a random subset of the grid;
//  - density follows the song's sections (break / verse / chorus / peak), so a
//    drop is the only place 16th runs appear and a break is nearly empty;
//  - each 4-bar phrase gets one lane pattern, and a repeated phrase reuses it
//    mirrored (lanes 1↔4, 2↔3) instead of being re-randomised;
//  - the kick keeps an anchor lane through a section ("L1 kick"), hats alternate
//    on the other side, backbeats land opposite the anchor, chords use two
//    hands;
//  - holds only appear on sustained sounds, and never swallow another note in
//    the same lane;
//  - long intros are trimmed so the first note arrives right after the
//    count-in instead of after seconds of dead air.

export const AUTO_CHART_VERSION = 5;

const SAMPLE_RATE = 11025;
const HOP = 64;
const WINDOW = 256;
const FRAME_RATE = SAMPLE_RATE / HOP;
const STEPS_PER_BEAT = 4;
const PHRASE_BARS = 4;

const STEP_WEIGHT = [1, 0.42, 0.76, 0.42];

const RULES = {
  easy: {
    notesPerBar: 2.5,
    minGap: 240,
    steps: [0, 2],
    chordChance: 0,
    holdRatio: 0.12,
    minHoldBeats: 1,
    minLaneGap: 240
  },
  normal: {
    notesPerBar: 5,
    minGap: 150,
    steps: [0, 1, 2, 3],
    chordChance: 0.08,
    holdRatio: 0.18,
    minHoldBeats: 0.5,
    minLaneGap: 150
  },
  hard: {
    notesPerBar: 9,
    minGap: 84,
    steps: [0, 1, 2, 3],
    chordChance: 0.18,
    holdRatio: 0.2,
    minHoldBeats: 0.25,
    minLaneGap: 95
  }
};

const analysisCache = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

let sharedContext = null;
function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio is not available");
  if (!sharedContext) sharedContext = new Ctx();
  if (sharedContext.state === "suspended") sharedContext.resume().catch(() => {});
  return sharedContext;
}

// Decoding has nothing to do with playback, so it runs on an offline context.
// A realtime AudioContext starts suspended in a web view (there is no gesture
// yet) and decodeAudioData() on it never settles — which left the ready screen
// on "Reading audio" forever, worst on the longest track.
let decodeContext = null;
function getDecodeContext() {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return getAudioContext();
  if (!decodeContext) decodeContext = new Offline(1, 1, 44100);
  return decodeContext;
}

const DECODE_TIMEOUT_MS = 20000;

function decodeWithTimeout(bytes) {
  const context = getDecodeContext();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Decoding the audio took too long"));
    }, DECODE_TIMEOUT_MS);

    Promise.resolve(context.decodeAudioData(bytes.slice(0)))
      .then((buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(buffer);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === AUTO_CHART_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: analysis simply reruns */
  }
}

export function clearAutoChartCache() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && (key.indexOf("jr-autochart-") === 0 || key.indexOf("jr-analysis-") === 0)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* storage is optional */
  }
}

async function decodeToMono(song) {
  if (!song?.audioUrl) throw new Error("This track has no audio file");

  const response = await fetch(song.audioUrl);
  if (!response.ok) throw new Error("Could not load the audio file (" + response.status + ")");

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1024) throw new Error("The audio file is empty");

  const buffer = await decodeWithTimeout(bytes);

  const channels = buffer.numberOfChannels;
  const sourceRate = buffer.sampleRate;
  const length = Math.floor((buffer.length * SAMPLE_RATE) / sourceRate);
  if (length < SAMPLE_RATE) throw new Error("Audio is too short to chart");

  const mono = new Float32Array(length);
  const ratio = sourceRate / SAMPLE_RATE;
  const data = [];
  for (let c = 0; c < channels; c += 1) data.push(buffer.getChannelData(c));

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let c = 0; c < channels; c += 1) {
      const channel = data[c];
      for (let j = start; j < end; j += 1) {
        sum += channel[j];
        count += 1;
      }
    }
    mono[i] = count > 0 ? sum / count : 0;
  }

  return { mono, duration: buffer.duration };
}

function buildEnvelopes(mono) {
  const frameCount = Math.floor((mono.length - WINDOW) / HOP) + 1;
  if (frameCount < 16) throw new Error("Audio is too short to chart");

  const energy = new Float32Array(frameCount);
  const lowEnergy = new Float32Array(frameCount);
  const highEnergy = new Float32Array(frameCount);
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 150) / SAMPLE_RATE);
  const highAlpha = 1 - Math.exp((-2 * Math.PI * 2200) / SAMPLE_RATE);
  let lowPass = 0;
  let highPass = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * HOP;
    let total = 0;
    let lowTotal = 0;
    let highTotal = 0;
    for (let i = 0; i < WINDOW; i += 1) {
      const sample = mono[offset + i];
      lowPass += lowAlpha * (sample - lowPass);
      highPass += highAlpha * (sample - highPass);
      const high = sample - highPass;
      total += sample * sample;
      lowTotal += lowPass * lowPass;
      highTotal += high * high;
    }
    energy[frame] = Math.sqrt(total / WINDOW);
    lowEnergy[frame] = Math.sqrt(lowTotal / WINDOW);
    highEnergy[frame] = Math.sqrt(highTotal / WINDOW);
  }

  const onset = new Float32Array(frameCount);
  const lowOnset = new Float32Array(frameCount);
  let previousEnergy = 0;
  let previousLow = 0;
  let previousHigh = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const rise = Math.max(0, energy[frame] - previousEnergy);
    const kickRise = Math.max(0, lowEnergy[frame] - previousLow);
    const hatRise = Math.max(0, highEnergy[frame] - previousHigh);
    lowOnset[frame] = kickRise;
    onset[frame] = rise + kickRise * 0.85 + hatRise * 0.35;
    previousEnergy = energy[frame];
    previousLow = lowEnergy[frame];
    previousHigh = highEnergy[frame];
  }

  let peak = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (onset[frame] > peak) peak = onset[frame];
  }
  if (peak <= 1e-6) throw new Error("This audio is silent");
  for (let frame = 0; frame < frameCount; frame += 1) onset[frame] /= peak;

  const smooth = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -6; k <= 6; k += 1) {
      const index = frame + k;
      if (index < 0 || index >= frameCount) continue;
      sum += energy[index];
      count += 1;
    }
    smooth[frame] = count > 0 ? sum / count : 0;
  }

  return { onset, lowOnset, energy: smooth, lowEnergy, highEnergy, frameCount };
}

function estimateTempo(onset) {
  const minLag = Math.max(4, Math.floor((FRAME_RATE * 60) / 200));
  const maxLag = Math.min(onset.length - 8, Math.ceil((FRAME_RATE * 60) / 70));
  if (maxLag <= minLag) return 150;

  let bestLag = Math.round((FRAME_RATE * 60) / 150);
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i + lag < onset.length; i += 1) {
      const a = onset[i];
      const b = onset[i + lag];
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const correlation = dot / Math.sqrt(normA * normB + 1e-9);
    const bpm = (60 * FRAME_RATE) / lag;
    const weight = bpm >= 126 && bpm <= 172 ? 1.18 : bpm >= 100 && bpm < 126 ? 1.02 : 0.86;
    const score = correlation * weight;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = (60 * FRAME_RATE) / bestLag;
  while (bpm < 128) bpm *= 2;
  while (bpm > 176) bpm /= 2;
  return bpm;
}

function findFirstStrongFrame(onset) {
  let peak = 0;
  for (let frame = 0; frame < onset.length; frame += 1) {
    if (onset[frame] > peak) peak = onset[frame];
  }
  const floor = peak * 0.3;
  for (let frame = 0; frame < onset.length; frame += 1) {
    if (onset[frame] >= floor) return frame;
  }
  return 0;
}

// Tempo-following metronome: each beat snaps to a nearby onset but is pulled
// toward the expected position, so recording drift is tracked instead of
// accumulating into seconds of misalignment.
function trackBeats(onset, bpm, startFrame) {
  const period = (60 / bpm) * FRAME_RATE;
  const beats = [startFrame];
  let ideal = startFrame;

  for (let i = 0; i < 3000; i += 1) {
    ideal += period;
    if (ideal >= onset.length - 2) break;
    const span = Math.max(2, Math.round(period * 0.08));
    const from = Math.max(1, Math.round(ideal) - span);
    const to = Math.min(onset.length - 2, Math.round(ideal) + span);
    let bestFrame = Math.round(ideal);
    let bestScore = -Infinity;

    for (let frame = from; frame <= to; frame += 1) {
      const strength = onset[frame] + 0.4 * (onset[frame - 1] + onset[frame + 1]);
      const pull = (0.22 * Math.abs(frame - ideal)) / (span + 1);
      const score = strength - pull;
      if (score > bestScore) {
        bestScore = score;
        bestFrame = frame;
      }
    }

    ideal = bestFrame;
    beats.push(bestFrame);
  }

  return beats;
}

function sampleArray(array, frame) {
  const index = Math.floor(frame);
  if (index < 0 || index >= array.length) return 0;
  const next = Math.min(array.length - 1, index + 1);
  const fraction = frame - index;
  return array[index] * (1 - fraction) + array[next] * fraction;
}

function buildGrid(beats, onset, lowEnergy, highEnergy) {
  const points = [];

  for (let i = 0; i < beats.length - 1; i += 1) {
    const from = beats[i];
    const to = beats[i + 1];
    for (let step = 0; step < STEPS_PER_BEAT; step += 1) {
      const frame = from + ((to - from) * step) / STEPS_PER_BEAT;
      const strength =
        sampleArray(onset, frame) +
        0.4 * (sampleArray(onset, frame - 1.5) + sampleArray(onset, frame + 1.5));

      points.push({
        time: frame / FRAME_RATE,
        frame,
        beat: i,
        bar: Math.floor(i / 4),
        step,
        strength,
        low: sampleArray(lowEnergy, frame),
        high: sampleArray(highEnergy, frame)
      });
    }
  }

  return points;
}

function buildSections(points, beats) {
  const barCount = Math.max(1, Math.ceil((beats.length - 1) / 4));
  const barEnergy = new Array(barCount).fill(0);
  const barOnsets = new Array(barCount).fill(0);

  for (const point of points) {
    if (point.bar >= barCount) continue;
    barEnergy[point.bar] += point.low + point.high;
    if (point.strength > 0.18) barOnsets[point.bar] += 1;
  }

  const all = points
    .map((point) => point.low + point.high)
    .sort((a, b) => a - b);
  const reference = all[Math.floor(all.length * 0.9)] || 1;

  const levels = barEnergy.map((sum, index) => {
    const normalized = sum / 4 / reference;
    let level;
    if (normalized < 0.3) level = 0.3;
    else if (normalized < 0.55) level = 0.75;
    else if (normalized < 0.8) level = 1;
    else level = 1.15;
    if (barOnsets[index] < 2) level = Math.min(level, 0.45);
    return level;
  });

  return { levels, barCount };
}

function selectPoints(points, sections, difficultyId, beatMs) {
  const rules = RULES[difficultyId] || RULES.normal;
  const selected = [];
  let lastTime = -Infinity;

  for (let bar = 0; bar < sections.barCount; bar += 1) {
    const level = sections.levels[bar] ?? 0.75;
    const budget = clamp(Math.round(rules.notesPerBar * level), 0, 10);
    if (budget <= 0) continue;

    const candidates = points
      .filter((point) => {
        if (point.bar !== bar) return false;
        if (!rules.steps.includes(point.step)) return false;
        // Normal only opens up 16ths where the music is loud enough.
        if (difficultyId === "normal" && point.step % 2 === 1 && point.strength < 0.5) {
          return false;
        }
        return true;
      })
      .map((point) => ({ ...point, score: point.strength * STEP_WEIGHT[point.step] }))
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) continue;

    let strongest = 0;
    for (const candidate of candidates) {
      if (candidate.strength > strongest) strongest = candidate.strength;
    }
    const floor = Math.max(0.07, strongest * (difficultyId === "hard" ? 0.22 : 0.3));

    const picked = [];
    for (const candidate of candidates) {
      if (picked.length >= budget) break;
      if (candidate.strength < floor) continue;
      if ((candidate.time - lastTime) * 1000 < rules.minGap) continue;
      if (
        picked.some((item) => Math.abs(item.time - candidate.time) * 1000 < rules.minGap)
      ) {
        continue;
      }
      picked.push(candidate);
    }

    picked.sort((a, b) => a.time - b.time);
    for (const item of picked) selected.push(item);
    if (picked.length) lastTime = picked[picked.length - 1].time;
  }

  // A phrase must not be empty right after the first note; keep the strongest.
  if (!selected.length) {
    const fallback = points
      .slice()
      .sort((a, b) => b.strength - a.strength)
      .slice(0, Math.max(8, Math.round(beatMs / 120)));
    return fallback.sort((a, b) => a.time - b.time);
  }

  return selected;
}

function mirrorLane(lane) {
  return 3 - lane;
}

function buildTemplate(phrasePoints, anchor, rules, random, laneCounts) {
  const template = [];
  const laneLast = [-Infinity, -Infinity, -Infinity, -Infinity];
  const opposite = (anchor + 2) % 4;
  const others = [0, 1, 2, 3].filter((lane) => lane !== anchor && lane !== opposite);
  const hatLanes = anchor % 2 === 0 ? others : [others[1], others[0]];
  let hatIndex = 0;
  let lastLane = -1;
  let run = 0;

  for (let index = 0; index < phrasePoints.length; index += 1) {
    const point = phrasePoints[index];
    const timeMs = point.time * 1000;
    const kick = point.low > point.high * 1.15;
    const hat = point.high > point.low * 1.15;

    let lane;
    if (kick) lane = anchor;
    else if (hat) {
      lane = hatLanes[hatIndex % hatLanes.length];
      hatIndex += 1;
    } else lane = opposite;

    const usable = (candidate) =>
      timeMs - laneLast[candidate] >= rules.minLaneGap &&
      !(candidate === lastLane && run >= 2);

    // Keep the kick anchored, but never let one lane run away with the chart:
    // once a lane passes ~30% of the notes, take the least-used usable lane.
    const total = laneCounts.reduce((sum, value) => sum + value, 0) + 1;
    const share = laneCounts[lane] / total;

    if (!usable(lane) || share > 0.3) {
      const order = [0, 1, 2, 3]
        .filter(usable)
        .sort((a, b) => laneCounts[a] - laneCounts[b]);
      if (order.length) lane = order[0];
    }

    laneLast[lane] = timeMs;
    laneCounts[lane] += 1;
    run = lane === lastLane ? run + 1 : 1;
    lastLane = lane;

    let partner = null;
    const accent = point.step === 0 && point.strength > 0.55;
    if (accent && random() < rules.chordChance) {
      const hand = lane < 2 ? [2, 3] : [0, 1];
      partner = hand.sort((a, b) => laneCounts[a] - laneCounts[b])[0];
      if (partner === lane) partner = (partner + 2) % 4;
      laneLast[partner] = timeMs;
      laneCounts[partner] += 1;
    }

    template.push({ lane, partner });
  }

  return template;
}

function assignLanes(points, difficultyId, songId) {
  const rules = RULES[difficultyId] || RULES.normal;
  const random = mulberry32(hashString(songId + ":v" + AUTO_CHART_VERSION + ":" + difficultyId));
  const notes = [];

  const phrases = new Map();
  for (const point of points) {
    const key = Math.floor(point.bar / PHRASE_BARS);
    if (!phrases.has(key)) phrases.set(key, []);
    phrases.get(key).push(point);
  }

  const templateStore = new Map();
  const templateUses = new Map();
  const laneCounts = [0, 0, 0, 0];

  const phraseKeys = [...phrases.keys()].sort((a, b) => a - b);
  for (const phraseKey of phraseKeys) {
    const phrasePoints = phrases.get(phraseKey).sort((a, b) => a.time - b.time);
    if (!phrasePoints.length) continue;

    const signature = phrasePoints
      .map((point) => point.bar + ":" + point.step + ":" + Math.round(point.strength * 10))
      .join("|");

    let template;
    const uses = templateUses.get(signature) || 0;

    if (templateStore.has(signature)) {
      const base = templateStore.get(signature);
      const mirrored = uses % 2 === 1;
      template = base.map((item) =>
        mirrored
          ? {
              lane: mirrorLane(item.lane),
              partner: item.partner == null ? null : mirrorLane(item.partner)
            }
          : item
      );
      templateUses.set(signature, uses + 1);
    } else {
      // Rotate the kick anchor through all four lanes so one side never
      // dominates the whole chart.
      const anchor = phraseKey % 4;
      template = buildTemplate(phrasePoints, anchor, rules, random, laneCounts);
      templateStore.set(signature, template);
      templateUses.set(signature, 1);
    }

    for (const item of template) {
      if (templateStore.has(signature) && templateUses.get(signature) > 1) {
        // Reused phrases still count toward balance.
        laneCounts[item.lane] += 1;
        if (item.partner != null) laneCounts[item.partner] += 1;
      }
    }

    for (let index = 0; index < phrasePoints.length; index += 1) {
      const point = phrasePoints[index];
      const slot = template[index] || { lane: 0, partner: null };
      const time = Math.round(point.time * 1000);

      notes.push({
        time,
        lane: slot.lane,
        type: "tap",
        bar: point.bar,
        step: point.step,
        strength: point.strength
      });

      if (slot.partner != null && slot.partner !== slot.lane) {
        notes.push({
          time,
          lane: slot.partner,
          type: "tap",
          bar: point.bar,
          step: point.step,
          strength: point.strength
        });
      }
    }
  }

  // No two notes in one lane at the same time.
  const seen = new Set();
  const unique = [];
  for (const note of notes) {
    const key = note.time + ":" + note.lane;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(note);
  }

  return unique.sort((a, b) => a.time - b.time);
}

function averageEnergyIn(energy, fromSeconds, toSeconds) {
  const from = Math.max(0, Math.round(fromSeconds * FRAME_RATE));
  const to = Math.min(energy.length - 1, Math.round(toSeconds * FRAME_RATE));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i <= to; i += 1) sum += energy[i];
  return sum / (to - from + 1);
}

function placeHolds(notes, analysis, difficultyId, beatMs) {
  const rules = RULES[difficultyId] || RULES.normal;
  const budget = Math.floor(notes.length * rules.holdRatio);
  if (budget <= 0) return;

  let holds = 0;
  let lastHoldBar = -PHRASE_BARS;

  for (const note of notes) {
    if (holds >= budget) break;
    if (note.type === "hold") continue;
    if (note.step !== 0) continue;
    if (note.strength < 0.35) continue;
    if (note.bar - lastHoldBar < 1) continue;

    const nextSame = notes.find(
      (other) => other !== note && other.lane === note.lane && other.time > note.time
    );
    const maxEnd = nextSame ? nextSame.time - 120 : note.time + beatMs * 2;
    const minimum = Math.max(rules.minHoldBeats * beatMs, 240);
    const duration = Math.min(beatMs * 2, maxEnd - note.time);
    if (duration < minimum) continue;

    const seconds = note.time / 1000;
    const sustained = averageEnergyIn(analysis.energy, seconds, seconds + duration / 1000);
    const local = averageEnergyIn(analysis.energy, seconds - 0.4, seconds + 0.2);
    if (sustained < local * 0.6) continue;

    note.type = "hold";
    note.duration = Math.round(duration);
    holds += 1;
    lastHoldBar = note.bar;
  }
}

async function analyseSong(song, onStage) {
  const cacheKey = "jr-analysis-" + AUTO_CHART_VERSION + ":" + song.id;
  const cached = analysisCache.get(cacheKey);
  if (cached) return cached;

  if (onStage) onStage("Loading audio");
  const { mono, duration } = await decodeToMono(song);

  if (onStage) onStage("Listening for the beat");
  const { onset, lowOnset, energy, lowEnergy, highEnergy, frameCount } =
    buildEnvelopes(mono);
  const bpm = estimateTempo(onset);
  const startFrame = findFirstStrongFrame(onset);
  const beats = trackBeats(onset, bpm, startFrame);
  const points = buildGrid(beats, onset, lowEnergy, highEnergy);
  const sections = buildSections(points, beats);

  const analysis = {
    bpm,
    duration,
    durationFrames: frameCount,
    energy,
    lowEnergy,
    highEnergy,
    onset,
    lowOnset,
    points,
    sections
  };

  analysisCache.set(cacheKey, analysis);
  return analysis;
}

function buildChart(analysis, difficultyId, songId) {
  const beatMs = (60 / analysis.bpm) * 1000;
  const selected = selectPoints(
    analysis.points,
    analysis.sections,
    difficultyId,
    beatMs
  );
  const notes = assignLanes(selected, difficultyId, songId);
  placeHolds(notes, analysis, difficultyId, beatMs);

  const chart = notes
    .map((note, index) => {
      const entry = {
        id: index + 1,
        time: note.time,
        lane: note.lane,
        type: note.type
      };
      if (note.type === "hold") entry.duration = note.duration;
      return entry;
    })
    .sort((a, b) => a.time - b.time)
    .map((note, index) => ({ ...note, id: index + 1 }));

  const firstNote = chart.length ? chart[0].time : 0;
  const preRoll = firstNote > 10000 ? 2500 : 1800;
  const startAt = Math.max(0, firstNote - preRoll);

  return { chart, firstNote, startAt };
}

function sanitiseAuthored(chart) {
  if (!chart || !chart.length) return [];
  const notes = [...chart].sort((a, b) => a.time - b.time);
  const holds = notes.filter((note) => note.type === "hold" && Number(note.duration) > 0);
  if (!holds.length) return notes;

  // A note inside another note's ribbon in the same lane is unplayable.
  return notes.filter(
    (note) =>
      !holds.some(
        (hold) =>
          hold !== note &&
          hold.lane === note.lane &&
          note.time > hold.time + 1 &&
          note.time < hold.time + Number(hold.duration)
      )
  );
}

/**
 * Resolve the chart for a song + difficulty.
 * mode "auto" (default) analyses the audio; "authored" uses the shipped chart.
 */
export async function resolveChart(song, difficultyId, options) {
  const mode = options?.mode === "authored" ? "authored" : "auto";
  const onStage = options?.onStage;
  const difficulty = song?.difficulties?.[difficultyId];
  const authored = sanitiseAuthored(difficulty?.chart || []);

  if (mode === "authored" && authored.length) {
    return {
      chart: authored,
      source: "authored",
      bpm: Number(difficulty?.bpm) || 140,
      startAt: 0,
      noteCount: authored.length,
      holdCount: authored.filter((note) => note.type === "hold").length
    };
  }

  const key = "jr-autochart-" + AUTO_CHART_VERSION + ":" + song.id + ":" + difficultyId;
  const cached = readCache(key);
  if (cached) {
    return {
      chart: cached.chart,
      source: "auto",
      bpm: cached.bpm,
      startAt: cached.startAt || 0,
      noteCount: cached.chart.length,
      holdCount: cached.chart.filter((note) => note.type === "hold").length
    };
  }

  try {
    const analysis = await analyseSong(song, onStage);
    if (onStage) onStage("Building the chart");
    const built = buildChart(analysis, difficultyId, song.id);
    const bpm = Math.round(analysis.bpm * 10) / 10;

    writeCache(key, {
      version: AUTO_CHART_VERSION,
      chart: built.chart,
      bpm,
      startAt: built.startAt
    });

    return {
      chart: built.chart,
      source: "auto",
      bpm,
      startAt: built.startAt,
      noteCount: built.chart.length,
      holdCount: built.chart.filter((note) => note.type === "hold").length
    };
  } catch (error) {
    if (authored.length) {
      return {
        chart: authored,
        source: "authored-fallback",
        bpm: Number(difficulty?.bpm) || 140,
        startAt: 0,
        noteCount: authored.length,
        holdCount: authored.filter((note) => note.type === "hold").length,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    throw error;
  }
}

