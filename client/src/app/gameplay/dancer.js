// The dance crew: two dancers flanking the highway — four when FEVER hits.
//
// Choreography rules (from RESEARCH.md's study of the scene):
// - a DUET, not clones: the second member runs the next move in the rotation
//   off-phase, so the two never mirror perfectly;
// - phrase BLENDING: the last quarter of every two-bar phrase eases the pose
//   into the next move, so limbs travel instead of teleporting;
// - PATTY CAKE, the documented partner clap, is the one move both members do
//   together — they lean in and clap alternately on the off-beats;
// - FEVER is the escalation: the crew doubles to four and everyone rides their
//   biggest move (percolator / running man) at double-time bounce;
// - the whole crew answers the DJ call: a hit on the left lanes points the crew
//   left, the right lanes point them right (the scene's "left!"/"right!" cue);
// - heads nod into every five-kick — the bounce is head-heavy;
// - silhouettes with a lane-coloured rim: they read at phone size and stay a
//   mood rather than a caricature.

const KICK_STEPS = [0, 4, 8, 11, 14];
const STEPS_PER_BAR = 16;
const PHRASE_BEATS = 8;

const BODY = "rgba(13, 10, 19, 0.95)";
const PANTS = "rgba(22, 18, 31, 0.96)";
const SHOE = "#f4efe4";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

