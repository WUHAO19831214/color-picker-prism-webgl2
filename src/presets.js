// The 3 exact prism variants from ui-feed.dev/p/color-picker-prism-1eqhn3:
// 1/3 ("plan"): Top-down protractor bench with degree numerals & connector wire
// 2/3 ("wide"): 3D angled glass prism on glossy floor with glowing frosted rod
// 3/3 ("dark", ?v=3): Top-down optical lab grid + crosshairs + clean dial

import { createOptics } from "./optics.js";

const TWO_PI = 2 * Math.PI;

export const BASE_LOOK = {
  rays: 360,
  power: 10,
  beam: 0.9,
  beamV: 2.2,
  stray: 0.5,
  strayReach: 250,
  glint: 3.5,
  glintSize: 1.8,
  scatter: 8,
  scatterSize: 1,
  sensor: 5,
  sensorSize: 2.6,
  rod: 2.5,
  haze: 1,
  hazeGlow: 0.35,
  glass: 0.45,
  glassGlow: 0.12,
  glowGains: [0.5, 0.32, 0.2, 0.13, 0.08, 0.05],
  albedo: 0.022,
  metal: 0.16,
  spill: 0.06,
  ink: 1,
  inkLit: 0.6,
  gloss: 0,
  boxLit: 1.5,
  keyDir: [0.62, -0.5, -0.45],
  key: 0.5,
  open: 0.8,
  caustic: 2.2,
  pool: [10, -10, 150, 0],
  ambient: 0.01,
  keySoft: 2.2,
  photon: 1.6,
  photonStep: 2,
  soft1: [-0.25, -0.25, 0.22, 0.22],
  soft2: [0.9, 0.3, 0.12, 0.6],
  softL: [1.4, 3.5, 0.12],
  rim: 0.5,
  bevel: 2.2,
  bloom: 0.8,
  bloomKnee: 1,
  bloomGains: [0.3, 0.2, 0.13, 0.09, 0.06, 0.04],
  exposure: 1,
  hot: 0.85,
  vignette: 0.35,
  grain: 0.02,
};

function makeSlitBoxes(optics, plateHalf, gap, sensor, height, withRod) {
  const ca = Math.cos(optics.slitA);
  const sa = Math.sin(optics.slitA);
  const sx = optics.slitD * ca;
  const sz = optics.slitD * sa;
  const jawHalf = (plateHalf - gap) / 2;
  const jawOff = (plateHalf + gap) / 2;
  const place = (across, along, h) => [
    sx + ca * along - sa * across,
    h / 2,
    sz + sa * along + ca * across,
  ];
  const boxes = [
    { c: place(-jawOff, 1.5, height), s: [1.5, height / 2, jawHalf], a: optics.slitA },
    { c: place(jawOff, 1.5, height), s: [1.5, height / 2, jawHalf], a: optics.slitA },
  ];
  if (withRod) {
    boxes.push({ c: place(0, sensor + 4, height), s: [4, height / 2, 4], a: optics.slitA });
  }
  return boxes;
}

function makeTopDownCam(cx, cy, focal) {
  return {
    pos: [270 - cx, focal, 270 - cy],
    target: [270 - cx, 0, 270 - cy],
    up: [0, 0, -1],
    focal,
  };
}

function projectToFloor(config, x, z, y) {
  const [px, py, pz] = config.cam.pos;
  const k = py / (py - y);
  return [px + (x - px) * k, pz + (z - pz) * k];
}

function drawInnerCircle(ctx, radius) {
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();
}

function drawProtractorTicks(ctx, radius, withLabels) {
  ctx.lineCap = "butt";
  for (let deg = 0; deg < 360; deg += 2) {
    const major = deg % 30 === 0;
    const mid = deg % 10 === 0;
    const rad = (deg * Math.PI) / 180 - Math.PI / 2;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    ctx.strokeStyle = major ? "#9a9a9a" : mid ? "#5e5e5e" : "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c * (radius - (major ? 11 : mid ? 7 : 3.5)), s * (radius - (major ? 11 : mid ? 7 : 3.5)));
    ctx.lineTo(c * radius, s * radius);
    ctx.stroke();
  }
  if (withLabels) {
    ctx.fillStyle = "#6e6e6e";
    ctx.font = '500 8px "Geist Mono Variable", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180 - Math.PI / 2;
      ctx.fillText(String(deg % 120), Math.cos(rad) * (radius + 11), Math.sin(rad) * (radius + 11) + 0.5);
    }
  }
}

