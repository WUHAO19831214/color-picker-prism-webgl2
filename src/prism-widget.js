// Interactive Prism Color Picker widget:
// Fixed-timestep 120Hz angular spring-damper & inertia physics,
// pointer drag/flick rotation, keyboard navigation, and bidirectional HUD inputs.

import {
  SECTOR_RAD,
  clamp,
  deg2rad,
  hexToHue,
  hueToWavelength,
  modPos,
  wavelengthToHex,
  wavelengthToHue,
  wrapPi,
} from "./optics.js";
import { createCamera, createPrismRenderer } from "./renderer.js";

const DT = 1 / 120;

export function mountPrismWidget(container, config) {
  const { optics } = config;
  const {
    sector,
    offsetOfHue,
    angleOfWavelength,
    lamMin,
    lamMax,
    wavelengthAt,
    hueMax,
  } = optics;

  const cam = createCamera(config);
  const hitRadius = config.ring + 6;

  // Compute projected screen bounds of the prism dial for hit-testing and focus stage
  const stageBounds = (() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      const [sx, sy] = cam.project([hitRadius * Math.cos(a), config.beamY, hitRadius * Math.sin(a)]);
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  })();

  const initialLam = wavelengthAt(deg2rad(config.start)) ?? 500;
  const initialHex = wavelengthToHex(initialLam);
  const initialHue = Math.round(wavelengthToHue(initialLam));

  // Build exact DOM structure matching .pr stylesheet
  container.innerHTML = "";
  const root = document.createElement("div");
  root.className = "pr";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Beam colour");
  root.dataset.take = config.name;
  root.dataset.layout = config.layout;
  root.style.setProperty("--color-picker-color", initialHex);

  const canvas = document.createElement("canvas");
  canvas.className = "pr-view";
  canvas.setAttribute("aria-hidden", "true");

  const stage = document.createElement("div");
  stage.className = "pr-stage";
  stage.style.left = `${stageBounds.left}px`;
  stage.style.top = `${stageBounds.top}px`;
  stage.style.width = `${stageBounds.width}px`;
  stage.style.height = `${stageBounds.height}px`;

  const prismThumb = document.createElement("div");
  prismThumb.className = "pr-prism";
  prismThumb.tabIndex = 0;
  prismThumb.setAttribute("role", "slider");
  prismThumb.setAttribute("aria-label", "Prism rotation");
  prismThumb.setAttribute("aria-valuemin", "0");
  prismThumb.setAttribute("aria-valuemax", String(Math.round(hueMax)));
  prismThumb.setAttribute("aria-valuenow", String(initialHue));
  stage.appendChild(prismThumb);

  const hit = document.createElement("div");
  hit.className = "pr-hit";
  hit.style.left = `${stageBounds.left - 26}px`;
  hit.style.top = `${stageBounds.top - 26}px`;
  hit.style.width = `${stageBounds.width + 52}px`;
  hit.style.height = `${stageBounds.height + 52}px`;

  const readout = document.createElement("div");
  readout.className = "pr-read";

  const swatch = document.createElement("div");
  swatch.className = "pr-swatch";

  const hexInput = document.createElement("input");
  hexInput.className = "pr-hex";
  hexInput.setAttribute("aria-label", "Hex");
  hexInput.spellcheck = false;
  hexInput.value = initialHex;

  const specs = document.createElement("dl");
  specs.className = "pr-specs";

  // Wavelength row
  const wlRow = document.createElement("div");
  const wlDt = document.createElement("dt");
  wlDt.textContent = "Wavelength";
  const wlDd = document.createElement("dd");
  const wlInput = document.createElement("input");
  wlInput.className = "pr-num";
  wlInput.inputMode = "decimal";
  wlInput.spellcheck = false;
  wlInput.value = initialLam.toFixed(0);
  wlInput.setAttribute("aria-label", "Wavelength in nanometres");
  const wlUnit = document.createElement("small");
  wlUnit.textContent = " nm";
  wlDd.append(wlInput, wlUnit);
  wlRow.append(wlDt, wlDd);

  // Hue row
  const hueRow = document.createElement("div");
  const hueDt = document.createElement("dt");
  hueDt.textContent = "Hue";
  const hueDd = document.createElement("dd");
  const hueInput = document.createElement("input");
  hueInput.className = "pr-hue";
  hueInput.inputMode = "numeric";
  hueInput.spellcheck = false;
  hueInput.value = String(initialHue);
  hueInput.setAttribute("aria-label", "Hue");
  const hueUnit = document.createElement("small");
  hueUnit.textContent = "°";
  hueDd.append(hueInput, hueUnit);
  hueRow.append(hueDt, hueDd);

  // Angle row
  const angRow = document.createElement("div");
  const angDt = document.createElement("dt");
  angDt.textContent = "Angle";
  const angDd = document.createElement("dd");
  const angInput = document.createElement("input");
  angInput.className = "pr-num";
  angInput.inputMode = "decimal";
  angInput.spellcheck = false;
  angInput.value = config.start.toFixed(1);
  angInput.setAttribute("aria-label", "Prism angle in degrees");
  const angUnit = document.createElement("small");
  angUnit.textContent = "°";
  angDd.append(angInput, angUnit);
  angRow.append(angDt, angDd);

  specs.append(wlRow, hueRow, angRow);
  readout.append(swatch, hexInput, specs);
  root.append(canvas, stage, hit, readout);
  container.appendChild(root);

  // Simulation state
  const sim = {
    psi: deg2rad(config.start),
    om: 0,
    mode: "free",
    target: 0,
    hue: initialHue,
    far: false,
    last: 0,
    lost: false,
    px: 0,
    py: 0,
    lam: initialLam,
    hex: initialHex,
    raw: 0,
    scaled: 0,
    glow: 1,
    focus: 0,
  };

  // Floor artwork offscreen canvas (3x oversampled)
  const artCanvas = document.createElement("canvas");
  artCanvas.width = 3 * config.world.size;
  artCanvas.height = 3 * config.world.size;
  const artCtx = artCanvas.getContext("2d");
  const paintArt = () => {
    artCtx.setTransform(1, 0, 0, 1, 0, 0);
    artCtx.fillStyle = "#000";
    artCtx.fillRect(0, 0, artCanvas.width, artCanvas.height);
    artCtx.setTransform(3, 0, 0, 3, -(3 * config.world.x0), -(3 * config.world.y0));
    config.art(artCtx, config);
  };
  paintArt();

  let renderer = null;
  try {
    renderer = createPrismRenderer(canvas, config, optics, artCanvas);
  } catch (err) {
    console.error("WebGL2 init failed:", err);
  }
  if (!renderer) {
    root.dataset.flat = "";
  }

  let alive = true;
  let needsRedraw = true;

  if (document.fonts && document.fonts.load) {
    document.fonts.load('500 8px "Geist Mono Variable"').then(() => {
      if (alive && renderer) {
        paintArt();
        renderer.reloadArt();
        needsRedraw = true;
      }
    });
  }

  // Seek helpers
  const seekHue = (hueVal) => {
    const rel = sim.psi - sector.from;
    let sectorIdx = Math.floor(rel / SECTOR_RAD);
    const rem = rel - sectorIdx * SECTOR_RAD;
    if (sim.mode !== "seek") {
      sim.far = rem > (sector.least / sector.N) * sector.width;
      if (rem > sector.width && rem - sector.width > (SECTOR_RAD - sector.width) / 2) {
        sectorIdx += 1;
        sim.far = false;
      }
    }
    sim.hue = clamp(hueVal, 0, hueMax);
    sim.target = sector.from + sectorIdx * SECTOR_RAD + offsetOfHue(sim.hue, sim.far);
    sim.target += SECTOR_RAD * Math.round((sim.psi - sim.target) / SECTOR_RAD);
    sim.mode = "seek";
  };

  const seekWavelength = (wlVal) => {
    const clamped = clamp(wlVal, lamMin, lamMax);
    const rel = sim.psi - sector.from;
    let sectorIdx = Math.floor(rel / SECTOR_RAD);
    const rem = rel - sectorIdx * SECTOR_RAD;
    if (sim.mode !== "seek") {
      sim.far = rem > (sector.least / sector.N) * sector.width;
      if (rem > sector.width && rem - sector.width > (SECTOR_RAD - sector.width) / 2) {
        sectorIdx += 1;
        sim.far = false;
      }
    }
    sim.target = sector.from + sectorIdx * SECTOR_RAD + angleOfWavelength(clamped, sim.far);
    sim.target += SECTOR_RAD * Math.round((sim.psi - sim.target) / SECTOR_RAD);
    sim.mode = "seek";
  };

  const seekAngleDeg = (degVal) => {
    const rad = deg2rad(modPos(degVal, 120));
    sim.target = Math.round((sim.psi - rad) / SECTOR_RAD) * SECTOR_RAD + rad;
    sim.mode = "seek";
  };

  // Pointer velocity ring buffer (80 ms window)
  let samples = [];
  const velTracker = {
    reset() {
      samples = [];
    },
    push(x, y) {
      const now = performance.now();
      samples.push({ t: now, x, y });
      samples = samples.filter((s) => now - s.t <= 80);
    },
    velocity() {
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t <= 80);
      if (recent.length < 2) return { x: 0, y: 0 };
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = (b.t - a.t) / 1000;
      return dt <= 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    },
  };

  // Fixed-timestep physics
  const deadZone = SECTOR_RAD - sector.width;
  const stepPhysics = (dt) => {
    if (sim.mode === "free") {
      const rem = modPos(sim.psi - sector.from, SECTOR_RAD);
      const pull = rem <= sector.width ? 0 : rem - sector.width < deadZone / 2 ? -8 : 8;
      sim.om += (pull - 1.2 * sim.om) * dt;
      const drag = 2.5 * dt;
      if (Math.abs(sim.om) <= drag && Math.abs(pull) <= 2.5) sim.om = 0;
      else sim.om -= Math.sign(sim.om) * drag;
    } else {
      const k = sim.mode === "held" ? 2500 : 420;
      const damp = sim.mode === "held" ? 100 : 41;
      sim.om += (k * (sim.target - sim.psi) - damp * sim.om) * dt;
      if (sim.mode === "seek" && Math.abs(sim.target - sim.psi) < 2e-4 && Math.abs(sim.om) < 0.004) {
        sim.psi = sim.target;
        sim.om = 0;
        sim.mode = "free";
      }
    }
    sim.psi += sim.om * dt;
    if (!Number.isFinite(sim.psi) || !Number.isFinite(sim.om)) {
      sim.psi = deg2rad(config.start);
      sim.om = 0;
      sim.mode = "free";
    }
  };

  let lastPhysTime = performance.now();
  let accum = 0;
  const syncPhysics = (flush = false) => {
    const now = performance.now();
    accum += Math.min(Math.max((now - lastPhysTime) / 1000, 0), 1 / 30);
    lastPhysTime = now;
    while (accum >= DT) {
      stepPhysics(DT);
      accum -= DT;
    }
    if (flush && accum > 1e-5) {
      stepPhysics(accum);
      accum = 0;
    }
  };

  // Pointer drag & flick on prism hit target
  const unprojectPointer = (ev) => {
    const rect = root.getBoundingClientRect();
    return cam.unproject(
      ((ev.clientX - rect.left) * 540) / rect.width,
      ((ev.clientY - rect.top) * 540) / rect.height,
      config.beamY
    );
  };

  const onPointerDown = (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    syncPhysics(true);
    root.setAttribute("data-grabbed", "");
    prismThumb.focus({ preventScroll: true });

    const [px, py] = unprojectPointer(ev);
    sim.mode = "held";
    sim.target = sim.psi;
    sim.px = px;
    sim.py = py;
    sim.lost = Math.hypot(px, py) < 12;
    sim.raw = 0;
    sim.scaled = 0;
    sim.last = Math.atan2(py, px);
    velTracker.reset();
    velTracker.push(px, py);

    try {
      hit.setPointerCapture(ev.pointerId);
    } catch {
      // Ignore synthetic events
    }

    const onMove = (mev) => {
      syncPhysics();
      const [nx, ny] = unprojectPointer(mev);
      sim.px = nx;
      sim.py = ny;
      velTracker.push(nx, ny);
      if (Math.hypot(nx, ny) < 12) {
        sim.lost = true;
        return;
      }
      const ang = Math.atan2(ny, nx);
      const delta = wrapPi(ang - sim.last);
      const gain = 0.3 + 0.7 * Math.min(1, Math.abs(delta) / 0.12);
      if (!sim.lost) {
        sim.target += delta * gain;
        sim.raw += Math.abs(delta);
        sim.scaled += Math.abs(delta * gain);
      }
      sim.last = ang;
      sim.lost = false;
    };

    const onUp = () => {
      syncPhysics();
      const v = velTracker.velocity();
      const r2 = Math.max(sim.px * sim.px + sim.py * sim.py, 1600);
      const ratio = sim.raw > 1e-6 ? sim.scaled / sim.raw : 1;
      sim.om = clamp((ratio * (sim.px * v.y - sim.py * v.x)) / r2, -32, 32);
      sim.mode = "free";
      hit.removeEventListener("pointermove", onMove);
      hit.removeEventListener("pointerup", onUp);
      hit.removeEventListener("pointercancel", onUp);
    };

    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerup", onUp);
    hit.addEventListener("pointercancel", onUp);
  };
  hit.addEventListener("pointerdown", onPointerDown);

  // Keyboard control on focused prism dial
  prismThumb.addEventListener("keydown", (ev) => {
    root.removeAttribute("data-grabbed");
    const step = ev.shiftKey ? 10 : 1;
    const curHue = sim.mode === "seek" ? sim.hue : wavelengthToHue(sim.lam);
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
      ev.preventDefault();
      seekHue(curHue + step);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
      ev.preventDefault();
      seekHue(curHue - step);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      seekHue(0);
    } else if (ev.key === "End") {
      ev.preventDefault();
      seekHue(hueMax);
    }
  });
  prismThumb.addEventListener("blur", () => root.removeAttribute("data-grabbed"));

  // Editable HUD inputs
  const commitHex = () => {
    let v = hexInput.value.trim();
    if (!v.startsWith("#")) v = `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const h = hexToHue(v);
      seekHue(h > (hueMax + 360) / 2 ? 0 : h);
    } else {
      hexInput.value = sim.hex;
    }
  };
  hexInput.addEventListener("blur", commitHex);
  hexInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      commitHex();
      hexInput.blur();
    }
  });

  wlInput.addEventListener("blur", () => {
    const val = Number.parseFloat(wlInput.value);
    seekWavelength(Number.isFinite(val) ? val : sim.lam);
  });
  wlInput.addEventListener("keydown", (ev) => {
    const dir =
      ev.key === "ArrowUp" || ev.key === "ArrowRight"
        ? 1
        : ev.key === "ArrowDown" || ev.key === "ArrowLeft"
          ? -1
          : 0;
    if (dir) {
      ev.preventDefault();
      const next = clamp(Math.round(sim.lam) + dir * (ev.shiftKey ? 10 : 1), lamMin, lamMax);
      wlInput.value = Math.round(next).toFixed(0);
      seekWavelength(next);
    } else if (ev.key === "Enter") {
      const val = Number.parseFloat(wlInput.value);
      if (Number.isFinite(val)) seekWavelength(val);
      wlInput.blur();
    }
  });

  hueInput.addEventListener("blur", () => {
    const val = Number.parseFloat(hueInput.value);
    if (Number.isFinite(val)) seekHue(val > (hueMax + 360) / 2 ? 0 : val);
    else hueInput.value = String(Math.round(wavelengthToHue(sim.lam)));
  });
  hueInput.addEventListener("keydown", (ev) => {
    const dir =
      ev.key === "ArrowUp" || ev.key === "ArrowRight"
        ? 1
        : ev.key === "ArrowDown" || ev.key === "ArrowLeft"
          ? -1
          : 0;
    if (dir) {
      ev.preventDefault();
      const cur = sim.mode === "seek" ? sim.hue : wavelengthToHue(sim.lam);
      const next = clamp(Math.round(cur) + dir * (ev.shiftKey ? 10 : 1), 0, Math.round(hueMax));
      seekHue(next);
      hueInput.value = String(Math.round(sim.hue));
      const previewHex = wavelengthToHex(hueToWavelength(sim.hue));
      root.style.setProperty("--color-picker-color", previewHex);
    } else if (ev.key === "Enter") {
      const val = Number.parseFloat(hueInput.value);
      if (Number.isFinite(val)) seekHue(val > (hueMax + 360) / 2 ? 0 : val);
      hueInput.blur();
    }
  });

  angInput.addEventListener("blur", () => {
    const val = Number.parseFloat(angInput.value);
    seekAngleDeg(Number.isFinite(val) ? val : (180 * sim.psi) / Math.PI);
  });
  angInput.addEventListener("keydown", (ev) => {
    const dir =
      ev.key === "ArrowUp" || ev.key === "ArrowRight"
        ? 1
        : ev.key === "ArrowDown" || ev.key === "ArrowLeft"
          ? -1
          : 0;
    if (dir) {
      ev.preventDefault();
      const cur = modPos((180 * sim.psi) / Math.PI, 120);
      const next = modPos(cur + dir * (ev.shiftKey ? 10 : 1), 120);
      angInput.value = next.toFixed(1);
      seekAngleDeg(next);
    } else if (ev.key === "Enter") {
      const val = Number.parseFloat(angInput.value);
      if (Number.isFinite(val)) seekAngleDeg(val);
      angInput.blur();
    }
  });

  // Render loop
  let prevPsi = NaN;
  let prevGlow = NaN;
  let prevFocus = NaN;
  let lastRenderTime = performance.now();
  let lastFrameTime = 0;
  let slowFrames = 0;
  let seed = 0;
  let rafId = 0;

  const tick = () => {
    syncPhysics();
    const now = performance.now();
    const frameDelta = now - lastFrameTime;
    lastFrameTime = now;

    if (renderer && frameDelta > 0 && frameDelta < 200) {
      slowFrames = frameDelta > 24 ? slowFrames + 1 : 0;
      if (slowFrames >= 12) {
        renderer.quality(1);
        slowFrames = 0;
      }
    }

    const dt = clamp((now - lastRenderTime) / 1000, 0, 0.1);
    lastRenderTime = now;

    const psi = sim.psi;
    const wl = wavelengthAt(psi);
    if (wl !== null) {
      sim.lam = wl;
      const hex = wavelengthToHex(wl);
      if (hex !== sim.hex) {
        sim.hex = hex;
        root.style.setProperty("--color-picker-color", hex);
        if (document.activeElement !== hexInput) hexInput.value = hex;
      }
    }

    const targetGlow = wl !== null ? 1 : 0;
    sim.glow += (targetGlow - sim.glow) * (1 - Math.exp(-dt / (targetGlow > sim.glow ? 0.035 : 0.14)));
    if (Math.abs(targetGlow - sim.glow) < 0.002) sim.glow = targetGlow;

    const targetFocus =
      root.hasAttribute("data-grabbed") || !prismThumb.matches(":focus-visible") ? 0 : 1;
    sim.focus += (targetFocus - sim.focus) * (1 - Math.exp(-dt / 0.05));
    if (Math.abs(targetFocus - sim.focus) < 0.004) sim.focus = targetFocus;

    if (
      renderer &&
      (needsRedraw || psi !== prevPsi || sim.glow !== prevGlow || sim.focus !== prevFocus)
    ) {
      needsRedraw = false;
      prevPsi = psi;
      prevGlow = sim.glow;
      prevFocus = sim.focus;
      renderer.draw(
        {
          th: psi,
          lam: wl,
          glow: sim.glow,
          glowLam: sim.lam,
          focus: sim.focus,
          seed: seed++,
        },
        true
      );
    }

    const wlText = sim.lam.toFixed(0);
    if (document.activeElement !== wlInput && wlInput.value !== wlText) wlInput.value = wlText;
    wlInput.parentElement.toggleAttribute("data-dark", wl === null);

    const hueText = String(Math.round(wavelengthToHue(sim.lam)));
    if (document.activeElement !== hueInput && hueInput.value !== hueText) hueInput.value = hueText;
    prismThumb.setAttribute("aria-valuenow", hueText);

    const angText = modPos((180 * psi) / Math.PI, 120).toFixed(1);
    if (document.activeElement !== angInput && angInput.value !== angText) angInput.value = angText;

    root.style.setProperty("--pr-glow", sim.glow.toFixed(3));
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(rafId);
      hit.removeEventListener("pointerdown", onPointerDown);
      renderer?.dispose();
    },
  };
}
