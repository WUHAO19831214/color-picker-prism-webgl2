// WebGL2 HDR optical prism renderer:
// 1) 360-ray spectral Cauchy dispersion -> RGBA16F Gaussian beam & glint light map
// 2) 6-level Jimenez/tent pyramid -> diffuse volumetric haze glow map
// 3) 5-band 3D refractive photon tracing -> soft floor shadow & caustic key map
// 4) Scissor-optimized 3D ray-traced glass prism, metal slit jaws, frosted sensor rod & glossy floor
// 5) 6-level HDR screen bloom -> filmic tone-map, highlight desaturation, sRGB & film grain

import {
  dLambdaDn,
  ior,
  spectralRGB,
  wavelengthFromIor,
  wavelengthToLinearDisplay,
} from "./optics.js";
import {
  BEAM_SEG_FRAG,
  BEAM_SEG_VERT,
  BLUR_FRAG,
  COMPOSITE_FRAG,
  DOWNSAMPLE_FRAG,
  FLAT_FRAG,
  FLAT_VERT,
  FULLSCREEN_VERT,
  SPLAT_FRAG,
  SPLAT_VERT,
  UPSAMPLE_FRAG,
  makeSceneFrag,
} from "./shaders.js";

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

export function createCamera(config) {
  const f = norm3(sub3(config.cam.target, config.cam.pos));
  const r = norm3(cross3(f, config.cam.up));
  const u = cross3(r, f);
  const p = config.cam.pos;
  const focal = config.cam.focal;
  return {
    p,
    r,
    u,
    f,
    focal,
    project(pt) {
      const rel = sub3(pt, p);
      const z = dot3(rel, f);
      return [270 + (focal * dot3(rel, r)) / z, 270 - (focal * dot3(rel, u)) / z];
    },
    unproject(sx, sy, planeY) {
      const dir = [
        f[0] * focal + r[0] * (sx - 270) + u[0] * (270 - sy),
        f[1] * focal + r[1] * (sx - 270) + u[1] * (270 - sy),
        f[2] * focal + r[2] * (sx - 270) + u[2] * (270 - sy),
      ];
      const t = (planeY - p[1]) / dir[1];
      return [p[0] + dir[0] * t, p[2] + dir[2] * t];
    },
  };
}

