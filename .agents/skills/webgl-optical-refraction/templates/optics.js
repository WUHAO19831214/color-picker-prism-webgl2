// Spectral colorimetry, Cauchy glass dispersion, Fresnel reflectance,
// and 2D equilateral triangular prism ray-tracing optics.

export const SECTOR_RAD = (2 * Math.PI) / 3;

const gaussianLobe = (x, mu, sLeft, sRight) => {
  const t = (x - mu) / (x < mu ? sLeft : sRight);
  return Math.exp(-0.5 * t * t);
};

// Analytic CIE 1931 2-degree color matching functions -> linear sRGB
function cie1931ToLinearSRGB(wl) {
  const X =
    1.056 * gaussianLobe(wl, 599.8, 37.9, 31.0) +
    0.362 * gaussianLobe(wl, 442.0, 16.0, 26.7) -
    0.065 * gaussianLobe(wl, 501.1, 20.4, 26.2);
  const Y =
    0.821 * gaussianLobe(wl, 568.8, 46.9, 40.5) +
    0.286 * gaussianLobe(wl, 530.9, 16.3, 31.1);
  const Z =
    1.217 * gaussianLobe(wl, 437.0, 11.8, 36.0) +
    0.681 * gaussianLobe(wl, 459.0, 26.0, 13.8);
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

const WHITE_NORM = (() => {
  const sum = [0, 0, 0];
  for (let wl = 380; wl <= 730; wl++) {
    const c = cie1931ToLinearSRGB(wl);
    sum[0] += c[0];
    sum[1] += c[1];
    sum[2] += c[2];
  }
  return [1 / sum[0], 1 / sum[1], 1 / sum[2]];
})();

function rgbToHue([r, g, b]) {
  const mn = Math.min(r, g, b);
  const dr = r - mn;
  const dg = g - mn;
  const db = b - mn;
  const mx = Math.max(dr, dg, db);
  if (mx <= 0) return 0;
  const h = 60 * (mx === dr ? (dg - db) / mx : mx === dg ? 2 + (db - dr) / mx : 4 + (dr - dg) / mx);
  return h < 0 || h > 300 ? 0 : h;
}

const whiteBalancedRGB = (wl) => {
  const c = cie1931ToLinearSRGB(wl);
  return [c[0] * WHITE_NORM[0], c[1] * WHITE_NORM[1], c[2] * WHITE_NORM[2]];
};

const HUE_AT_440 = rgbToHue(whiteBalancedRGB(440));

// Perceptually smooth violet roll-off below 440 nm
function violetAdjustedRGB(wl) {
  const c = whiteBalancedRGB(wl);
  if (wl >= 440) return c;
  const hue = Math.min(HUE_AT_440 + ((440 - wl) * (280 - HUE_AT_440)) / 40, 288);
  const gFloor = Math.min(c[1], 0);
  return [gFloor + ((c[2] - gFloor) * (hue - 240)) / 60, c[1], c[2]];
}

const RED_NORM = (() => {
  let sumR = 0;
  for (let wl = 380; wl <= 730; wl++) sumR += violetAdjustedRGB(wl)[0];
  return 1 / sumR;
})();

// Signed linear-sRGB spectral weight for integrating white light -> rainbow dispersion
export function spectralRGB(wl) {
  const c = violetAdjustedRGB(wl);
  return [c[0] * RED_NORM, c[1], c[2]];
}

const rawHue = (wl) => (wl > 650 ? 0 : rgbToHue(spectralRGB(wl)));

const HUE_LUT = (() => {
  const N = 1281;
  const lut = Array(N);
  let runningMax = 0;
  for (let i = N - 1; i >= 0; i--) {
    runningMax = Math.max(runningMax, rawHue(380 + 0.25 * i));
    lut[i] = runningMax;
  }
  return lut;
})();

export function wavelengthToHue(wl) {
  const t = (Math.min(Math.max(wl, 380), 700) - 380) / 0.25;
  const idx = Math.min(Math.floor(t), HUE_LUT.length - 2);
  return HUE_LUT[idx] + (HUE_LUT[idx + 1] - HUE_LUT[idx]) * (t - idx);
}

export function hueToWavelength(hue) {
  if (hue <= HUE_LUT[HUE_LUT.length - 1]) {
    let i = HUE_LUT.length - 1;
    while (i > 0 && HUE_LUT[i - 1] <= hue) i--;
    return 380 + 0.25 * i;
  }
  let lo = 0;
  let hi = HUE_LUT.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (HUE_LUT[mid] > hue) lo = mid;
    else hi = mid;
  }
  const frac = HUE_LUT[lo] === HUE_LUT[hi] ? 0 : (HUE_LUT[lo] - hue) / (HUE_LUT[lo] - HUE_LUT[hi]);
  return 380 + (lo + frac) * 0.25;
}

