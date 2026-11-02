// The shared musical timeline.
//
// Four things on screen pulse with the music — the dance crew, the camera bob,
// the receptor pads and the note highway — and each of them used to keep its own
// guess at where the beat was. This module is the single source: a beat position
// measured from the start of the track, and a kick pulse that fires on the
// accents a bar actually has.
//
// The default accent map is the documented Jersey club running five-kick (16th
// steps 0, 4, 8, 11, 14 of a 16-step bar). When the chart generator has measured
// the track's own low-band accents it hands them in, and everything dances to
// the record instead of to the template.

export const STEPS_PER_BAR = 16;

// Four 16th steps to a quarter-note beat.
const STEPS_PER_BEAT = 4;

export const FIVE_KICK_STEPS = [0, 4, 8, 11, 14];

// A Jersey club bar lands three to eight kicks. Outside that range a detected
// map is the onset detector guessing, so the documented five-kick stands in.
const MIN_ACCENTS = 3;
const MAX_ACCENTS = 8;

/** A safe accent map: integers in 0..15, ascending, five-kick if unusable. */
export function normaliseKickSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return FIVE_KICK_STEPS;

  const clean = [];
  for (const value of steps) {
    const step = Math.round(Number(value));
    if (!Number.isFinite(step) || step < 0 || step >= STEPS_PER_BAR) continue;
    if (clean.indexOf(step) === -1) clean.push(step);
  }

  if (clean.length < MIN_ACCENTS || clean.length > MAX_ACCENTS) return FIVE_KICK_STEPS;
  return clean.sort((a, b) => a - b);
}

/** 0..1 pulse for the nearest accent to a 16th step, wrapping at the bar line. */
export function kickPulseAtStep(step, steps) {
  const accents = normaliseKickSteps(steps);
  let pulse = 0;
  for (let i = 0; i < accents.length; i += 1) {
    let distance = ((step - accents[i]) % STEPS_PER_BAR + STEPS_PER_BAR) % STEPS_PER_BAR;
    if (distance > STEPS_PER_BAR / 2) distance = STEPS_PER_BAR - distance;
    pulse = Math.max(pulse, Math.max(0, 1 - distance / 1.15));
  }
  return pulse;
}

/** Beats elapsed since the start of the track, fractional. */
export function beatPosition(now, beatMs) {
  const beat = beatMs > 0 ? beatMs : 420;
  return now / beat;
}

/** 16th step inside the current bar, 0..15. */
export function stepInBar(now, beatMs) {
  const beat = beatMs > 0 ? beatMs : 420;
  const step = (now / (beat / STEPS_PER_BEAT)) % STEPS_PER_BAR;
  return (step % STEPS_PER_BAR + STEPS_PER_BAR) % STEPS_PER_BAR;
}

/** 0..1 kick pulse at a clock time. */
export function kickPulseAt(now, beatMs, steps) {
  return kickPulseAtStep(stepInBar(now, beatMs), steps);
}