export function createPrismRenderer(canvas, config, optics, artCanvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (
    !gl ||
    (!gl.getExtension("EXT_color_buffer_float") &&
      !gl.getExtension("EXT_color_buffer_half_float"))
  ) {
    return null;
  }

  if (typeof matchMedia !== "undefined" && matchMedia("(color-gamut: p3)").matches) {
    try {
      gl.drawingBufferColorSpace = "display-p3";
    } catch {
      // Fallback to default sRGB drawing buffer
    }
  }
  gl.getExtension("OES_texture_float_linear");
  const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic");

  const look = config.look;
  const cam = createCamera(config);

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile error");
    }
    return sh;
  };

  const link = (vs, fs) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? "program link error");
    }
    const cache = new Map();
    return {
      p: prog,
      u: (name) => {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(prog, name));
        return cache.get(name);
      },
    };
  };

  const progSeg = link(BEAM_SEG_VERT, BEAM_SEG_FRAG);
  const progSplat = link(SPLAT_VERT, SPLAT_FRAG);
  const progFlat = link(FLAT_VERT, FLAT_FRAG);
  const progDown = link(FULLSCREEN_VERT, DOWNSAMPLE_FRAG);
  const progUp = link(FULLSCREEN_VERT, UPSAMPLE_FRAG);
  const progBlur = link(FULLSCREEN_VERT, BLUR_FRAG);
  const progFloor = link(FULLSCREEN_VERT, makeSceneFrag(false));
  const progSolids = link(FULLSCREEN_VERT, makeSceneFrag(true));
  const progComposite = link(FULLSCREEN_VERT, COMPOSITE_FRAG);

  const makeTarget = (w, h) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  };

  const freeTarget = (t) => {
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  };

  const makePyramid = (w, h, levels) => {
    const list = [];
    for (let i = 0; i < levels; i++) {
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
      list.push(makeTarget(w, h));
    }
    return list;
  };

  const { x0, y0, size } = config.world;
  const worldRect = [x0, y0, 1 / size, 1 / size];
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  let superSample =
    navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches ? 1.25 : 2;
  const mapRes = Math.round(size * Math.min(dpr, config.mapRes) * Math.min(superSample, 1.5));

  const lightTarget = makeTarget(mapRes, mapRes);
  const glowPyramid = makePyramid(mapRes, mapRes, 6);
  const glowTarget = makeTarget(mapRes >> 1, mapRes >> 1);
  const keyTarget = makeTarget(640, 640);
  const keyTemp = makeTarget(640, 640);

  const artTex = gl.createTexture();
  const reloadArt = () => {
    gl.bindTexture(gl.TEXTURE_2D, artTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, artCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisoExt) {
      gl.texParameterf(
        gl.TEXTURE_2D,
        anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
      );
    }
  };
  reloadArt();

  // Quad & instanced buffers
  const segQuadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, segQuadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const splatQuadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, splatQuadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let segData = new Float32Array(40960);
  let segCount = 0;
  const segInstBuf = gl.createBuffer();
  const segVao = gl.createVertexArray();
  gl.bindVertexArray(segVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, segQuadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, segInstBuf);
  for (const [loc, comps, offset] of [
    [1, 4, 0],
    [2, 4, 4],
    [3, 2, 8],
  ]) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 40, 4 * offset);
    gl.vertexAttribDivisor(loc, 1);
  }

  const makeSplatVao = (instBuf) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, splatQuadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (const [loc, offset] of [
      [1, 0],
      [2, 3],
    ]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, 4 * offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    return vao;
  };

  let glintData = new Float32Array(1536);
  let glintCount = 0;
  const glintBuf = gl.createBuffer();
  const glintVao = makeSplatVao(glintBuf);

  let photonData = new Float32Array(98304);
  let photonCount = 0;
  const photonBuf = gl.createBuffer();
  const photonVao = makeSplatVao(photonBuf);

  const shadowBuf = gl.createBuffer();
  const shadowVao = gl.createVertexArray();
  gl.bindVertexArray(shadowVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const emptyVao = gl.createVertexArray();
  gl.bindVertexArray(null);

  const pushSeg = (x0, y0, x1, y1, r, g, b, sigma, f0 = 1, f1 = 1) => {
    if (10 * segCount >= segData.length) {
      const next = new Float32Array(2 * segData.length);
      next.set(segData);
      segData = next;
    }
    segData.set([x0, y0, x1, y1, r, g, b, sigma, f0, f1], 10 * segCount++);
  };

  const pushGlint = (x, y, rad, r, g, b) => {
    if (6 * glintCount >= glintData.length) {
      const next = new Float32Array(2 * glintData.length);
      next.set(glintData);
      glintData = next;
    }
    glintData.set([x, y, rad, r, g, b], 6 * glintCount++);
  };

  const pushPhoton = (x, y, rad, r, g, b) => {
    if (6 * photonCount >= photonData.length) {
      const next = new Float32Array(2 * photonData.length);
      next.set(photonData);
      photonData = next;
    }
    const o = 6 * photonCount++;
    photonData[o] = x;
    photonData[o + 1] = y;
    photonData[o + 2] = rad;
    photonData[o + 3] = r;
    photonData[o + 4] = g;
    photonData[o + 5] = b;
  };

  // Precompute spectral ray table uniformly spaced in refractive index n
  const numRays = look.rays;
  const nRed = ior(716);
  const dn = (ior(384) - nRed) / (numRays - 1);
  const rayColors = new Float32Array(3 * numRays);
  for (let i = 0; i < numRays; i++) {
    const n = nRed + dn * i;
    const rgb = spectralRGB(wavelengthFromIor(n));
    const weight = dLambdaDn(n) * dn * look.power;
    rayColors[3 * i] = rgb[0] * weight;
    rayColors[3 * i + 1] = rgb[1] * weight;
    rayColors[3 * i + 2] = rgb[2] * weight;
  }

  const farDist = 2 * size;
  const slitDir = [Math.cos(optics.slitA), Math.sin(optics.slitA)];
  const slitPos = [optics.slitD * slitDir[0], optics.slitD * slitDir[1]];

  const runBloomPyramid = (src, pyr, dst, gains, knee) => {
    gl.bindVertexArray(emptyVao);
    gl.useProgram(progDown.p);
    gl.uniform1i(progDown.u("uTex"), 0);
    gl.activeTexture(gl.TEXTURE0);
    let cur = src;
    for (let i = 0; i < pyr.length; i++) {
      const target = pyr[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.bindTexture(gl.TEXTURE_2D, cur.tex);
      gl.uniform2f(progDown.u("uTexel"), 1 / cur.w, 1 / cur.h);
      gl.uniform1f(progDown.u("uKnee"), i === 0 ? knee : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = target;
    }
    gl.useProgram(progUp.p);
    gl.uniform1i(progUp.u("uTex"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = pyr.length - 1; i > 0; i--) {
      const upper = pyr[i - 1];
      const lower = pyr[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, upper.fbo);
      gl.viewport(0, 0, upper.w, upper.h);
      gl.bindTexture(gl.TEXTURE_2D, lower.tex);
      gl.uniform2f(progUp.u("uTexel"), 1 / lower.w, 1 / lower.h);
      gl.uniform1f(progUp.u("uGain"), gains[i] / gains[i - 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.bindTexture(gl.TEXTURE_2D, pyr[0].tex);
    gl.uniform2f(progUp.u("uTexel"), 1 / pyr[0].w, 1 / pyr[0].h);
    gl.uniform1f(progUp.u("uGain"), gains[0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // 5-band caustic photon setup for key light through glass prism
  const keyDir = norm3(look.keyDir);
  const bandIor = [];
  const bandColor = [];
  for (let b = 0; b < 5; b++) {
    const wl0 = 400 + (290 * b) / 5;
    const wl1 = 400 + (290 * (b + 1)) / 5;
    const sum = [0, 0, 0];
    for (let wl = wl0; wl < wl1; wl++) {
      const c = spectralRGB(wl);
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
    }
    bandColor.push(sum);
    bandIor.push(ior((wl0 + wl1) / 2));
  }
  {
    const tot = [0, 0, 0];
    for (const c of bandColor) {
      tot[0] += c[0];
      tot[1] += c[1];
      tot[2] += c[2];
    }
    for (const c of bandColor) {
      c[0] /= tot[0];
      c[1] /= tot[1];
      c[2] /= tot[2];
    }
  }

  const prismH = config.prismH;
  const inRadius = optics.rc / 2;
  const faceNormals = new Float32Array(6);

  const tracePhoton = (px, py, pz, nx, ny, nz, energy, band) => {
    const n = bandIor[band];
    const col = bandColor[band];
    let dx = keyDir[0];
    let dy = keyDir[1];
    let dz = keyDir[2];
    const cosI = -(dx * nx + dy * ny + dz * nz);
    if (cosI <= 0) return;
    const invN = 1 / n;
    const sinT2 = 1 - invN * invN * (1 - cosI * cosI);
    const cosT = Math.sqrt(sinT2);
    const fFactor = invN * cosI - cosT;
    const rs = (cosI - n * cosT) / (cosI + n * cosT);
    const rp = (cosT - n * cosI) / (cosT + n * cosI);
    let flux = energy * (1 - (rs * rs + rp * rp) / 2);
    dx = invN * dx + fFactor * nx;
    dy = invN * dy + fFactor * ny;
    dz = invN * dz + fFactor * nz;

    for (let bounce = 0; bounce < 6; bounce++) {
      let bestT = Infinity;
      let hnx = 0;
      let hny = 0;
      let hnz = 0;
      for (let k = 0; k < 3; k++) {
        const fnx = faceNormals[2 * k];
        const fnz = faceNormals[2 * k + 1];
        const den = fnx * dx + fnz * dz;
        if (den > 1e-9) {
          const t = (inRadius - (fnx * px + fnz * pz)) / den;
          if (t < bestT) {
            bestT = t;
            hnx = fnx;
            hny = 0;
            hnz = fnz;
          }
        }
      }
      if (dy > 1e-9 && (prismH - py) / dy < bestT) {
        bestT = (prismH - py) / dy;
        hnx = 0;
        hny = 1;
        hnz = 0;
      }
      if (dy < -1e-9 && -py / dy < bestT) {
        bestT = -py / dy;
        hnx = 0;
        hny = -1;
        hnz = 0;
      }
      if (!(bestT < Infinity)) return;

      px += dx * bestT;
      py += dy * bestT;
      pz += dz * bestT;

      if (hny < 0) {
        pushPhoton(px, pz, look.photon, col[0] * flux, col[1] * flux, col[2] * flux);
        return;
      }

      const c2 = dx * hnx + dy * hny + dz * hnz;
      const kTerm = 1 - n * n * (1 - c2 * c2);
      let R = 1;
      if (kTerm >= 0) {
        const ct2 = Math.sqrt(kTerm);
        const rs2 = (n * c2 - ct2) / (n * c2 + ct2);
        const rp2 = (n * ct2 - c2) / (n * ct2 + c2);
        R = (rs2 * rs2 + rp2 * rp2) / 2;
        const fac = ct2 - n * c2;
        const odx = n * dx + fac * hnx;
        const ody = n * dy + fac * hny;
        const odz = n * dz + fac * hnz;
        if (ody < -0.001) {
          const tFloor = -py / ody;
          const outFlux = flux * (1 - R);
          pushPhoton(
            px + odx * tFloor,
            pz + odz * tFloor,
            look.photon,
            col[0] * outFlux,
            col[1] * outFlux,
            col[2] * outFlux
          );
        }
      }
      flux *= R;
      if (flux < 0.03 * energy) return;
      dx -= 2 * c2 * hnx;
      dy -= 2 * c2 * hny;
      dz -= 2 * c2 * hnz;
    }
  };

  const shadowTris = [];
  const pushShadowPrism = (poly, height) => {
    const sx = -(keyDir[0] / keyDir[1]) * height;
    const sz = -(keyDir[2] / keyDir[1]) * height;
    const n = poly.length / 2;
    for (let i = 1; i + 1 < n; i++) {
      shadowTris.push(
        poly[0], poly[1],
        poly[2 * i], poly[2 * i + 1],
        poly[2 * i + 2], poly[2 * i + 3]
      );
      shadowTris.push(
        poly[0] + sx, poly[1] + sz,
        poly[2 * i] + sx, poly[2 * i + 1] + sz,
        poly[2 * i + 2] + sx, poly[2 * i + 3] + sz
      );
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = poly[2 * i];
      const az = poly[2 * i + 1];
      const bx = poly[2 * j];
      const bz = poly[2 * j + 1];
      shadowTris.push(
        ax, az, bx, bz, bx + sx, bz + sz,
        ax, az, bx + sx, bz + sz, ax + sx, az + sz
      );
    }
  };

  let curW = 0;
  let curH = 0;
  let sceneTarget = null;
  let bloomPyramid = [];
  let bloomTarget = null;
  let lastKeyTheta = NaN;

  const ensureSize = () => {
    const w = Math.round(canvas.clientWidth * dpr) || 2;
    const h = Math.round(canvas.clientHeight * dpr) || 2;
    if (w === curW && h === curH) return;
    curW = w;
    curH = h;
    canvas.width = w;
    canvas.height = h;
    if (sceneTarget) freeTarget(sceneTarget);
    if (bloomTarget) freeTarget(bloomTarget);
    bloomPyramid.forEach(freeTarget);
    const sw = Math.round(w * superSample);
    const sh = Math.round(h * superSample);
    sceneTarget = makeTarget(sw, sh);
    bloomPyramid = makePyramid(sw, sh, 6);
    bloomTarget = makeTarget(sw >> 1, sh >> 1);
  };

  const buildLightMap = (state) => {
    segCount = 0;
    glintCount = 0;
    const verts = optics.vertices(state.th);
    const sigma = look.beam;
    const power = look.power;
    const centerRay = optics.trace(verts, ior(550));
    if (!centerRay.pts.length) {
      pushSeg(-farDist, optics.y0, farDist, optics.y0, power, power, power, sigma);
      return;
    }

    // Incident white laser beam
    pushSeg(-farDist, optics.y0, centerRay.pts[0], centerRay.pts[1], power, power, power, sigma);

    // Primary specular reflection off the first glass face
    const reflPower = centerRay.rw * power * look.stray;
    pushSeg(
      centerRay.pts[0],
      centerRay.pts[1],
      centerRay.pts[0] + centerRay.rx * look.strayReach,
      centerRay.pts[1] + centerRay.ry * look.strayReach,
      reflPower,
      reflPower,
      reflPower,
      sigma,
      1,
      0
    );

    // Entry glint
    const glintPower = power * look.glint;
    pushGlint(centerRay.pts[0], centerRay.pts[1], look.glintSize, glintPower, glintPower, glintPower);

    let exitX = 0;
    let exitY = 0;
    let exitW = 0;

    // Pass 0: main refracted dispersion; Pass 1: internal stray reflections
    for (let pass = 0; pass < 2; pass++) {
      const gain = pass ? look.stray : 1;
      for (let i = 0; i < numRays; i++) {
        const ray = optics.trace(verts, nRed + dn * i, pass);
        if (pass && !ray.from) continue;
        const r = rayColors[3 * i] * gain;
        const g = rayColors[3 * i + 1] * gain;
        const b = rayColors[3 * i + 2] * gain;
        const pts = ray.pts;
        const wi = ray.wi;

        for (let k = pass ? ray.from : 0; k + 3 < pts.length; k += 2) {
          pushSeg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], r * wi, g * wi, b * wi, sigma);
        }
        if (!ray.out) continue;

        const ox = pts[pts.length - 2];
        const oy = pts[pts.length - 1];
        const w = ray.w;
        let len = farDist;
        const hit = optics.plateHit(ray);
        const hitsJaw = hit !== null && Math.abs(hit.w) < config.plateHalf && Math.abs(hit.w) > config.gap;
        const hitsSlit = hit !== null && Math.abs(hit.w) <= config.gap;

        if (hitsJaw) len = hit.t;
        if (hitsSlit) {
          const cosA = ray.dx * slitDir[0] + ray.dy * slitDir[1];
          len = hit.t + config.sensor / cosA;
        }

        if (pass) {
          const reach = Math.min(len, look.strayReach);
          const fadeEnd = len < look.strayReach ? 1 - len / look.strayReach : 0;
          pushSeg(ox, oy, ox + ray.dx * reach, oy + ray.dy * reach, r * w, g * w, b * w, sigma, 1, fadeEnd);
        } else {
          pushSeg(ox, oy, ox + ray.dx * len, oy + ray.dy * len, r * w, g * w, b * w, sigma);
          exitX += ox * w;
          exitY += oy * w;
          exitW += w;
        }

        if (hitsJaw) {
          const hx = ox + ray.dx * len;
          const hy = oy + ray.dy * len;
          const sc = look.scatter * w;
          pushGlint(
            hx - 0.6 * slitDir[0],
            hy - 0.6 * slitDir[1],
            look.scatterSize,
            r * sc,
            g * sc,
            b * sc
          );
        }
      }
    }

    // Exit glint
    if (exitW > 0) {
      pushGlint(
        exitX / exitW,
        exitY / exitW,
        look.glintSize,
        0.8 * glintPower,
        0.8 * glintPower,
        0.8 * glintPower
      );
    }

    // Glowing sensor spot behind the slit
    if (state.glow > 0.001) {
      const col = wavelengthToLinearDisplay(state.glowLam);
      const sx = slitPos[0] + slitDir[0] * config.sensor;
      const sy = slitPos[1] + slitDir[1] * config.sensor;
      const intensity = state.glow * look.sensor * power;
      pushGlint(sx, sy, look.sensorSize, col[0] * intensity, col[1] * intensity, col[2] * intensity);
      pushGlint(
        sx,
        sy,
        3.2 * look.sensorSize,
        col[0] * intensity * 0.5,
        col[1] * intensity * 0.5,
        col[2] * intensity * 0.5
      );
    }
  };

  const buildKeyMap = (theta) => {
    photonCount = 0;
    shadowTris.length = 0;
    const verts = optics.vertices(theta);
    for (let k = 0; k < 3; k++) {
      const a = theta + ((2 * Math.PI) / 3) * k - Math.PI / 6;
      faceNormals[2 * k] = Math.cos(a);
      faceNormals[2 * k + 1] = Math.sin(a);
    }

    pushShadowPrism(verts, prismH);
    for (const box of config.boxes) {
      const [cx, , cz] = box.c;
      const [sx, sy, sz] = box.s;
      const ca = Math.cos(box.a);
      const sa = Math.sin(box.a);
      const poly = [];
      for (const [ex, ez] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        poly.push(cx + ca * sx * ex - sa * sz * ez, cz + sa * sx * ex + ca * sz * ez);
      }
      pushShadowPrism(poly, box.c[1] + sy);
    }

    // Trace photons entering the top face of the prism
    const step = look.photonStep;
    const area = step * step;
    const cosTop = -keyDir[1];
    const R = optics.rc;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        let inside = true;
        for (let k = 0; k < 3; k++) {
          if (faceNormals[2 * k] * x + faceNormals[2 * k + 1] * z > inRadius) inside = false;
        }
        if (inside) {
          for (let b = 0; b < 5; b++) tracePhoton(x, prismH, z, 0, 1, 0, area * cosTop, b);
        }
      }
    }

    // Trace photons entering illuminated side faces
    for (let k = 0; k < 3; k++) {
      const fnx = faceNormals[2 * k];
      const fnz = faceNormals[2 * k + 1];
      const cosSide = -(keyDir[0] * fnx + keyDir[2] * fnz);
      if (cosSide <= 0.01) continue;
      const ax = verts[2 * k];
      const az = verts[2 * k + 1];
      const bx = verts[((k + 1) % 3) * 2];
      const bz = verts[((k + 1) % 3) * 2 + 1];
      const edgeLen = Math.hypot(bx - ax, bz - az);
      const nu = Math.max(1, Math.round(edgeLen / step));
      const nv = Math.max(1, Math.round(prismH / step));
      const patchEnergy = (edgeLen / nu) * (prismH / nv) * cosSide;
      for (let iu = 0; iu < nu; iu++) {
        const u = (iu + 0.5) / nu;
        for (let iv = 0; iv < nv; iv++) {
          const y = ((iv + 0.5) / nv) * prismH;
          for (let b = 0; b < 5; b++) {
            tracePhoton(ax + (bx - ax) * u, y, az + (bz - az) * u, fnx, 0, fnz, patchEnergy, b);
          }
        }
      }
    }
  };

  const computeSolidScissors = (theta) => {
    const rects = [];
    const w = sceneTarget.w;
    const h = sceneTarget.h;
    const addBounds = (pts) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of pts) {
        const [sx, sy] = cam.project(pt);
        if (sx < minX) minX = sx;
        if (sy < minY) minY = sy;
        if (sx > maxX) maxX = sx;
        if (sy > maxY) maxY = sy;
      }
      const scale = w / 540;
      const x0 = Math.max(0, Math.floor((minX - 2) * scale));
      const y0 = Math.max(0, Math.floor((minY - 2) * scale));
      const x1 = Math.min(w, Math.ceil((maxX + 2) * scale));
      const y1 = Math.min(h, Math.ceil((maxY + 2) * scale));
      if (x1 > x0 && y1 > y0) rects.push([x0, h - y1, x1 - x0, y1 - y0]);
    };

    const yLevels = look.gloss > 0 ? [-1, 1] : [0, 1];
    const verts = optics.vertices(theta);
    const prismPts = [];
    for (let k = 0; k < 3; k++) {
      for (const yMul of yLevels) prismPts.push([verts[2 * k], yMul * prismH, verts[2 * k + 1]]);
    }
    addBounds(prismPts);

    const boxPts = [];
    for (const box of config.boxes) {
      const ca = Math.cos(box.a);
      const sa = Math.sin(box.a);
      const topY = box.c[1] + box.s[1];
      for (const [ex, ez] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        for (const yMul of yLevels) {
          boxPts.push([
            box.c[0] + ca * box.s[0] * ex - sa * box.s[2] * ez,
            yMul * topY,
            box.c[2] + sa * box.s[0] * ex + ca * box.s[2] * ez,
          ]);
        }
      }
    }
    if (boxPts.length) addBounds(boxPts);
    return rects;
  };

  const renderScene = (state) => {
    const w = sceneTarget.w;
    const h = sceneTarget.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fbo);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(emptyVao);

    const normals = new Float32Array(6);
    for (let k = 0; k < 3; k++) {
      const a = state.th + ((2 * Math.PI) / 3) * k - Math.PI / 6;
      normals[2 * k] = Math.cos(a);
      normals[2 * k + 1] = Math.sin(a);
    }

    const boxes = config.boxes;
    const bindSceneUniforms = (prog) => {
      gl.useProgram(prog.p);
      const bindTex = (unit, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(prog.u(name), unit);
      };
      bindTex(0, lightTarget.tex, "uLight");
      bindTex(1, glowTarget.tex, "uGlow");
      bindTex(2, artTex, "uArt");
      bindTex(3, keyTarget.tex, "uKeyMap");

      gl.uniform2f(prog.u("uRes"), w, h);
      gl.uniform1f(prog.u("uPx"), config.px * (540 / w));
      gl.uniform3fv(prog.u("uCamP"), cam.p);
      gl.uniform3fv(prog.u("uCamR"), cam.r);
      gl.uniform3fv(prog.u("uCamU"), cam.u);
      gl.uniform3fv(prog.u("uCamF"), cam.f);
      gl.uniform1f(prog.u("uFocal"), cam.focal);

      gl.uniform2fv(prog.u("uN"), normals);
      gl.uniform1f(prog.u("uIn"), inRadius);
      gl.uniform1f(prog.u("uH"), prismH);
      gl.uniform1f(prog.u("uBev"), look.bevel);
      gl.uniform3f(prog.u("uIor"), ior(612), ior(549), ior(465));
      gl.uniform1f(prog.u("uTheta"), state.th);

      gl.uniform4fv(prog.u("uRect"), worldRect);
      gl.uniform1f(prog.u("uBeamY"), config.beamY);
      gl.uniform1f(prog.u("uBeamV"), look.beamV);

      gl.uniform1i(prog.u("uBoxN"), boxes.length);
      gl.uniform1i(prog.u("uBoxGlowI"), config.rod);
      const glowRgb = wavelengthToLinearDisplay(state.glowLam);
      const rodGain = state.glow * look.rod;
      gl.uniform3f(prog.u("uBoxGlow"), glowRgb[0] * rodGain, glowRgb[1] * rodGain, glowRgb[2] * rodGain);
      if (boxes.length) {
        gl.uniform3fv(prog.u("uBoxC"), boxes.flatMap((b) => b.c));
        gl.uniform3fv(prog.u("uBoxS"), boxes.flatMap((b) => b.s));
        gl.uniform2fv(prog.u("uBoxR"), boxes.flatMap((b) => [Math.cos(b.a), Math.sin(b.a)]));
      }

      gl.uniform3fv(prog.u("uKeyDir"), keyDir);
      gl.uniform4fv(prog.u("uPool"), look.pool);
      gl.uniform1f(prog.u("uKey"), look.key);
      gl.uniform1f(prog.u("uAmb"), look.ambient);
      gl.uniform1f(prog.u("uAlbedo"), look.albedo);
      gl.uniform1f(prog.u("uMetal"), look.metal);
      gl.uniform1f(prog.u("uRim"), look.rim);
      gl.uniform1f(prog.u("uOpen"), look.open);
      gl.uniform1f(prog.u("uCaustic"), look.caustic);
      gl.uniform1f(prog.u("uSpill"), look.spill);
      gl.uniform1f(prog.u("uInk"), look.ink);
      gl.uniform1f(prog.u("uInkLit"), look.inkLit);
      gl.uniform1f(prog.u("uHaze"), look.haze);
      gl.uniform1f(prog.u("uGlowK"), look.hazeGlow);
      gl.uniform1f(prog.u("uGlassK"), look.glass);
      gl.uniform1f(prog.u("uGlassGlow"), look.glassGlow);
      gl.uniform1f(prog.u("uGloss"), look.gloss);
      gl.uniform1f(prog.u("uBoxLit"), look.boxLit);
      gl.uniform4fv(prog.u("uSoft1"), look.soft1);
      gl.uniform4fv(prog.u("uSoft2"), look.soft2);
      gl.uniform3fv(prog.u("uSoftL"), look.softL);
      gl.uniform4fv(prog.u("uIndex"), config.index);
      gl.uniform4f(prog.u("uRing"), config.focusRing, 0.5, state.focus, state.focus);
    };

    // Fast floor pass over full frame
    bindSceneUniforms(progFloor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // High-precision adaptive-AA ray-traced solids pass only inside projected bounding boxes
    bindSceneUniforms(progSolids);
    gl.enable(gl.SCISSOR_TEST);
    for (const [sx, sy, sw, sh] of computeSolidScissors(state.th)) {
      gl.scissor(sx, sy, sw, sh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
  };

  return {
    cam,
    draw(state, dirty) {
      ensureSize();
      if (dirty || !sceneTarget) {
        buildLightMap(state);

        // Render additive HDR light map
        gl.bindFramebuffer(gl.FRAMEBUFFER, lightTarget.fbo);
        gl.viewport(0, 0, mapRes, mapRes);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.useProgram(progSeg.p);
        gl.uniform4fv(progSeg.u("uRect"), worldRect);
        gl.bindVertexArray(segVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, segInstBuf);
        gl.bufferData(gl.ARRAY_BUFFER, segData.subarray(0, 10 * segCount), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segCount);

        gl.useProgram(progSplat.p);
        gl.uniform4fv(progSplat.u("uRect"), worldRect);
        gl.bindVertexArray(glintVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, glintBuf);
        gl.bufferData(gl.ARRAY_BUFFER, glintData.subarray(0, 6 * glintCount), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, glintCount);
        gl.disable(gl.BLEND);

        // Multi-scale haze glow pyramid
        runBloomPyramid(lightTarget, glowPyramid, glowTarget, look.glowGains, 0);

        // Rebuild shadow + caustic key map when prism angle changes
        if (state.th !== lastKeyTheta) {
          lastKeyTheta = state.th;
          buildKeyMap(state.th);

          gl.bindFramebuffer(gl.FRAMEBUFFER, keyTarget.fbo);
          gl.viewport(0, 0, 640, 640);
          gl.clearColor(0, 0, 0, -keyDir[1]);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(progFlat.p);
          gl.uniform4fv(progFlat.u("uRect"), worldRect);
          gl.uniform4f(progFlat.u("uColor"), 0, 0, 0, 0);
          gl.bindVertexArray(shadowVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shadowTris), gl.DYNAMIC_DRAW);
          gl.drawArrays(gl.TRIANGLES, 0, shadowTris.length / 2);

          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
          gl.useProgram(progSplat.p);
          gl.uniform4fv(progSplat.u("uRect"), worldRect);
          gl.bindVertexArray(photonVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, photonBuf);
          gl.bufferData(gl.ARRAY_BUFFER, photonData.subarray(0, 6 * photonCount), gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, photonCount);
          gl.disable(gl.BLEND);

          // Separable soft Gaussian blur on key map
          gl.bindVertexArray(emptyVao);
          gl.useProgram(progBlur.p);
          gl.uniform1i(progBlur.u("uTex"), 0);
          gl.activeTexture(gl.TEXTURE0);
          const step = look.keySoft / 640;
          gl.bindFramebuffer(gl.FRAMEBUFFER, keyTemp.fbo);
          gl.bindTexture(gl.TEXTURE_2D, keyTarget.tex);
          gl.uniform2f(progBlur.u("uStep"), step, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindFramebuffer(gl.FRAMEBUFFER, keyTarget.fbo);
          gl.bindTexture(gl.TEXTURE_2D, keyTemp.tex);
          gl.uniform2f(progBlur.u("uStep"), 0, step);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        renderScene(state);
        runBloomPyramid(sceneTarget, bloomPyramid, bloomTarget, look.bloomGains, look.bloomKnee);
      }

      // Final screen composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, curW, curH);
      gl.useProgram(progComposite.p);
      gl.bindVertexArray(emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTarget.tex);
      gl.uniform1i(progComposite.u("uScene"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomTarget.tex);
      gl.uniform1i(progComposite.u("uBloom"), 1);
      gl.uniform2f(progComposite.u("uRes"), curW, curH);
      gl.uniform1f(progComposite.u("uBloomK"), look.bloom);
      gl.uniform1f(progComposite.u("uExposure"), look.exposure);
      gl.uniform1f(progComposite.u("uVignette"), look.vignette);
      gl.uniform1f(progComposite.u("uGrain"), look.grain);
      gl.uniform1f(progComposite.u("uHot"), look.hot);
      gl.uniform1f(progComposite.u("uSeed"), state.seed % 1024);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    reloadArt,
    quality(next) {
      if (next < superSample) {
        superSample = next;
        curW = 0;
      }
    },
    lost: () => gl.isContextLost(),
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
