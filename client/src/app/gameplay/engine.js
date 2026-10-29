// Jersey Rhythm — gameplay engine (v5).
//
// A pure state machine: no React, no DOM, no timers. The page feeds it the
// song clock each frame and drains its events for sound, haptics and VFX; the
// canvas renderer reads the note list and per-note hold state straight from
// here.
//
// v4:
// - input carries its own timestamp, so judgement uses the moment of the tap
//   instead of the last animation frame (frame judging is biased early and is
//   one of the reasons input feels "off").
// - windows tightened toward the published range (osu!mania / ITG / Arcaea).
//
// v5:
// - windows widened to the range the rule card, README and DESIGN document
//   (45 / 85 / 130, miss 160). 30ms perfects were tighter than osu!'s hardest
//   judge and left no room for touch latency on a phone, which read as the
//   game being unfair rather than hard. Easy charts are the ones people learn
//   on, so the learning chart has to feel reachable.

export const JUDGE = {
  perfect: 45,
  great: 85,
  good: 130,
  miss: 160,
  holdGrabEarly: 170,
  releaseGrace: 220
};

export const SCORE = {
  base: { perfect: 100, great: 75, good: 50 },
  tailFactor: 0.5,
  multiplierStep: 10,
  multiplierGain: 0.25,
  multiplierMax: 4
};

export const ACC_WEIGHT = { perfect: 1, great: 0.9, good: 0.72 };

const HOLD_TIERS = [
  { min: 0.9, result: "perfect" },
  { min: 0.6, result: "great" },
  { min: 0.3, result: "good" }
];

const LANES = 4;

function clampLane(lane) {
  const value = Math.floor(Number(lane));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(LANES - 1, value));
}

export function getGrade(accuracy, misses) {
  const missCount = Number(misses) || 0;
  const acc = Number(accuracy) || 0;
  if (acc >= 98 && missCount === 0) return "S+";
  if (acc >= 95) return "S";
  if (acc >= 88) return "A";
  if (acc >= 78) return "B";
  if (acc >= 68) return "C";
  return "D";
}

export class GameEngine {
  constructor({ chart = [], offsetMs = 0 } = {}) {
    this.chart = chart || [];
    this.offsetMs = Number(offsetMs) || 0;
    this.reset();
  }

  reset(chart = this.chart) {
    this.chart = chart || [];
    this.now = 0;
    this.prevNow = 0;
    this.pressed = [false, false, false, false];
    this.pressAt = [-1, -1, -1, -1];
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.vibe = 100;
    this.breaks = 0;
    this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.hitErrors = [];
    this.events = [];

    this.notes = (this.chart || [])
      .map((note, index) => {
        const type = note.type === "hold" || note.hold === true ? "hold" : "tap";
        return {
          id: note.id == null ? index : note.id,
          lane: clampLane(note.lane),
          type,
          start: (Number(note.time) || 0) + this.offsetMs,
          duration: type === "hold" ? Math.max(160, Number(note.duration) || 600) : 0,
          resolved: null,
          tailResult: null,
          hold: null
        };
      })
      .sort((a, b) => a.start - b.start);

    this.endTime = this.notes.reduce(
      (end, note) => Math.max(end, note.start + note.duration),
      0
    );
    this.holdCount = this.notes.filter((note) => note.type === "hold").length;
  }

  get failed() {
    return this.vibe <= 0;
  }

  get multiplier() {
    const steps = Math.floor(this.combo / SCORE.multiplierStep);
    return Math.min(SCORE.multiplierMax, 1 + steps * SCORE.multiplierGain);
  }