function drawSensorRing(ctx, config) {
  const opt = config.optics;
  const dist = opt.slitD + config.sensor;
  const [x, y] = projectToFloor(
    config,
    dist * Math.cos(opt.slitA),
    dist * Math.sin(opt.slitA),
    config.beamY
  );
  ctx.strokeStyle = "#6a6a6a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, TWO_PI);
  ctx.stroke();
}

// Variant 1/3: Top-down Protractor Bench ("plan")
const opticsPlan = createOptics({ rc: 86, y0: -36, slitD: 272 });
const presetPlan = {
  id: 1,
  name: "plan",
  label: "Protractor Bench",
  optics: opticsPlan,
  prismH: 58,
  beamY: 12,
  plateHalf: 64,
  gap: 1.6,
  sensor: 24,
  boxes: [],
  rod: -1,
  mapRes: 2,
  layout: "left",
  cam: makeTopDownCam(286, 174, 720),
  world: { x0: -336, y0: -224, size: 640 },
  index: [93, 104, 0.5, 1],
  focusRing: 122,
  ring: 114,
  px: 1,
  start: 43.4,
  look: {
    ...BASE_LOOK,
    albedo: 0.02,
    open: 0.45,
    caustic: 2.4,
    pool: [20, -20, 140, 0],
    softL: [0.95, 3.5, 0.08],
    soft1: [-0.27, -0.3, 0.22, 0.22],
  },
  art(ctx, cfg) {
    drawInnerCircle(ctx, 62);
    ctx.strokeStyle = "#7a7a7a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, 0.5);
    ctx.lineTo(6, 0.5);
    ctx.moveTo(0.5, -5);
    ctx.lineTo(0.5, 6);
    ctx.stroke();
    drawProtractorTicks(ctx, cfg.ring, true);

    // 2D projected slit jaws + connector wire to the readout
    const opt = cfg.optics;
    const ca = Math.cos(opt.slitA);
    const sa = Math.sin(opt.slitA);
    const pt = (across, along) =>
      projectToFloor(
        cfg,
        opt.slitD * ca + ca * along - sa * across,
        opt.slitD * sa + sa * along + ca * across,
        cfg.beamY
      );
    ctx.lineWidth = 1;
    ctx.lineJoin = "miter";
    for (const side of [-1, 1]) {
      const quad = [
        pt(side * cfg.gap, 0),
        pt(side * cfg.plateHalf, 0),
        pt(side * cfg.plateHalf, 3.5),
        pt(side * cfg.gap, 3.5),
      ];
      ctx.beginPath();
      quad.forEach(([x, y], idx) => (idx ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = "#1c1c1c";
      ctx.fill();
      ctx.strokeStyle = "#6e6e6e";
      ctx.stroke();
    }
    const [sx, sy] = pt(0, cfg.sensor);
    const step = (302 - sy) / sa;
    const turnX = sx + ca * step;
    ctx.strokeStyle = "#2e2e2e";
    ctx.beginPath();
    ctx.moveTo(sx + 6.5 * ca, sy + 6.5 * sa);
    ctx.lineTo(turnX, sy + sa * step);
    ctx.quadraticCurveTo(turnX + (10 / sa) * ca, 312, turnX - 8, 312);
    ctx.lineTo(-246, 312);
    ctx.stroke();

    drawSensorRing(ctx, cfg);
  },
};

// Variant 2/3: 3D Angled Glass Prism ("wide")
const opticsWide = createOptics({ rc: 104, y0: -44, slitD: 290 });
const wideTarget = [52, 20, 84];
const widePitch = (36 * Math.PI) / 180;
const wideYaw = (-14 * Math.PI) / 180;
const presetWide = {
  id: 2,
  name: "wide",
  label: "3D Perspective",
  optics: opticsWide,
  prismH: 90,
  beamY: 45,
  plateHalf: 64,
  gap: 1.6,
  sensor: 24,
  boxes: makeSlitBoxes(opticsWide, 64, 1.6, 24, 72, true),
  rod: 2,
  mapRes: 1.25,
  layout: "left",
  cam: {
    pos: [
      wideTarget[0] + 760 * Math.cos(widePitch) * Math.sin(wideYaw),
      wideTarget[1] + 760 * Math.sin(widePitch),
      wideTarget[2] + 760 * Math.cos(widePitch) * Math.cos(wideYaw),
    ],
    target: wideTarget,
    up: [0, 1, 0],
    focal: 800,
  },
  world: { x0: -620, y0: -520, size: 1100 },
  index: [111, 122, 0.6, 1],
  focusRing: 144,
  ring: 136,
  px: 1.5,
  start: 43.4,
  look: {
    ...BASE_LOOK,
    gloss: 2.2,
    albedo: 0.012,
    key: 0.7,
    pool: [20, 40, 260, 0],
    hazeGlow: 0.6,
    glowGains: [0.5, 0.36, 0.26, 0.19, 0.14, 0.1],
    glassGlow: 0.3,
    metal: 0.3,
    softL: [2.2, 5, 0.14],
    soft1: [-0.3, -0.5, 0.5, 0.3],
    soft2: [1.2, 0.2, 0.15, 0.8],
    rim: 0.9,
    bevel: 2.6,
    vignette: 0.5,
    boxLit: 4,
    sensor: 2,
    rod: 1.2,
  },
  art(ctx, cfg) {
    drawInnerCircle(ctx, 84);
    drawProtractorTicks(ctx, cfg.ring, true);
  },
};

// Variant 3/3: Top-down Optical Lab Grid ("dark", ?v=3)
const opticsDark = createOptics({ rc: 104, y0: -44, slitD: 290 });
const presetDark = {
  id: 3,
  name: "dark",
  label: "Optical Lab Grid",
  optics: opticsDark,
  prismH: 70,
  beamY: 35,
  plateHalf: 64,
  gap: 1.6,
  sensor: 24,
  boxes: makeSlitBoxes(opticsDark, 64, 1.6, 24, 46, false),
  rod: -1,
  mapRes: 2,
  layout: "left",
  cam: makeTopDownCam(300, 186, 1100),
  world: { x0: -350, y0: -236, size: 640 },
  index: [111, 122, 0.5, 1],
  focusRing: 144,
  ring: 136,
  px: 1,
  start: 43.4,
  look: {
    ...BASE_LOOK,
    key: 0,
    ambient: 0,
    albedo: 0.03,
    spill: 0.1,
    ink: 0.1,
    inkLit: 2.6,
    hazeGlow: 0.6,
    glowGains: [0.5, 0.36, 0.26, 0.19, 0.14, 0.1],
    glassGlow: 0.3,
    softL: [0.5, 1.6, 0.12],
    rim: 0.22,
    vignette: 0.45,
    grain: 0.03,
    metal: 0.3,
  },
  art(ctx, cfg) {
    const { x0, y0, size } = cfg.world;
    ctx.strokeStyle = "#4a4a4a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 30 * Math.ceil(x0 / 30); x < x0 + size; x += 30) {
      ctx.moveTo(x + 0.5, y0);
      ctx.lineTo(x + 0.5, y0 + size);
    }
    for (let y = 30 * Math.ceil(y0 / 30); y < y0 + size; y += 30) {
      ctx.moveTo(x0, y + 0.5);
      ctx.lineTo(x0 + size, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = "#d0d0d0";
    ctx.beginPath();
    for (let x = 120 * Math.ceil(x0 / 120); x < x0 + size; x += 120) {
      for (let y = 120 * Math.ceil(y0 / 120); y < y0 + size; y += 120) {
        ctx.moveTo(x - 5, y + 0.5);
        ctx.lineTo(x + 6, y + 0.5);
        ctx.moveTo(x + 0.5, y - 5);
        ctx.lineTo(x + 0.5, y + 6);
      }
    }
    ctx.stroke();

    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(0, 0, cfg.ring + 1, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = "#8a8a8a";
    ctx.beginPath();
    ctx.arc(0, 0, cfg.ring + 0.5, 0, TWO_PI);
    ctx.stroke();

    drawProtractorTicks(ctx, cfg.ring, false);
    drawSensorRing(ctx, cfg);
  },
};

export const PRESETS = [presetPlan, presetWide, presetDark];
