// Start-of-run timing.
//
// The music starts the moment the count-in ends — published rhythm games never
// run the field in silence after the countdown. The reading room comes from
// where the chart begins: a run starts early enough in the track that the first
// note is still traveling when GO lands, and Easy's slower highway gets a
// longer lead.

export const COUNT_IN_MS = 3200;

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

/** Where the music starts: early enough to give the first note full travel. */
export function startFor(firstNoteAt, readyLeadMs) {
  return Math.max(0, firstNoteAt - readyLeadMs);
}