export function hueToSrgb(hue) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  if (h < 1) return [1, x, 0];
  if (h < 2) return [x, 1, 0];
  if (h < 3) return [0, 1, x];
  if (h < 4) return [0, x, 1];
  if (h < 5) return [x, 0, 1];
  return [1, 0, x];
}

const toHexByte = (v) => Math.round(255 * v).toString(16).padStart(2, "0");

export function wavelengthToHex(wl) {
  const [r, g, b] = hueToSrgb(wavelengthToHue(wl));
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function wavelengthToLinearDisplay(wl) {
  const [r, g, b] = hueToSrgb(wavelengthToHue(wl));
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function hexToHue(hex) {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (!d) return 0;
  const h = 60 * (mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d);
  return ((h % 360) + 360) % 360;
}

// Cauchy dispersion for high-dispersion flint glass (SF11-like)
export const ior = (wl) => 1.7388 + 0.016 / (wl / 1000) ** 2;
export const wavelengthFromIor = (n) => 1000 * Math.sqrt(0.016 / (n - 1.7388));
export const dLambdaDn = (n) => 500 * Math.sqrt(0.016) * (n - 1.7388) ** -1.5;

// Unpolarized Fresnel reflectance
export function fresnel(cosI, n1, n2) {
  const sinT2 = (n1 / n2) ** 2 * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
export const modPos = (v, m) => ((v % m) + m) % m;
export const deg2rad = (deg) => (deg * Math.PI) / 180;

// Build an optical bench for an equilateral prism of circumradius rc,
// horizontal input beam at y = y0, and slit aperture at radius slitD.
export function createOptics({ rc, y0, slitD }) {
  function vertices(theta) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = theta + k * SECTOR_RAD - Math.PI / 2;
      pts.push(rc * Math.cos(a), rc * Math.sin(a));
    }
    return pts;
  }

  // Trace one ray of refractive index `n` through the prism;
  // `extraBounces = 0` gives the main transmitted ray, `1` gives the first internal reflection stray ray.
  function trace(verts, n, extraBounces = 0) {
    let x = -4 * rc - 400;
    let y = y0;
    let dx = 1;
    let dy = 0;
    let inside = false;
    let path = 0;
    let weight = 1;
    let rx = 0;
    let ry = 0;
    let rw = 0;
    let from = 0;
    const pts = [];

    for (let step = 0; step < 7; step++) {
      let bestT = Infinity;
      let ex = 0;
      let ey = 0;
      let faceId = 0;

      for (let k = 0; k < 3; k++) {
        const ax = verts[2 * k];
        const ay = verts[2 * k + 1];
        const fx = verts[((k + 1) % 3) * 2] - ax;
        const fy = verts[((k + 1) % 3) * 2 + 1] - ay;
        const denom = dx * fy - dy * fx;
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((ax - x) * fy - (ay - y) * fx) / denom;
        const u = ((ax - x) * dy - (ay - y) * dx) / denom;
        if (t > 1e-6 && u >= 0 && u <= 1 && t < bestT) {
          bestT = t;
          ex = fx;
          ey = fy;
          faceId = k + 1;
        }
      }
      if (bestT === Infinity) break;

      const hx = x + dx * bestT;
      const hy = y + dy * bestT;
      pts.push(hx, hy);
      path = 4 * path + faceId;

      const len = Math.hypot(ex, ey);
      let nx = ey / len;
      let ny = -ex / len;
      if (hx * nx + hy * ny < 0) {
        nx = -nx;
        ny = -ny;
      }

      if (inside) {
        const cosI = dx * nx + dy * ny;
        const kTerm = 1 - n * n * (1 - cosI * cosI);
        const R = kTerm < 0 ? 1 : fresnel(cosI, n, 1);
        if (kTerm < 0 || extraBounces > 0) {
          if (kTerm >= 0) {
            extraBounces--;
            weight *= R;
            from = pts.length - 2;
          }
          dx -= 2 * cosI * nx;
          dy -= 2 * cosI * ny;
        } else {
          const factor = Math.sqrt(kTerm) - n * cosI;
          dx = n * dx + factor * nx;
          dy = n * dy + factor * ny;
          return {
            pts,
            dx,
            dy,
            out: true,
            bounces: pts.length / 2 - 2,
            path,
            w: weight * (1 - R),
            wi: weight,
            from,
            rx,
            ry,
            rw,
          };
        }
      } else {
        const cosI = -(dx * nx + dy * ny);
        const invN = 1 / n;
        rw = fresnel(cosI, 1, n);
        rx = dx + 2 * cosI * nx;
        ry = dy + 2 * cosI * ny;
        weight = 1 - rw;
        const factor = invN * cosI - Math.sqrt(1 - invN * invN * (1 - cosI * cosI));
        dx = invN * dx + factor * nx;
        dy = invN * dy + factor * ny;
        inside = true;
      }
      x = hx;
      y = hy;
    }

    return {
      pts,
      dx,
      dy,
      out: false,
      bounces: 0,
      path,
      w: 0,
      wi: weight,
      from,
      rx,
      ry,
      rw,
    };
  }

  // Place the slit at the minimum-deviation exit direction of 400 nm violet light
  const slitA = (() => {
    const nViolet = ior(400);
    let bestAngle = Infinity;
    let bestTheta = 0;
    const exitAngle = (th) => {
      const tr = trace(vertices(th), nViolet);
      return tr.out && tr.bounces === 0 && tr.dy > 0 ? Math.atan2(tr.dy, tr.dx) : Infinity;
    };
    for (let i = 0; i < 480; i++) {
      const th = (i / 480) * SECTOR_RAD;
      const ang = exitAngle(th);
      if (ang < bestAngle) {
        bestAngle = ang;
        bestTheta = th;
      }
    }
    let lo = bestTheta - SECTOR_RAD / 480;
    let hi = bestTheta + SECTOR_RAD / 480;
    for (let i = 0; i < 40; i++) {
      const a = lo + (hi - lo) * 0.382;
      const b = lo + (hi - lo) * 0.618;
      if (exitAngle(a) < exitAngle(b)) hi = b;
      else lo = a;
    }
    const tr = trace(vertices((lo + hi) / 2), nViolet);
    const ox = tr.pts[tr.pts.length - 2];
    const oy = tr.pts[tr.pts.length - 1];
    const bTerm = ox * tr.dx + oy * tr.dy;
    const tHit = -bTerm + Math.sqrt(bTerm * bTerm - (ox * ox + oy * oy - slitD * slitD));
    return Math.atan2(oy + tr.dy * tHit, ox + tr.dx * tHit);
  })();

  const slitCos = Math.cos(slitA);
  const slitSin = Math.sin(slitA);
  const slitX = slitD * slitCos;
  const slitY = slitD * slitSin;

  function plateHit(ray) {
    if (!ray.out) return null;
    const denom = ray.dx * slitCos + ray.dy * slitSin;
    if (denom < 1e-6) return null;
    const ox = ray.pts[ray.pts.length - 2];
    const oy = ray.pts[ray.pts.length - 1];
    const t = ((slitX - ox) * slitCos + (slitY - oy) * slitSin) / denom;
    if (t <= 0) return null;
    const hx = ox + ray.dx * t - slitX;
    const hy = oy + ray.dy * t - slitY;
    return { t, w: hx * slitSin - hy * slitCos };
  }

  function hitOffset(verts, wl) {
    const ray = trace(verts, ior(wl));
    const hit = plateHit(ray);
    return hit ? { w: hit.w, bounces: ray.bounces } : null;
  }

  function wavelengthAt(theta, directOnly = false) {
    const verts = vertices(theta);
    let prevWl = 0;
    let prevHit = null;
    for (let wl = 390; wl <= 710; wl += 10) {
      const hit = hitOffset(verts, wl);
      if (
        hit &&
        prevHit &&
        hit.bounces === prevHit.bounces &&
        !(directOnly && hit.bounces) &&
        hit.w > 0 !== prevHit.w > 0
      ) {
        let lo = prevWl;
        let hi = wl;
        let wLo = prevHit.w;
        let wMid = prevHit.w;
        for (let iter = 0; iter < 16; iter++) {
          const mid = (lo + hi) / 2;
          const mHit = hitOffset(verts, mid);
          if (!mHit || mHit.bounces !== prevHit.bounces) break;
          wMid = mHit.w;
          if (mHit.w > 0 === wLo > 0) {
            lo = mid;
            wLo = mHit.w;
          } else {
            hi = mid;
          }
        }
        if (Math.abs(wMid) < 0.5) return (lo + hi) / 2;
      }
      prevWl = wl;
      prevHit = hit;
    }
    return null;
  }

  // Active spectral sector where direct (0-bounce) dispersed light hits the slit
  const sector = (() => {
    const isActive = (th) => {
      const wl = wavelengthAt(th, true);
      return wl !== null && wl <= 690;
    };
    const step = Math.PI / 720;
    let start = 0;
    while (start < SECTOR_RAD && !isActive(start)) start += step;
    let end = start;
    while (end < start + SECTOR_RAD && isActive(end + step)) end += step;

    const refine = (a, b) => {
      for (let i = 0; i < 30; i++) {
        const mid = (a + b) / 2;
        if (isActive(mid)) b = mid;
        else a = mid;
      }
      return b;
    };

    const from = refine(start - step, start);
    const to = refine(end + step, end);
    const table = [];
    let least = 0;
    const N = 480;
    for (let i = 0; i <= N; i++) {
      const wl = wavelengthAt(from + ((to - from) * i) / N, true) ?? 690;
      table.push(wl);
      if (table[i] < table[least]) least = i;
    }
    return { from, to, width: to - from, table, least, N };
  })();

  const hueMax = wavelengthToHue(sector.table[sector.least]);

  function angleOfWavelength(wl, farBranch) {
    const { table, least, N, width } = sector;
    let i = least;
    if (farBranch) {
      while (i < N && table[i + 1] < wl) i++;
      if (i >= N) return width;
      const frac = table[i + 1] === table[i] ? 0 : (wl - table[i]) / (table[i + 1] - table[i]);
      return ((i + Math.max(0, frac)) / N) * width;
    }
    while (i > 0 && table[i - 1] < wl) i--;
    if (i <= 0) return table[0] < wl - 0.5 ? angleOfWavelength(wl, true) : 0;
    const frac = table[i - 1] === table[i] ? 0 : (wl - table[i]) / (table[i - 1] - table[i]);
    return ((i - Math.max(0, frac)) / N) * width;
  }

  const lamMin = Math.min(...sector.table);
  const lamMax = Math.max(...sector.table);

  return {
    rc,
    y0,
    slitD,
    slitA,
    hueMax,
    sector,
    offsetOfHue: (hue, farBranch) => angleOfWavelength(hueToWavelength(Math.min(hue, hueMax)), farBranch),
    angleOfWavelength,
    lamMin,
    lamMax,
    plateHit,
    trace,
    vertices,
    wavelengthAt,
  };
}
