// The dance crew: two dancers flanking the highway.
//
// They are drawn procedurally — no sprite art — from a small two-segment rig,
// and their motion is built on the Jersey club five-kick bar (16th steps 1, 5,
// 9, 12, 15). That back-half compression is the genre's forward-tipping bounce,
// so the dancers pulse on it while their shoulders and hands catch the off-beats.
//
// The move set rotates every two bars so a run reads as a dance, not a loop:
//   0 heel-toe     — the foundational V swivel
//   1 swing dat    — hands cradled, knees knocking
//   2 percolator   — dip low, rise on the beat
//   3 running man  — alternating knee lifts (the 2016 challenge step)
//
// They are silhouettes on purpose: dark bodies with a lane-coloured rim, so they
// read at phone size and stay a mood rather than a caricature.

const KICK_STEPS = [0, 4, 8, 11, 14];
const STEPS_PER_BAR = 16;

const BODY = "rgba(13, 10, 19, 0.95)";
const PANTS = "rgba(22, 18, 31, 0.96)";
const SHOE = "#f4efe4";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function drawDancer(ctx, options) {
  const beatPos = options.beatPos;
  const kick = options.kick;
  const moveIndex = options.moveIndex;
  const energy = clamp(options.energy, 0, 1);
  const reaction = clamp(options.reaction, 0, 1);
  const slump = clamp(options.slump, 0, 1);
  const rim = options.rim;

  const bounce = kick * (3 + energy * 5);
  const sway = Math.sin(beatPos * Math.PI) * (2.5 + energy * 3);
  const dip = moveIndex === 2 ? kick * 8 : 0;
  const hipY = -22 + bounce + dip;
  const shoulderY = -58 + bounce + dip + slump * 6;
  const swing = Math.sin(beatPos * Math.PI * 2);

  let leftFoot = { x: -13, y: 0 };
  let rightFoot = { x: 13, y: 0 };

  if (moveIndex === 0) {
    // Heel-toe: the V swivels out on the kick and back in.
    const v = Math.sin(beatPos * Math.PI);
    leftFoot = { x: -13 - v * 5, y: -Math.max(0, swing) * 5 };
    rightFoot = { x: 13 + v * 5, y: -Math.max(0, -swing) * 5 };
  } else if (moveIndex === 1) {
    // Swing dat: knees knock together and apart.
    const knock = Math.max(0, swing) * 6;
    leftFoot = { x: -13 + knock, y: 0 };
    rightFoot = { x: 13 - knock, y: 0 };
  } else if (moveIndex === 3) {
    // Running man: alternating knee lifts on the beat.
    const lift = 12 + energy * 8;
    leftFoot = { x: -14, y: -Math.max(0, swing) * lift };
    rightFoot = { x: 14, y: -Math.max(0, -swing) * lift };
  }

  ctx.save();
  ctx.translate(options.x, options.ground);
  ctx.scale(options.side * options.scale, options.scale);
  ctx.rotate(-options.side * (0.035 + energy * 0.04) + slump * options.side * 0.1);

  // Glow behind the body so the silhouette separates from the backdrop.
  ctx.save();
  ctx.globalAlpha = 0.18 + kick * 0.3;
  const glow = ctx.createRadialGradient(0, -44, 4, 0, -44, 64);
  glow.addColorStop(0, options.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -44, 64, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Floor shadow.
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = "#05040a";
  ctx.beginPath();
  ctx.ellipse(sway * 0.4, 2, 24, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Legs.
  const kneeY = hipY + 18;
  limb(ctx, { x: -4, y: hipY }, { x: leftFoot.x * 0.55, y: kneeY }, leftFoot, 10, PANTS);
  limb(ctx, { x: 4, y: hipY }, { x: rightFoot.x * 0.55, y: kneeY }, rightFoot, 10, PANTS);

  ctx.fillStyle = SHOE;
  ctx.beginPath();
  ctx.ellipse(leftFoot.x, leftFoot.y - 3, 7.5, 3.6, 0, 0, Math.PI * 2);
  ctx.ellipse(rightFoot.x, rightFoot.y - 3, 7.5, 3.6, 0, 0, Math.PI * 2);
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
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-9, hipY - 2);
  ctx.lineTo(-9.5 + sway * 0.4, shoulderY + 8);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Head, with one accurate accessory: a cap brim.
  const headY = shoulderY - 13 - slump * 3;
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.arc(sway * 0.6, headY, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(sway * 0.6 + 4, headY - 7, 11, 2.8, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // Arms.
  const shoulderX = sway * 0.6;
  let leftHand = { x: shoulderX - 16, y: shoulderY + 24 + swing * 4 };
  let rightHand = { x: shoulderX + 16, y: shoulderY + 24 - swing * 4 };

  if (moveIndex === 1) {
    leftHand = { x: shoulderX - 7, y: shoulderY + 15 };
    rightHand = { x: shoulderX + 7, y: shoulderY + 15 };
  } else if (moveIndex === 2) {
    const rise = 1 - kick;
    leftHand = { x: shoulderX - 19, y: shoulderY - 4 - rise * 14 };
    rightHand = { x: shoulderX + 19, y: shoulderY - 4 - rise * 14 };
  } else if (moveIndex === 3) {
    leftHand = { x: shoulderX - 13, y: shoulderY + 10 - swing * 11 };
    rightHand = { x: shoulderX + 13, y: shoulderY + 10 + swing * 11 };
  }

  // A hit throws the near arm out toward the side the note came from.
  if (reaction > 0) {
    if (options.reactionSide < 2) {
      leftHand = { x: shoulderX - 24 - reaction * 9, y: shoulderY - 4 - reaction * 15 };
    } else {
      rightHand = { x: shoulderX + 24 + reaction * 9, y: shoulderY - 4 - reaction * 15 };
    }
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
  ctx.globalAlpha = 0.9;
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
 * Draw both dancers. `reaction` is 0..1 for a recent hit, `reactionSide` is the
 * lane, `slump` is 0..1 for a recent miss and `energy` grows with the combo.
 */
export function drawDanceCrew(ctx, options) {
  const { w, h, cx, hitY, laneWidth, now, beatMs } = options;
  const beat = beatMs > 0 ? beatMs : 420;
  const beatPos = now / beat;
  const kick = kickPulseAt(now, beat);
  const moveIndex = Math.floor(beatPos / 8) % 4;
  const scale = clamp(h / 520, 0.85, 1.9);
  const gap = Math.min(w * 0.42, laneWidth * 2 + 42 * scale);
  const inset = 30 * scale;

  const crew = [
    { side: -1, rim: "#ff2d78", glow: "rgba(255,45,120,0.55)" },
    { side: 1, rim: "#25d6c0", glow: "rgba(37,214,192,0.5)" }
  ];

  for (let i = 0; i < crew.length; i += 1) {
    const member = crew[i];
    drawDancer(ctx, {
      x: clamp(cx + member.side * gap, inset, w - inset),
      ground: hitY + 4,
      side: member.side,
      scale,
      beatPos,
      kick,
      moveIndex,
      energy: options.energy,
      reaction: options.reaction,
      reactionSide: options.reactionSide,
      slump: options.slump,
      rim: member.rim,
      glow: member.glow
    });
  }
}
