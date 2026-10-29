// Canvas play field for Jersey Rhythm.
//
// The renderer owns every per-frame pixel: a perspective highway, chrome gem
// notes, hold ribbons that burn down toward the receptor, beat-pulsed pads,
// hit bursts, combo chants and the whole in-run HUD. React never re-renders
// while a chart is playing — the page only reads engine state at the finish.

import { drawDanceCrew, kickPulseAt } from "./dancer.js";
import { drawStage } from "./stage.js";

export const LANE_COLORS = ["#ff2d78", "#ffc93c", "#25d6c0", "#8b7bff"];

const JUDGE_COLORS = {
  perfect: "#ffd23f",
  great: "#25d6c0",
  good: "#9fb0ff",
  miss: "#ff4d5e"
};

const JUDGE_LABELS = {
  perfect: "PERFECT",
  great: "GREAT",
  good: "GOOD",
  miss: "MISS"
};

const DISPLAY_FONT = 'Anton, "Arial Narrow", Impact, system-ui, sans-serif';
const BODY_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Jersey club "running five-kick" on a 16-step bar: steps 1, 5, 9, 12, 15.
const KICK_STEPS = [0, 4, 8, 11, 14];

const MAX_PARTICLES = 280;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexA(hex, alpha) {
  const value = String(hex || "#ffffff").replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return "rgba(" + r + "," + g + "," + b + "," + clamp(alpha, 0, 1) + ")";
}