/** 0..1 pulse for the nearest kick on the bar, wrapping at the bar line. */
function kickPulse(step) {
  let pulse = 0;
  for (let i = 0; i < KICK_STEPS.length; i += 1) {
    let distance = (((step - KICK_STEPS[i]) % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
    if (distance > STEPS_PER_BAR / 2) distance = STEPS_PER_BAR - distance;
    pulse = Math.max(pulse, Math.max(0, 1 - distance / 1.15));
  }
  return pulse;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(from, to, t) {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

function limb(ctx, from, via, to, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(via.x, via.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * One pose: feet, hands and body offset for a move at a phase of its cycle.
 * `phase` is 0..1 through the move's cycle; `kick` is the five-kick pulse;
 * `energy` 0..1 scales amplitude with the combo. Local x is the dancer's own
 * space (positive = their front, the highway side).
 */
function poseFor(moveIndex, phase, kick, energy, side) {
  const swing = Math.sin(phase * Math.PI * 2);
  const amp = 1 + energy * 0.45;
  const pose = {
    leftFoot: { x: -13, y: 0 },
    rightFoot: { x: 13, y: 0 },
    leftHand: { x: -16, y: 24 + swing * 4 * amp },
    rightHand: { x: 16, y: 24 - swing * 4 * amp },
    dip: 0,
    lean: 0
  };

  if (moveIndex === 0) {
    // Heel-toe: the V swivels out on the kick and back in.
    const v = Math.sin(phase * Math.PI) * amp;
    pose.leftFoot = { x: -13 - v * 6, y: -Math.max(0, swing) * 6 * amp };
    pose.rightFoot = { x: 13 + v * 6, y: -Math.max(0, -swing) * 6 * amp };
  } else if (moveIndex === 1) {
    // Swing dat: hands cradled in front of the chest, knees knock in pairs.
    const knock = Math.max(0, swing) * 7 * amp;
    pose.leftFoot = { x: -13 + knock, y: 0 };
    pose.rightFoot = { x: 13 - knock, y: 0 };
    pose.leftHand = { x: -7, y: 15 };
    pose.rightHand = { x: 7, y: 15 };
  } else if (moveIndex === 2) {
    // Percolator: dip low, rise on the ball of the foot, arms pump on the rise.
    const rise = 1 - kick;
    pose.dip = kick * 10 * amp;
    pose.leftFoot = { x: -15, y: kick * 3 };
    pose.rightFoot = { x: 15, y: kick * 3 };
    pose.leftHand = { x: -20, y: -4 - rise * 18 * amp };
    pose.rightHand = { x: 20, y: -4 - rise * 18 * amp };
  } else if (moveIndex === 3) {
    // Running man: alternate knee lifts, arms pumping opposite (2016 challenge).
    const lift = (13 + energy * 9) * amp;
    pose.leftFoot = { x: -15, y: -Math.max(0, swing) * lift };
    pose.rightFoot = { x: 15, y: -Math.max(0, -swing) * lift };
    pose.leftHand = { x: -14, y: 10 - swing * 13 * amp };
    pose.rightHand = { x: 14, y: 10 + swing * 13 * amp };
  } else {
    // Patty cake: lean toward the partner, clap hands to the midline on the
    // off-beats. Each side of the duet claps alternately, partner-style.
    const clap = Math.max(0, Math.sin(phase * Math.PI * 4));
    pose.dip = kick * 4;
    pose.lean = side * 0.06;
    const reach = 6 + clap * 7;
    pose.leftHand = { x: -reach, y: 17 - clap * 5 };
    pose.rightHand = { x: reach, y: 17 - clap * 5 };
  }

  return pose;
}

function mixPose(a, b, t) {
  return {
    leftFoot: lerpPoint(a.leftFoot, b.leftFoot, t),
    rightFoot: lerpPoint(a.rightFoot, b.rightFoot, t),
    leftHand: lerpPoint(a.leftHand, b.leftHand, t),
    rightHand: lerpPoint(a.rightHand, b.rightHand, t),
    dip: lerp(a.dip, b.dip, t),
    lean: lerp(a.lean, b.lean, t)
  };
}

function drawDancer(ctx, options) {
  const beatPos = options.beatPos;
  const kick = options.kick;
  const energy = clamp(options.energy, 0, 1);
  const reaction = clamp(options.reaction, 0, 1);
  const slump = clamp(options.slump, 0, 1);
  const rim = options.rim;

  // Off-phase duet: each member's pose phase is pushed by their index, but the
  // five-kick stays global — the crew dances to the same beat, not metronomes.
  const phase = (((beatPos + options.phaseOffset) % PHRASE_BEATS) + PHRASE_BEATS) % PHRASE_BEATS;
  const phraseT = phase / PHRASE_BEATS;
  const moveIndex = options.moveIndex % 5;

  // Blend into the next move across the last quarter of the phrase.
  let pose;
  if (phraseT > 0.75) {
    const t = ease((phraseT - 0.75) / 0.25);
    pose = mixPose(
      poseFor(moveIndex, phase, kick, energy, options.side),
      poseFor((moveIndex + 1) % 5, phase - PHRASE_BEATS, kick, energy, options.side),
      t
    );
  } else {
    pose = poseFor(moveIndex, phase, kick, energy, options.side);
  }

  const bounce = kick * (3 + energy * 5) * (options.fever ? 1.35 : 1);
  const sway = Math.sin(phase * Math.PI) * (2.5 + energy * 3);
  const hipY = -22 + bounce + pose.dip;
  const shoulderY = -58 + bounce + pose.dip + slump * 6;

  ctx.save();
  ctx.translate(options.x, options.ground);
  ctx.scale(options.side * options.scale, options.scale);
  ctx.rotate(
    -options.side * (0.035 + energy * 0.04) +
      slump * options.side * 0.1 +
      pose.lean
  );

  // Glow behind the body so the silhouette separates from the backdrop.
  ctx.save();
  ctx.globalAlpha = (0.18 + kick * 0.3) * options.alpha;
  const glow = ctx.createRadialGradient(0, -44, 4, 0, -44, 64);
  glow.addColorStop(0, options.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -44, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Floor shadow.
  ctx.globalAlpha = 0.32 * options.alpha;
  ctx.fillStyle = "#05040a";
  ctx.beginPath();
  ctx.ellipse(sway * 0.4, 2, 24, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = options.alpha;

  // Legs.
  const kneeY = hipY + 18;
  limb(ctx, { x: -4, y: hipY }, { x: pose.leftFoot.x * 0.55, y: kneeY }, pose.leftFoot, 10, PANTS);
  limb(ctx, { x: 4, y: hipY }, { x: pose.rightFoot.x * 0.55, y: kneeY }, pose.rightFoot, 10, PANTS);

  ctx.fillStyle = SHOE;
  ctx.beginPath();
  ctx.ellipse(pose.leftFoot.x, pose.leftFoot.y - 3, 7.5, 3.6, 0, 0, Math.PI * 2);
  ctx.ellipse(pose.rightFoot.x, pose.rightFoot.y - 3, 7.5, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Torso.
  ctx.strokeStyle = BODY;
  ctx.lineWidth = 21;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(sway * 0.5, shoulderY);
  ctx.stroke();

  // Rim light down the leading edge.
  ctx.strokeStyle = rim;
  ctx.globalAlpha = 0.65 * options.alpha;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-9, hipY - 2);
  ctx.lineTo(-9.5 + sway * 0.4, shoulderY + 8);
  ctx.stroke();
  ctx.globalAlpha = options.alpha;

  // Head, with one accurate accessory: a cap brim. The head nods into every
  // kick — the Jersey bounce is head-heavy.
  const nod = kick * 3.4 * (1 + energy * 0.5);
  const headY = shoulderY - 13 + nod - slump * 3;
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.arc(sway * 0.6, headY, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(sway * 0.6 + 4, headY - 7 + nod * 0.4, 11, 2.8, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // Arms. Hands sit relative to the shoulder in the dancer's own space.
  const shoulderX = sway * 0.6;
  const leftHand = { x: shoulderX + pose.leftHand.x, y: shoulderY + pose.leftHand.y };
  const rightHand = { x: shoulderX + pose.rightHand.x, y: shoulderY + pose.rightHand.y };

  // The DJ call: a hit on the left lanes sends the whole crew pointing left,
  // the right lanes point them right (the scene's "left!"/"right!" cue). The
  // dancer nearest the lane throws the arm harder.
  if (reaction > 0) {
    const point = options.reactionSide < 2 ? -1 : 1;
    const strength = reaction * (options.isNear ? 1 : 0.55);
    const hand = point < 0 ? leftHand : rightHand;
    hand.x += point * (18 + strength * 16);
    hand.y = shoulderY - 4 - strength * 15;
  }

  // Slumping drops the hands.
  leftHand.y += slump * 8;
  rightHand.y += slump * 8;

  limb(
    ctx,
    { x: shoulderX - 7, y: shoulderY + 5 },
    { x: (shoulderX - 7 + leftHand.x) / 2, y: (shoulderY + 5 + leftHand.y) / 2 + 2 },
    leftHand,
    7,
    BODY
  );
  limb(
    ctx,
    { x: shoulderX + 7, y: shoulderY + 5 },
    { x: (shoulderX + 7 + rightHand.x) / 2, y: (shoulderY + 5 + rightHand.y) / 2 + 2 },
    rightHand,
    7,
    BODY
  );

  ctx.fillStyle = rim;
  ctx.globalAlpha = 0.9 * options.alpha;
  ctx.beginPath();
  ctx.arc(leftHand.x, leftHand.y, 3, 0, Math.PI * 2);
  ctx.arc(rightHand.x, rightHand.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

/** Kick pulse for a given clock time, for the camera bop. */
export function kickPulseAt(now, beatMs) {
  const beat = beatMs > 0 ? beatMs : 420;
  const step = (((now / (beat / 4)) % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  return kickPulse(step);
}

/**
 * Draw the crew. `crewHeat` (0..1, eased by the renderer) drives the FEVER
 * escalation: past its midpoint the crew doubles to four smaller dancers
 * sliding in from the edges, and everyone rides their biggest move.
 */
export function drawDanceCrew(ctx, options) {
  const { w, cx, hitY, laneWidth, now, beatMs } = options;
  const beat = beatMs > 0 ? beatMs : 420;
  const beatPos = now / beat;
  const kick = kickPulseAt(now, beat);
  const scale = clamp(options.h / 520, 0.85, 1.9);
  const heat = clamp(options.crewHeat || 0, 0, 1);
  const slide = clamp((heat - 0.5) / 0.5, 0, 1);
  const fever = Boolean(options.fever) && heat > 0.9;

  // Move rotation: each member runs the next move in the cycle, off-phase, so
  // the duet never mirrors perfectly. Patty cake pulls the partner in.
  const phraseIndex = Math.floor(beatPos / PHRASE_BEATS);
  const baseMove = fever ? 2 + (phraseIndex % 2) : phraseIndex % 5;

  const gap = Math.min(w * 0.42, laneWidth * 2 + 42 * scale);
  const inset = 26 * scale;

  const crew = [
    { side: -1, rim: "#ff2d78", glow: "rgba(255,45,120,0.55)" },
    { side: 1, rim: "#25d6c0", glow: "rgba(37,214,192,0.5)" },
    { side: -1, rim: "#ffc93c", glow: "rgba(255,201,60,0.45)" },
    { side: 1, rim: "#8b7bff", glow: "rgba(139,123,255,0.45)" }
  ];

  for (let i = 0; i < crew.length; i += 1) {
    const far = i >= 2;
    if (far && slide <= 0.02) continue;
    const member = crew[i];
    const spread = 1 + heat * 0.22;
    const alpha = far ? ease(slide) * 0.85 : 1;

    // Patty cake is the partner move: both near members take it together.
    let move = (baseMove + (i % 2)) % 5;
    if (baseMove === 4) move = 4;
    if (fever) move = i % 2 === 0 ? 2 : 3;

    drawDancer(ctx, {
      x: clamp(cx + member.side * gap * spread * (far ? 1.28 : 1), inset, w - inset),
      ground: hitY + 4,
      side: member.side,
      scale: scale * (far ? 0.78 : 1),
      beatPos: beatPos + i * 0.5,
      kick,
      moveIndex: move,
      energy: options.energy,
      reaction: options.reaction,
      reactionSide: options.reactionSide,
      slump: options.slump,
      fever,
      isNear: !far,
      alpha,
      rim: member.rim,
      glow: member.glow
    });
  }
}
