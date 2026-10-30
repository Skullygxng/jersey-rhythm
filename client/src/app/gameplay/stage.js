// The venue behind the highway.
//
// A rhythm game reads as a game rather than a prototype when the field happens
// in a place. This draws that place procedurally, cheap and dark enough to stay
// behind the notes: a brick wall, a neon sign, two speaker stacks pulsing on the
// kick, a crowd bobbing at the edges, and spotlights sweeping every few bars.
//
// Deliberately not a crime-scene or "Jersey Shore" backdrop: this is the rink /
// banquet-hall read the scene actually lives in.

const BRICK = "rgba(255, 120, 90, 0.055)";

// CC0 brick texture (Poly Haven, brick_wall_001). Loaded lazily; if it never
// arrives the procedural courses below still draw.
const WALL_URL = "media/textures/brick-wall.jpg";
let wallImage = null;
let wallPattern = null;

function getWallPattern(ctx) {
  if (typeof Image === "undefined") return null;
  if (!wallImage) {
    wallImage = new Image();
    wallImage.src = WALL_URL;
  }
  if (!wallImage.complete || !wallImage.naturalWidth) return null;
  if (!wallPattern) {
    wallPattern = ctx.createPattern(wallImage, "repeat");
  }
  return wallPattern;
}

function kickPulse(now, beat) {
  const phase = (now / beat) % 1;
  return Math.max(0, 1 - phase * 3.2);
}

export function drawStage(ctx, options) {
  const { w, h, hitY, cx, now, beatMs, heat, backdropVideo, videoOpacity } = options;
  const beat = beatMs > 0 ? beatMs : 420;
  const kick = kickPulse(now, beat);
  const bar = now / (beat * 4);

  // Wall.
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#150b1b");
  base.addColorStop(0.5, "#1e0f24");
  base.addColorStop(1, "#09050e");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Wall art: when the song has a music video and the player wants a backdrop,
  // its frame becomes the wall (dimmed further by the shade below). Otherwise
  // a real CC0 brick texture when it has loaded, procedural courses otherwise,
  // so the venue never pops in late.
  const wallHeight = hitY * 0.92;
  const videoLive =
    backdropVideo &&
    backdropVideo.readyState >= 2 &&
    backdropVideo.videoWidth > 0 &&
    videoOpacity > 0;
  if (videoLive) {
    const va = backdropVideo.videoWidth / backdropVideo.videoHeight;
    let dw = wallHeight * va;
    let dh = wallHeight;
    if (dw < w) {
      dh = w / va;
      dw = w;
    }
    ctx.save();
    ctx.globalAlpha = videoOpacity;
    ctx.drawImage(backdropVideo, (w - dw) / 2, wallHeight - dh, dw, dh);
    ctx.restore();
  } else {
    const pattern = getWallPattern(ctx);
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.scale(0.5, 0.5);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w * 2, wallHeight * 2);
      ctx.restore();
    } else {
      const brickH = Math.max(9, h * 0.017);
      const brickW = brickH * 2.4;
      ctx.fillStyle = BRICK;
      for (let row = 0; row * brickH < wallHeight; row += 1) {
        const y = row * brickH;
        const offset = row % 2 === 0 ? 0 : brickW / 2;
        for (let x = -brickW; x < w + brickW; x += brickW) {
          ctx.fillRect(x + offset, y, brickW - 1.5, brickH - 1.5);
        }
      }
    }
  }

  // Darken the wall so notes stay the brightest thing on screen.
  const shade = ctx.createLinearGradient(0, 0, 0, wallHeight);
  shade.addColorStop(0, "rgba(8, 4, 12, 0.72)");
  shade.addColorStop(0.7, "rgba(12, 6, 18, 0.5)");
  shade.addColorStop(1, "rgba(8, 4, 12, 0.86)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, wallHeight);

  // Horizon glow: the room lights, warming with the section.
  const horizon = ctx.createRadialGradient(cx, hitY * 0.92, 6, cx, hitY * 0.92, w * 0.9);
  horizon.addColorStop(0, "rgba(255, 45, 120, " + (0.14 + heat * 0.14).toFixed(3) + ")");
  horizon.addColorStop(0.55, "rgba(140, 40, 120, 0.06)");
  horizon.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, w, h);

  // Spotlights sweeping slowly, brightening on the kick.
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const sweep = Math.sin(bar * 0.8 + i * 1.7) * 0.28;
    const originX = cx + side * w * 0.34;
    const alpha = 0.05 + kick * 0.045;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255, 210, 150, " + alpha.toFixed(3) + ")";
    ctx.beginPath();
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX + side * w * 0.09, 0);
    ctx.lineTo(cx + (sweep + side * 0.16) * w, hitY * 0.95);
    ctx.lineTo(cx + (sweep - side * 0.05) * w, hitY * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Speaker stacks at the edges, cones pushing with the kick.
  const stackW = Math.max(16, w * 0.055);
  const stackH = Math.max(46, h * 0.14);
  const stackY = hitY - stackH - h * 0.02;
  for (let i = 0; i < 2; i += 1) {
    const x = i === 0 ? w * 0.035 : w - w * 0.035 - stackW;
    ctx.fillStyle = "rgba(9, 6, 13, 0.92)";
    ctx.fillRect(x, stackY, stackW, stackH);
    ctx.strokeStyle = "rgba(255, 246, 228, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, stackY + 0.5, stackW - 1, stackH - 1);
    for (let c = 0; c < 2; c += 1) {
      const cy = stackY + stackH * (c === 0 ? 0.3 : 0.72);
      const r = stackW * 0.3 * (1 + kick * 0.12);
      ctx.beginPath();
      ctx.arc(x + stackW / 2, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 45, 120, " + (0.18 + kick * 0.22).toFixed(3) + ")";
      ctx.fill();
    }
  }

  // Crowd: heads and shoulders bobbing outside the highway.
  const crowdY = hitY + h * 0.035;
  ctx.save();
  for (let i = 0; i < 18; i += 1) {
    const t = i / 17;
    const onLeft = i < 9;
    const local = onLeft ? t * 2 : (t - 0.5) * 2;
    const x = onLeft ? w * 0.02 + local * w * 0.24 : w * 0.74 + (local - 0.5) * w * 0.24;
    const bob = Math.sin(now / beat * Math.PI * 2 + i * 0.9) * (2 + kick * 3);
    const r = Math.max(6, h * 0.012) + (i % 3);
    ctx.fillStyle = "rgba(6, 4, 10, 0.9)";
    ctx.beginPath();
    ctx.arc(x, crowdY + bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, crowdY + bob + r * 1.7, r * 1.5, r * 1.05, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();

  // Floor line under the receptors, so the room has a ground.
  const floor = ctx.createLinearGradient(0, hitY, 0, h);
  floor.addColorStop(0, "rgba(255, 201, 60, 0.16)");
  floor.addColorStop(0.25, "rgba(255, 45, 120, 0.07)");
  floor.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, hitY, w, h - hitY);
}
