// Start-of-run timing.
//
// A run has to hand the player a readable first note: the gem needs to travel
// the highway before it asks for a tap. Easy charts get a slower highway and a
// longer lead, and a song that opens right on a note gets a short silent
// run-in so the first gem still has the full distance to fall.

export const COUNT_IN_MS = 3200;
export const MAX_PRE_ROLL_MS = 1500;

export function paceScale(difficultyId) {
  if (difficultyId === "easy") return 1.28;
  if (difficultyId === "normal") return 1.12;
  return 1;
}

/** How long a gem takes to fall the highway, in ms. */
export function travelFor(difficultyId, noteSpeed) {
  const speed = Math.max(0.5, Number(noteSpeed) || 1);
  return Math.max(700, (1900 / speed) * paceScale(difficultyId));
}

/** Time from GO to the first note reaching the line, in ms. */
export function readyLeadFor(difficultyId, travelMs) {
  const base = difficultyId === "easy" ? 3400 : difficultyId === "normal" ? 3000 : 2600;
  return Math.max(travelMs + 650, base);
}

/** Where the audio starts: early enough to leave the full lead-in. */
export function startFor(firstNoteAt, chartStartAt, readyLeadMs) {
  return Math.max(0, Math.min(Number(chartStartAt) || 0, firstNoteAt - readyLeadMs));
}

/** Silent run-in used when the song opens too close to its first note. */
export function preRollFor(firstNoteAt, startAt, readyLeadMs) {
  const achieved = Math.max(0, firstNoteAt - startAt);
  const needed = readyLeadMs - achieved;
  if (needed <= 0) return 0;
  return Math.round(Math.min(MAX_PRE_ROLL_MS, needed));
}

/** GO-to-first-note gap this run will actually have, in ms. */
export function leadInFor(firstNoteAt, startAt, preRollMs) {
  return firstNoteAt - (startAt - preRollMs);
}