export class FieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.floaters = [];
    this.confetti = [];
    this.shake = 0;
    this.comboPop = 0;
    this.lastCombo = 0;
    this.laneMiss = [0, 0, 0, 0];
    // Dancers flanking the highway: they groove with the five-kick and answer
    // each lane with a move, the way a DJ calls and the floor answers.
    this.dancePose = -1;
    this.dancePoseLife = 0;
    this.danceSlump = 0;
    this.danceSlumpSide = 0;
    this.danceEnergy = 0;
    this.resize();
  }

  /**
   * The dance crew answer the player: a hit throws the near arm out toward the
   * lane the note came from, a miss slumps the nearest dancer.
   */
  dancerHit(lane, result) {
    this.dancePose = lane;
    this.dancePoseLife = 1;
    if (result === "perfect") this.danceSlump = Math.max(0, this.danceSlump - 0.5);
  }

  dancerMiss(lane) {
    this.danceSlump = 1;
    this.danceSlumpSide = lane;
  }

  /**
   * Density heat: how many notes are about to arrive. Dense sections glow hot,
   * so a drop reads as a change in the world before the notes even land.
   */
  drawHeat(engine, now) {
    if (!engine) return;
    let ahead = 0;
    for (let i = 0; i < engine.notes.length; i += 1) {
      const note = engine.notes[i];
      if (note.resolved) continue;
      if (note.start >= now && note.start <= now + 2600) ahead += 1;
    }
    const target = clamp(ahead / 26, 0, 1);
    this.heat = (this.heat || 0) + (target - (this.heat || 0)) * 0.12;
    if (this.heat < 0.03) return;

    const color = this.heat > 0.55 ? "#ffc93c" : "#ff2d78";
    const glow = this.ctx.createRadialGradient(
      this.cx,
      this.hitY + 30,
      this.h * 0.08,
      this.cx,
      this.hitY + 30,
      this.h * 0.72
    );
    glow.addColorStop(0, hexA(color, 0.05 + this.heat * 0.13));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  drawDancers(now, beatMs) {
    drawDanceCrew(this.ctx, {
      w: this.w,
      h: this.h,
      cx: this.cx,
      hitY: this.hitY,
      laneWidth: this.laneWidthAt(this.hitY),
      now,
      beatMs,
      energy: this.fever ? 1 : this.danceEnergy,
      reaction: this.dancePoseLife,
      reactionSide: this.dancePose,
      slump: this.danceSlump
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const width = Math.max(300, (rect && rect.width) || window.innerWidth || 360);
    const height = Math.max(420, (rect && rect.height) || window.innerHeight || 640);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.cx = width / 2;
    this.hitY = height * 0.84;
    this.topY = height * 0.05;
    this.highwayW = Math.min(width * 0.98, 560);
    this.laneW = this.highwayW / 4;
    this.safeTop = 0;
    this.safeBottom = 0;
    try {
      const styles = window.getComputedStyle(this.canvas);
      this.safeTop = parseFloat(styles.getPropertyValue("--gp-safe-top")) || 0;
      this.safeBottom = parseFloat(styles.getPropertyValue("--gp-safe-bottom")) || 0;
    } catch {
      /* computed styles are optional */
    }

    this.vibeY = height - this.safeBottom - Math.max(20, height * 0.03);
    this.scoreY = this.safeTop + Math.max(58, height * 0.06) + 26;
  }

  // ── Geometry ────────────────────────────────────────────────────────────
  spreadAt(y) {
    const span = this.hitY - this.topY || 1;
    const t = clamp((y - this.topY) / span, 0, 1);
    return 0.62 + 0.38 * Math.pow(t, 0.85);
  }

  laneCenter(lane, y) {
    return this.cx + (lane - 1.5) * this.laneW * this.spreadAt(y);
  }

  laneWidthAt(y) {
    return this.laneW * this.spreadAt(y);
  }

  laneAt(x) {
    const left = this.cx - this.laneW * 2;
    return clamp(Math.floor((x - left) / this.laneW), 0, 3);
  }

  yFor(noteStart, now, travelMs) {
    const travel = Math.max(260, travelMs);
    const t = 1 - (noteStart - now) / travel;
    return this.topY + (this.hitY - this.topY) * t;
  }

  // ── Effect spawners ─────────────────────────────────────────────────────
  kick(strength) {
    this.shake = Math.max(this.shake, strength);
    this.dropPunch = Math.max(this.dropPunch || 0, strength * 0.8);
  }

  addParticle(particle) {
    if (this.particles.length > MAX_PARTICLES) this.particles.shift();
    this.particles.push(particle);
  }

  spawnFloater(config) {
    this.floaters.push({
      text: config.text,
      x: config.x,
      y: config.y,
      color: config.color,
      size: config.size,
      life: config.life,
      maxLife: config.life,
      rise: config.rise == null ? 30 : config.rise,
      chant: Boolean(config.chant)
    });
  }

  spawnHit(lane, result, error, points) {
    this.dancerHit(lane, result);
    const x = this.laneCenter(lane, this.hitY);
    const color = LANE_COLORS[lane] || "#ffffff";
    const judgeColor = JUDGE_COLORS[result] || color;
    const perfect = result === "perfect";
    const laneWidth = this.laneWidthAt(this.hitY);

    this.addParticle({
      kind: "ring",
      x,
      y: this.hitY,
      r: laneWidth * 0.14,
      grow: perfect ? 520 : 340,
      life: 0.32,
      maxLife: 0.32,
      color: judgeColor,
      width: perfect ? 4 : 2.4
    });

    const count = perfect ? 16 : 9;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const speed = 130 + Math.random() * (perfect ? 300 : 180);
      this.addParticle({
        kind: "spark",
        x,
        y: this.hitY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.8,
        life: 0.34 + Math.random() * 0.22,
        maxLife: 0.56,
        color: Math.random() > 0.35 ? judgeColor : "#fff6e4",
        size: 2 + Math.random() * 2.2
      });
    }

    if (perfect) {
      this.addParticle({
        kind: "flash",
        x,
        y: this.hitY,
        r: laneWidth * 0.72,
        life: 0.15,
        maxLife: 0.15,
        color
      });
    }

    this.spawnFloater({
      text: JUDGE_LABELS[result] || "",
      x,
      y: this.hitY - 46,
      color: judgeColor,
      size: perfect ? 25 : 21,
      life: 0.48,
      rise: 32
    });

    // Points pop where the note was hit, never in a corner.
    if (typeof points === "number" && points > 0) {
      this.spawnFloater({
        text: "+" + points,
        x: x + (lane < 2 ? -1 : 1) * 20,
        y: this.hitY - 16,
        color: "rgba(255,246,228,0.82)",
        size: 12 + Math.min(6, points / 70),
        life: 0.5,
        rise: 40
      });
    }

    if (typeof error === "number" && Math.abs(error) > 14) {
      this.spawnFloater({
        text: error < 0 ? "EARLY" : "LATE",
        x,
        y: this.hitY - 26,
        color: "rgba(255,246,228,0.75)",
        size: 11,
        life: 0.36,
        rise: 18
      });
    }
  }

  spawnHoldStart(lane, result) {
    const x = this.laneCenter(lane, this.hitY);
    this.addParticle({
      kind: "ring",
      x,
      y: this.hitY,
      r: this.laneWidthAt(this.hitY) * 0.12,
      grow: 250,
      life: 0.28,
      maxLife: 0.28,
      color: JUDGE_COLORS[result] || LANE_COLORS[lane],
      width: 2
    });
    this.spawnFloater({
      text: "HOLD",
      x,
      y: this.hitY - 42,
      color: "#fff2c9",
      size: 19,
      life: 0.42,
      rise: 26
    });
  }

  spawnHoldResume(lane) {
    this.spawnFloater({
      text: "AGAIN",
      x: this.laneCenter(lane, this.hitY),
      y: this.hitY - 42,
      color: "#ffd23f",
      size: 18,
      life: 0.38,
      rise: 22
    });
  }

  spawnDrop(lane) {
    this.laneMiss[lane] = Math.max(this.laneMiss[lane], 0.26);
  }

  spawnBreak(lane) {
    const x = this.laneCenter(lane, this.hitY);
    this.laneMiss[lane] = 0.55;
    for (let i = 0; i < 10; i += 1) {
      this.addParticle({
        kind: "shard",
        x: x + (Math.random() - 0.5) * 36,
        y: this.hitY - Math.random() * 70,
        vx: (Math.random() - 0.5) * 90,
        vy: 80 + Math.random() * 120,
        life: 0.45,
        maxLife: 0.45,
        color: JUDGE_COLORS.miss,
        size: 3 + Math.random() * 3
      });
    }
    this.spawnFloater({
      text: "HOLD DROPPED",
      x,
      y: this.hitY - 48,
      color: JUDGE_COLORS.miss,
      size: 18,
      life: 0.65,
      rise: 28
    });
  }

  spawnMiss(lane) {
    this.dancerMiss(lane);
    const x = this.laneCenter(lane, this.hitY);
    this.laneMiss[lane] = 0.55;
    this.addParticle({
      kind: "flash",
      x,
      y: this.hitY,
      r: this.laneWidthAt(this.hitY) * 0.7,
      life: 0.2,
      maxLife: 0.2,
      color: JUDGE_COLORS.miss
    });
    this.spawnFloater({
      text: "MISS",
      x,
      y: this.hitY - 44,
      color: JUDGE_COLORS.miss,
      size: 21,
      life: 0.42,
      rise: 28
    });
  }

  chant(text) {
    this.spawnFloater({
      text: String(text || ""),
      x: this.cx,
      y: this.h * 0.235,
      color: "#ffd23f",
      size: clamp(this.w * 0.095, 26, 56),
      life: 1.45,
      rise: -12,
      chant: true
    });
  }

  confetti() {
    const colors = LANE_COLORS.concat(["#fff6e4", "#ffd23f"]);
    for (let i = 0; i < 120; i += 1) {
      this.confetti.push({
        x: Math.random() * this.w,
        y: -30 - Math.random() * this.h * 0.5,
        vx: (Math.random() - 0.5) * 90,
        vy: 110 + Math.random() * 220,
        spin: Math.random() * Math.PI * 2,
        vspin: (Math.random() - 0.5) * 9,
        w: 4 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────────
  draw({ engine, now, dt, travelMs, beatMs, chartEnd, phase, startAt = 0 }) {
    const ctx = this.ctx;
    const dtS = clamp((Number(dt) || 16) / 1000, 0, 0.06);
    const drawNow = Number.isFinite(now) ? now : 0;
    const beat = beatMs > 0 ? beatMs : 420;

    ctx.clearRect(0, 0, this.w, this.h);

    const stageNow = Number.isFinite(drawNow) && drawNow > -10000 ? drawNow : 0;
    drawStage(ctx, {
      w: this.w,
      h: this.h,
      topY: this.topY,
      hitY: this.hitY,
      cx: this.cx,
      now: stageNow,
      beatMs: beat,
      heat: this.heat || 0
    });

    const combo = engine ? engine.combo : 0;
    if (combo !== this.lastCombo) {
      if (combo > this.lastCombo) this.comboPop = 1;
      this.lastCombo = combo;
    }
    this.comboPop = Math.max(0, this.comboPop - dtS * 4.2);
    for (let lane = 0; lane < 4; lane += 1) {
      this.laneMiss[lane] = Math.max(0, this.laneMiss[lane] - dtS * 2.2);
    }
    this.dancePoseLife = Math.max(0, this.dancePoseLife - dtS * 1.8);
    this.danceSlump = Math.max(0, this.danceSlump - dtS * 0.9);
    this.danceEnergy = clamp(combo / 40, 0, 1);
    this.fever = combo >= 30;
    this.dropPunch = Math.max(0, (this.dropPunch || 0) - dtS * 2.6);

    ctx.save();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dtS * 2.1);
      const power = this.shake * 13;
      ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
    }

    // The field pumps on the five-kick; a milestone punches in a little harder.
    const bop = 1 + kickPulseAt(drawNow, beat) * 0.012 + (this.dropPunch || 0) * 0.05;
    ctx.save();
    if (bop !== 1) {
      ctx.translate(this.cx, this.hitY);
      ctx.scale(bop, bop);
      ctx.translate(-this.cx, -this.hitY);
    }

    this.drawHighway(engine, drawNow);
    this.drawHeat(engine, drawNow);
    this.drawBeatGrid(drawNow, beat, travelMs);

    if (engine && (phase === "playing" || phase === "paused")) {
      this.drawDancers(drawNow, beat);
    }

    if (engine) {
      this.drawNotes(engine, drawNow, travelMs);
    }
    this.drawReceptors(engine, drawNow, beat);
    this.drawParticles(dtS);
    this.drawFloaters(dtS);
    ctx.restore();

    if (engine && (phase === "playing" || phase === "paused")) {
      this.drawHud(engine, drawNow, chartEnd, startAt);
    }

    this.drawConfetti(dtS);
    ctx.restore();
  }

  drawHighway(engine, now) {
    const ctx = this.ctx;
    const leftTop = this.cx - this.laneW * 2 * 0.62;
    const rightTop = this.cx + this.laneW * 2 * 0.62;
    const leftBottom = this.cx - this.laneW * 2;
    const rightBottom = this.cx + this.laneW * 2;
    const bottom = this.hitY + 8;

    const backdrop = ctx.createLinearGradient(0, this.topY, 0, bottom);
    backdrop.addColorStop(0, "rgba(8,5,12,0.08)");
    backdrop.addColorStop(0.55, "rgba(8,5,12,0.44)");
    backdrop.addColorStop(1, "rgba(8,5,12,0.86)");

    ctx.beginPath();
    ctx.moveTo(leftTop, this.topY);
    ctx.lineTo(rightTop, this.topY);
    ctx.lineTo(rightBottom, bottom);
    ctx.lineTo(leftBottom, bottom);
    ctx.closePath();
    ctx.fillStyle = backdrop;
    ctx.fill();

    if (engine) {
      for (let lane = 0; lane < 4; lane += 1) {
        if (!engine.pressed[lane]) continue;
        const color = LANE_COLORS[lane];
        const xTop = this.laneCenter(lane, this.topY);
        const xBottom = this.laneCenter(lane, this.hitY);
        const wTop = this.laneWidthAt(this.topY) / 2;
        const wBottom = this.laneWidthAt(this.hitY) / 2;
        const glow = ctx.createLinearGradient(0, this.topY, 0, this.hitY);
        glow.addColorStop(0, hexA(color, 0));
        glow.addColorStop(1, hexA(color, 0.22));
        ctx.beginPath();
        ctx.moveTo(xTop - wTop, this.topY);
        ctx.lineTo(xTop + wTop, this.topY);
        ctx.lineTo(xBottom + wBottom, this.hitY);
        ctx.lineTo(xBottom - wBottom, this.hitY);
        ctx.closePath();
        ctx.fillStyle = glow;
        ctx.fill();
      }
    }

    ctx.strokeStyle = "rgba(255,246,228,0.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const xTop = this.cx + (i - 2) * this.laneW * 0.62;
      const xBottom = this.cx + (i - 2) * this.laneW;
      ctx.beginPath();
      ctx.moveTo(xTop, this.topY);
      ctx.lineTo(xBottom, this.hitY);
      ctx.stroke();
    }

    const line = ctx.createLinearGradient(leftBottom, 0, rightBottom, 0);
    line.addColorStop(0, "rgba(255,246,228,0)");
    line.addColorStop(0.22, "rgba(255,246,228,0.34)");
    line.addColorStop(0.5, "rgba(255,246,228,0.52)");
    line.addColorStop(0.78, "rgba(255,246,228,0.34)");
    line.addColorStop(1, "rgba(255,246,228,0)");
    ctx.fillStyle = line;
    ctx.fillRect(leftBottom, this.hitY - 1.5, rightBottom - leftBottom, 3);

    void now;
  }

  drawBeatGrid(now, beat, travelMs) {
    const ctx = this.ctx;
    const travel = Math.max(260, travelMs);
    const first = Math.ceil((now - 100) / beat);
    const last = Math.floor((now + travel) / beat);

    ctx.lineWidth = 1;
    for (let index = first; index <= last; index += 1) {
      const y = this.yFor(index * beat, now, travel);
      if (y < this.topY || y > this.hitY) continue;
      const depth = clamp((y - this.topY) / (this.hitY - this.topY), 0, 1);
      const bar = index % 4 === 0;
      const left = this.laneCenter(0, y) - this.laneWidthAt(y) / 2;
      const right = left + this.laneWidthAt(y) * 4;
      ctx.strokeStyle = "rgba(255,246,228," + (bar ? 0.14 : 0.06) * depth + ")";
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
  }

  drawNotes(engine, now, travelMs) {
    for (const note of engine.notes) {
      if (note.resolved) continue;

      const headY = this.yFor(note.start, now, travelMs);
      const color = LANE_COLORS[note.lane];

      if (note.type === "hold") {
        const tailY = this.yFor(note.start + note.duration, now, travelMs);
        if (headY < this.topY - 80 && tailY < this.topY - 80) continue;
        if (tailY > this.hitY + 140) continue;

        const live = Boolean(note.hold);
        const dropped = Boolean(live && note.hold.releasedAt !== null);
        const bottom = Math.min(headY, this.hitY);
        const top = Math.max(tailY, this.topY - 6);

        if (bottom > top + 1) {
          this.drawHoldBody(top, bottom, note.lane, color, {
            alpha: live ? (dropped ? 0.4 : 0.95) : 0.7,
            dropped,
            live
          });
        }

        const x = this.laneCenter(note.lane, bottom);
        this.drawGem(x, bottom, this.laneWidthAt(bottom) * 0.5, color, {
          held: live && !dropped,
          dropped,
          alpha: dropped ? 0.65 : 1
        });

        if (live && !dropped && Math.random() < 0.22) {
          this.addParticle({
            kind: "spark",
            x: x + (Math.random() - 0.5) * this.laneWidthAt(this.hitY) * 0.35,
            y: this.hitY - Math.random() * 8,
            vx: (Math.random() - 0.5) * 40,
            vy: -50 - Math.random() * 80,
            life: 0.32,
            maxLife: 0.32,
            color,
            size: 1.6 + Math.random() * 1.6
          });
        }
        continue;
      }

      if (headY < this.topY - 60 || headY > this.hitY + 60) continue;
      this.drawGem(
        this.laneCenter(note.lane, headY),
        headY,
        this.laneWidthAt(headY) * 0.46,
        color,
        {}
      );
    }
  }

  drawGem(x, y, size, color, options) {
    const ctx = this.ctx;
    const held = Boolean(options.held);
    const dropped = Boolean(options.dropped);
    const alpha = options.alpha == null ? 1 : options.alpha;
    const r = Math.max(6, size * 0.5);

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);

    const glow = ctx.createRadialGradient(x, y, size * 0.05, x, y, size * 1.4);
    glow.addColorStop(0, hexA(held ? "#fff6e4" : color, held ? 0.45 : 0.26));
    glow.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);

    const body = ctx.createLinearGradient(-r, -r, r, r);
    body.addColorStop(0, dropped ? "#47101a" : "#fff9ef");
    body.addColorStop(0.45, dropped ? "#ff4d5e" : color);
    body.addColorStop(1, dropped ? "#190409" : "#210a1c");

    this.roundRect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56, r * 0.32);
    ctx.fillStyle = body;
    ctx.fill();

    ctx.lineWidth = Math.max(1.6, r * 0.11);
    ctx.strokeStyle = held ? "rgba(255,246,228,0.95)" : "rgba(255,246,228,0.72)";
    ctx.stroke();

    const shine = ctx.createLinearGradient(-r * 0.5, -r * 0.6, r * 0.2, r * 0.1);
    shine.addColorStop(0, "rgba(255,255,255,0.7)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    this.roundRect(-r * 0.52, -r * 0.56, r * 0.92, r * 0.3, r * 0.14);
    ctx.fillStyle = shine;
    ctx.fill();

    ctx.restore();
  }

  drawHoldBody(topY, bottomY, lane, color, options) {
    const ctx = this.ctx;
    const alpha = options.alpha == null ? 0.8 : options.alpha;
    const dropped = Boolean(options.dropped);
    const live = Boolean(options.live);
    const tint = dropped ? "#ff4d5e" : color;

    const xTop = this.laneCenter(lane, topY);
    const xBottom = this.laneCenter(lane, bottomY);
    const wTop = this.laneWidthAt(topY) * 0.225;
    const wBottom = this.laneWidthAt(bottomY) * 0.225;

    const body = ctx.createLinearGradient(0, topY, 0, bottomY);
    body.addColorStop(0, hexA(tint, alpha * 0.18));
    body.addColorStop(1, hexA(tint, alpha * 0.82));

    ctx.beginPath();
    ctx.moveTo(xTop - wTop, topY);
    ctx.lineTo(xTop + wTop, topY);
    ctx.lineTo(xBottom + wBottom, bottomY);
    ctx.lineTo(xBottom - wBottom, bottomY);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();

    ctx.strokeStyle = hexA(dropped ? "#ff4d5e" : "#fff6e4", live ? 0.5 : 0.2);
    ctx.lineWidth = 1.3;
    ctx.stroke();

    const coreTop = this.laneWidthAt(topY) * 0.045;
    const coreBottom = this.laneWidthAt(bottomY) * 0.045;
    ctx.beginPath();
    ctx.moveTo(xTop - coreTop, topY);
    ctx.lineTo(xTop + coreTop, topY);
    ctx.lineTo(xBottom + coreBottom, bottomY);
    ctx.lineTo(xBottom - coreBottom, bottomY);
    ctx.closePath();
    ctx.fillStyle = hexA(dropped ? "#ff9aa6" : "#fff6e4", alpha * 0.8);
    ctx.fill();

    const length = bottomY - topY;
    const chevrons = clamp(Math.floor(length / 48), 1, 7);
    for (let i = 1; i <= chevrons; i += 1) {
      const t = i / (chevrons + 1);
      const y = topY + length * t;
      const x = xTop + (xBottom - xTop) * t;
      const width = (wTop + (wBottom - wTop) * t) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - width, y - 5);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x + width, y - 5);
      ctx.strokeStyle = hexA(dropped ? "#ff4d5e" : "#fff6e4", alpha * 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  drawReceptors(engine, now, beat) {
    const stepMs = beat / 4;
    const barMs = beat * 4;
    const phase = ((now % barMs) + barMs) % barMs;
    const step = Math.floor(phase / stepMs);
    const onKick = KICK_STEPS.indexOf(step) !== -1;
    const stepProgress = (phase % stepMs) / stepMs;
    const kickPulse = onKick ? Math.max(0, 1 - stepProgress * 2.4) : 0;
    const ctx = this.ctx;

    for (let lane = 0; lane < 4; lane += 1) {
      const pressed = engine ? Boolean(engine.pressed[lane]) : false;
      const missPulse = this.laneMiss[lane];
      const x = this.laneCenter(lane, this.hitY);
      const width = this.laneWidthAt(this.hitY) * 0.84;
      const height = clamp(this.laneWidthAt(this.hitY) * 0.28, 16, 34);
      const scale = 1 + (pressed ? 0.07 : 0.035 * kickPulse);
      const color = LANE_COLORS[lane];

      ctx.save();
      ctx.translate(x, this.hitY);
      ctx.scale(scale, scale);

      if (pressed || missPulse > 0) {
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 1.05);
        halo.addColorStop(0, hexA(missPulse > 0.2 ? "#ff4d5e" : color, 0.42));
        halo.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, width * 1.05, 0, Math.PI * 2);
        ctx.fill();
      }

      this.roundRect(-width / 2, -height / 2, width, height, height * 0.34);
      if (pressed) {
        const fill = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
        fill.addColorStop(0, "#fff6e4");
        fill.addColorStop(1, color);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,246,228,0.95)";
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(10,6,14,0.62)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = hexA(missPulse > 0.2 ? "#ff4d5e" : color, 0.8);
        ctx.stroke();
      }

      const c = height * 0.24;
      ctx.beginPath();
      ctx.moveTo(-c, -c * 0.35);
      ctx.lineTo(0, c * 0.55);
      ctx.lineTo(c, -c * 0.35);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = pressed ? "rgba(12,6,16,0.85)" : hexA(color, 0.9);
      ctx.stroke();

      ctx.restore();
    }
  }

  drawParticles(dtS) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((particle) => (particle.life -= dtS) > 0);

    for (const particle of this.particles) {
      const t = clamp(particle.life / particle.maxLife, 0, 1);

      if (particle.kind === "ring") {
        particle.r += particle.grow * dtS;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(particle.color, t * 0.95);
        ctx.lineWidth = particle.width * t + 0.6;
        ctx.stroke();
      } else if (particle.kind === "spark") {
        particle.x += particle.vx * dtS;
        particle.y += particle.vy * dtS;
        particle.vy += 260 * dtS;
        ctx.fillStyle = hexA(particle.color, t);
        const size = particle.size || 2.4;
        ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size * 1.5);
      } else if (particle.kind === "shard") {
        particle.x += particle.vx * dtS;
        particle.y += particle.vy * dtS;
        particle.vy += 420 * dtS;
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.vy * 0.01);
        ctx.fillStyle = hexA(particle.color, t);
        ctx.fillRect(-particle.size / 2, -particle.size, particle.size, particle.size * 2);
        ctx.restore();
      } else if (particle.kind === "flash") {
        const gradient = ctx.createRadialGradient(
          particle.x,
          particle.y,
          0,
          particle.x,
          particle.y,
          particle.r
        );
        gradient.addColorStop(0, hexA(particle.color, t * 0.6));
        gradient.addColorStop(1, hexA(particle.color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(
          particle.x - particle.r,
          particle.y - particle.r,
          particle.r * 2,
          particle.r * 2
        );
      }
    }
  }

  drawFloaters(dtS) {
    const ctx = this.ctx;
    this.floaters = this.floaters.filter((floater) => (floater.life -= dtS) > 0);

    for (const floater of this.floaters) {
      const t = clamp(floater.life / floater.maxLife, 0, 1);
      const progress = 1 - t;
      const y = floater.y - floater.rise * progress;
      const pop = floater.chant ? 0.86 + 0.14 * Math.min(1, progress * 6) : 1;
      const fade = floater.chant ? Math.min(1, t * 2.4) : Math.min(1, t * 3.2);

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font =
        (floater.chant ? "400 " : "800 ") +
        Math.round(floater.size * pop) +
        "px " +
        (floater.chant ? DISPLAY_FONT : BODY_FONT);

      if (floater.chant) {
        ctx.translate(floater.x, y);
        ctx.rotate(-0.045);
        ctx.transform(1, 0, -0.16, 1, 0, 0);

        const gradient = ctx.createLinearGradient(0, -floater.size * 0.6, 0, floater.size * 0.6);
        gradient.addColorStop(0, "#fff6e4");
        gradient.addColorStop(0.55, "#ffd23f");
        gradient.addColorStop(1, "#ff2d78");

        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(10,4,10,0.9)";
        ctx.strokeText(floater.text, 0, 0);

        ctx.fillStyle = gradient;
        ctx.fillText(floater.text, 0, 0);
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = floater.color;
        ctx.fillText(floater.text, floater.x, y);
      }

      ctx.restore();
    }
  }

  drawConfetti(dtS) {
    if (!this.confetti.length) return;
    const ctx = this.ctx;
    this.confetti = this.confetti.filter((piece) => piece.y < this.h + 60);

    for (const piece of this.confetti) {
      piece.x += piece.vx * dtS;
      piece.y += piece.vy * dtS;
      piece.vy += 60 * dtS;
      piece.spin += piece.vspin * dtS;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.spin);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    }
  }

  drawHud(engine, now, chartEnd, startAt) {
    const ctx = this.ctx;
    const pad = Math.max(14, this.w * 0.045);
    const scoreSize = clamp(this.h * 0.038, 20, 32);
    const scoreY = Math.min(this.scoreY, this.vibeY - 30);

    ctx.save();
    ctx.textBaseline = "alphabetic";

    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#fff6e4";
    ctx.font = "400 " + Math.round(scoreSize) + "px " + DISPLAY_FONT;
    ctx.fillText(String(engine.score), pad, scoreY);

    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffc93c";
    ctx.font = "800 " + Math.round(scoreSize * 0.36) + "px " + BODY_FONT;
    ctx.fillText(
      engine.accuracy +
        "% ACC" +
        (engine.multiplier > 1 ? "   ×" + engine.multiplier.toFixed(2) : ""),
      pad,
      scoreY + scoreSize * 0.66
    );

    if (engine.combo >= 3) {
      const pop = 1 + this.comboPop * 0.18;
      const size = clamp(this.h * 0.08, 38, 80) * pop;
      const y = this.h * 0.29;

      ctx.textAlign = "center";
      ctx.shadowBlur = 18;
      ctx.font = "400 " + Math.round(size) + "px " + DISPLAY_FONT;
      ctx.fillStyle = "rgba(255,246,228,0.96)";
      ctx.fillText(String(engine.combo), this.cx, y);

      ctx.shadowBlur = 8;
      ctx.font = "800 " + Math.round(size * 0.17) + "px " + BODY_FONT;
      ctx.fillStyle = "rgba(255,201,60,0.95)";
      ctx.fillText("COMBO", this.cx, y - size * 0.62);
    }

    ctx.shadowBlur = 0;

    // Fever: a run that has held a 30 combo glows gold until it breaks.
    if (engine.combo >= 30) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 95);
      ctx.save();
      ctx.globalAlpha = 0.05 + pulse * 0.05;
      const fever = ctx.createRadialGradient(
        this.cx,
        this.hitY,
        this.h * 0.16,
        this.cx,
        this.hitY,
        this.h * 0.78
      );
      fever.addColorStop(0, "rgba(255,201,60,0)");
      fever.addColorStop(1, "#ffc93c");
      ctx.fillStyle = fever;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();

      ctx.save();
      ctx.textAlign = "center";
      ctx.shadowColor = "#ffc93c";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "rgba(255,201,60,0.92)";
      ctx.font = "400 " + Math.round(clamp(this.w * 0.05, 15, 28)) + "px " + DISPLAY_FONT;
      ctx.fillText("FEVER", this.cx, this.h * 0.135);
      ctx.restore();
    }

    ctx.shadowBlur = 0;
    const span = Math.max(1, chartEnd - (startAt || 0));
    const progress = clamp((now - (startAt || 0)) / span, 0, 1);
    ctx.fillStyle = "rgba(255,246,228,0.12)";
    ctx.fillRect(0, 0, this.w, 3);
    const bar = ctx.createLinearGradient(0, 0, this.w, 0);
    bar.addColorStop(0, "#ff2d78");
    bar.addColorStop(0.5, "#ffc93c");
    bar.addColorStop(1, "#25d6c0");
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, this.w * progress, 3);

    const vibeWidth = this.w - pad * 2;
    const vibeHeight = 6;
    ctx.fillStyle = "rgba(255,246,228,0.12)";
    this.roundRect(pad, this.vibeY, vibeWidth, vibeHeight, vibeHeight / 2);
    ctx.fill();

    const vibe = clamp(engine.vibe / 100, 0, 1);
    const vibeGradient = ctx.createLinearGradient(pad, 0, pad + vibeWidth, 0);
    vibeGradient.addColorStop(0, "#ff2d78");
    vibeGradient.addColorStop(0.55, "#ffc93c");
    vibeGradient.addColorStop(1, "#25d6c0");
    ctx.fillStyle = vibeGradient;
    this.roundRect(pad, this.vibeY, Math.max(0.001, vibeWidth * vibe), vibeHeight, vibeHeight / 2);
    ctx.fill();

    if (engine.breaks > 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,246,228,0.72)";
      ctx.font = "800 10px " + BODY_FONT;
      ctx.fillText(engine.breaks + " DROPS", this.w - pad, this.vibeY - 8);
    }

    ctx.restore();
  }

  roundRect(x, y, width, height, radius) {
    const ctx = this.ctx;
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