  get accuracy() {
    const { perfect, great, good, miss } = this.stats;
    const judged = perfect + great + good + miss;
    if (!judged) return 100;
    const weighted =
      perfect * ACC_WEIGHT.perfect + great * ACC_WEIGHT.great + good * ACC_WEIGHT.good;
    return Math.round((weighted / judged) * 100);
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** atMs: timestamp of the actual input event (falls back to the clock). */
  press(lane, atMs) {
    const l = clampLane(lane);
    if (this.pressed[l]) return;
    const at = Number.isFinite(atMs) ? atMs : this.now;

    this.pressed[l] = true;
    this.pressAt[l] = at;

    const resumable = this.notes.find(
      (note) =>
        note.type === "hold" &&
        !note.resolved &&
        note.hold &&
        note.lane === l &&
        note.hold.releasedAt !== null &&
        at < note.start + note.duration
    );
    if (resumable) {
      resumable.hold.releasedAt = null;
      this.events.push({ kind: "hold-resume", lane: l });
      return;
    }

    const target = this.findTarget(l, at);
    if (!target) return;
    this.hitNote(target, at - target.start);
  }

  release(lane, atMs) {
    const laneIndex = clampLane(lane);
    if (!this.pressed[laneIndex]) return;
    const at = Number.isFinite(atMs) ? atMs : this.now;
    this.pressed[laneIndex] = false;

    for (const note of this.notes) {
      if (note.type !== "hold" || note.resolved || !note.hold) continue;
      if (note.lane !== laneIndex) continue;
      if (note.hold.releasedAt === null) {
        note.hold.releasedAt = at;
        this.events.push({ kind: "hold-drop", lane: note.lane });
      }
    }
  }

  findTarget(lane, at) {
    let best = null;
    let bestDistance = Infinity;
    const time = Number.isFinite(at) ? at : this.now;

    for (const note of this.notes) {
      if (note.lane !== lane || note.resolved || note.hold) continue;
      const ahead = note.start - time;
      const early = note.type === "hold" ? JUDGE.holdGrabEarly : JUDGE.good;
      if (ahead > early || ahead < -JUDGE.good) continue;
      const distance = Math.abs(ahead);
      if (distance < bestDistance) {
        best = note;
        bestDistance = distance;
      }
    }

    return best;
  }

  hitNote(note, error, forcedResult) {
    const abs = Math.abs(error);
    const result =
      forcedResult ||
      (abs <= JUDGE.perfect ? "perfect" : abs <= JUDGE.great ? "great" : "good");

    if (note.type === "hold") {
      note.hold = { heldMs: 0, releasedAt: null };
      const points = this.addHit(result, false);
      this.hitErrors.push({ id: note.id, error, result, auto: Boolean(forcedResult) });
      this.events.push({
        kind: "hold-start",
        lane: note.lane,
        result,
        error,
        points,
        combo: this.combo
      });
      return;
    }

    note.resolved = result;
    const points = this.addHit(result, false);
    this.hitErrors.push({ id: note.id, error, result, auto: Boolean(forcedResult) });
    this.events.push({
      kind: "hit",
      lane: note.lane,
      result,
      error,
      points,
      combo: this.combo
    });
  }

  addHit(result, isTail) {
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const base = SCORE.base[result] || SCORE.base.good;
    const points = Math.round(base * this.multiplier * (isTail ? SCORE.tailFactor : 1));
    this.score += points;

    this.stats[result] = (this.stats[result] || 0) + 1;
    this.vibe = Math.min(100, this.vibe + (isTail ? 0.75 : 1.4));
    return points;
  }

  registerMiss(lane) {
    this.stats.miss += 1;
    this.combo = 0;
    this.vibe = Math.max(0, this.vibe - 7);
    this.events.push({ kind: "miss", lane });
  }

  finishHold(note) {
    if (!note.hold) return;
    const ratio =
      note.duration > 0 ? Math.max(0, Math.min(1, note.hold.heldMs / note.duration)) : 1;
    note.hold = null;
    note.resolved = true;

    let result = "miss";
    for (const tier of HOLD_TIERS) {
      if (ratio >= tier.min) {
        result = tier.result;
        break;
      }
    }

    note.tailResult = result;

    if (result === "miss") {
      this.stats.miss += 1;
      this.combo = 0;
      this.breaks += 1;
      this.vibe = Math.max(0, this.vibe - 9);
      this.events.push({ kind: "hold-break", lane: note.lane, ratio });
      return;
    }

    const points = this.addHit(result, true);
    this.events.push({ kind: "hold-end", lane: note.lane, result, ratio, points, combo: this.combo });
  }

  update(now) {
    const previous = this.now;
    this.prevNow = previous;
    this.now = now;

    for (const note of this.notes) {
      if (note.type !== "hold" || note.resolved || !note.hold) continue;

      const end = note.start + note.duration;
      if (this.pressed[note.lane]) {
        const from = Math.max(previous, note.start);
        const to = Math.min(now, end);
        if (to > from) {
          note.hold.heldMs = Math.min(note.duration, note.hold.heldMs + (to - from));
        }
      }

      if (now >= end) {
        this.finishHold(note);
        continue;
      }

      if (
        note.hold.releasedAt !== null &&
        this.now - note.hold.releasedAt > JUDGE.releaseGrace
      ) {
        this.finishHold(note);
      }
    }

    // A lane already held when a hold head arrives still grabs it.
    for (const note of this.notes) {
      if (note.resolved || note.hold) continue;
      if (note.type !== "hold") continue;
      if (!this.pressed[note.lane]) continue;
      const ahead = note.start - this.now;
      if (ahead > 4 || ahead < -JUDGE.perfect) continue;
      this.hitNote(note, 0, "great");
    }

    for (const note of this.notes) {
      if (note.resolved || note.hold) continue;
      if (this.now > note.start + JUDGE.miss) {
        note.resolved = "miss";
        this.registerMiss(note.lane);
      }
    }
  }

  summary() {
    const hitErrors = this.hitErrors.slice();
    const timed = hitErrors.filter((entry) => !entry.auto);
    const meanError = timed.length
      ? Math.round(timed.reduce((sum, entry) => sum + entry.error, 0) / timed.length)
      : 0;

    return {
      score: this.score,
      accuracy: this.accuracy,
      grade: getGrade(this.accuracy, this.stats.miss),
      maxCombo: this.maxCombo,
      stats: { ...this.stats },
      breaks: this.breaks,
      fullCombo: this.stats.miss === 0 && this.breaks === 0,
      noteCount: this.notes.length,
      holdCount: this.holdCount,
      meanError,
      hitErrors
    };
  }
}
