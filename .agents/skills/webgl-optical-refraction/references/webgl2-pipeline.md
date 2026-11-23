# WebGL2 5-Pass HDR Optical Rendering Pipeline

All floating-point targets use `gl.RGBA16F` / `gl.HALF_FLOAT` with `gl.LINEAR` filtering and `gl.CLAMP_TO_EDGE`. Require `EXT_color_buffer_float` (or `EXT_color_buffer_half_float`) and `OES_texture_float_linear`.

## Pass 1: HDR Spectral Light Map (`uLight`)
- **Resolution**: `mapRes = round(world.size * min(dpr, config.mapRes) * min(superSample, 1.5))`
- **Blend mode**: `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);`
- **Beam Segments (`BEAM_SEG_VERT/FRAG`)**:
  - Each ray segment `[x0, y0, x1, y1, r, g, b, sigma, fade0, fade1]` expands into a quad `±3σ` perpendicular to the ray.
  - Analytical 1D normalized Gaussian cross-section: `exp(-4.5 * vAcross²) / (σ * 2.5066)`.
  - Multiply by `vFade²` so stray beams smoothly decay over `strayReach`.
- **Gaussian Splats (`SPLAT_VERT/FRAG`)**:
  - Used for entry/exit glints, slit-jaw edge scatter, and glowing detector spots.
  - Analytical 2D normalized Gaussian: `col / (2π * σ²) * exp(-4.5 * dot(vP, vP))`.

## Pass 2: Volumetric Haze Glow Map (`uGlow`)
- Run a **6-level Jimenez 13-tap downsample → 9-tap tent upsample pyramid** (`uKnee = 0`) on `uLight`.
- Combine levels with `look.glowGains` (e.g. `[0.5, 0.36, 0.26, 0.19, 0.14, 0.1]`).
- Produces a wide, energy-conserving atmospheric scatter map sampled both in mid-air (`haze()`) and as diffuse spill on the floor (`uSpill * glow`) and ink (`uInkLit * glow * 6.0`).

## Pass 3: 5-Band 3D Caustic & Soft Shadow Key Map (`uKeyMap`)
- **Resolution**: `640 × 640` `RGBA16F` (rebuilt only when geometry angle changes!).
- **Channel Packing**:
  - `Alpha`: Key-light open visibility. Cleared to `-keyDir.y`, then solid shadow volumes (`FLAT_VERT/FRAG`) are extruded along `-keyDir / keyDir.y` and drawn with `(0, 0, 0, 0)`.
  - `RGB`: Chromatic refractive caustics. Divide `[400, 690] nm` into 5 spectral bands; trace a grid of photons (`photonStep = 2`) entering the top face and lit side faces of the prism through up to 6 internal bounces. Whenever a photon refracts out downward (`ody < -0.001`) or hits the bottom face, splat it onto `y = 0` using `blendFuncSeparate(ONE, ONE, ZERO, ONE)` so alpha shadows are preserved!
- **Softening**: Separable 9-tap Gaussian blur (`BLUR_FRAG`) with step `look.keySoft / 640`.

## Pass 4: Scissor-Optimized 3D Ray-Traced Scene (`sceneTarget`)
- **Gamut Mapping on Sample (`gm(c)`)**:
  When reading `uLight`, `uGlow`, or `uKeyMap`, bring any negative signed-linear components into gamut by blending toward equal-luminance grey:
  ```glsl
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = min(c.r, min(c.g, c.b));
  if (m < 0.0) c = l <= 0.0 ? vec3(0.0) : l + (c - l) * (l / (l - m));
  ```
- **Thin-Layer Volumetric Haze (`haze`)**:
  Intersect view ray with horizontal plane `y = uBeamY` (if `0 < t < tmax`), sample `lightAt(q) * sharp + glowAt(q) * wide`, and scale by `min(1.0 / abs(rd.y), 3.5)` for realistic grazing-angle thickness.
- **Beveled Dispersive Glass (`glass`)**:
  1. Perturb the geometric face normal near edges (`bevel(p, n)`) by blending neighboring face normals with quadratic falloff `(1 - clamp(d / uBev, 0, 1))²`.
  2. Cast 1 reflected ray weighted by `F = fresnel(ci, 1.0, uIor.g)`.
  3. For each channel `c ∈ {R, G, B}` with `uIor = vec3(ior(612), ior(549), ior(465))`, refract inward and trace up to **4 internal bounces**:
     - Accumulate internal beam haze (`uGlassK`, `uGlassGlow`) along each internal segment.
     - On exit (`k >= 0`), accumulate `(1 - R) * outside(exitPt, dout)[c]`.
     - Reflect internally with weight `w *= R`; early-out when `w < 0.04`.
- **Two-Stage Scissor Draw**:
  1. Draw `makeSceneFrag(false)` (floor + haze + glossy floor reflection of outside) full-screen with 1 ray/pixel.
  2. Project the 3D vertices of the prism (and boxes, plus mirrored `y < 0` copies if `gloss > 0`) to screen space. Enable `SCISSOR_TEST` per bounding box and draw `makeSceneFrag(true)` (`SOLIDS`) with adaptive 1× / 4× / 8× supersampling.

## Pass 5: HDR Screen Bloom & Filmic Composite
1. Run the same 6-level Jimenez/tent bloom pyramid on `sceneTarget` with `uKnee = look.bloomKnee` (`1.0`) so only HDR highlights bloom.
2. Composite (`COMPOSITE_FRAG`):
   - `c = scene + uBloomK * bloom`
   - Radial vignette: `c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(vUv - 0.5) * 1.25)`
   - Exposure: `c *= uExposure`
   - **Filmic Highlight Desaturation**: `c = mix(c, vec3(maxC), uHot * smoothstep(2.0, 12.0, maxC))` — crucial for making intense laser cores glow pure white while keeping surrounding halos saturated!
   - Exponential tone map: `c = 1.0 - exp(-c)`
   - Exact sRGB OETF transfer
   - **Luminance-Weighted Film Grain**: triangular-PDF noise scaled by `uGrain * (smoothstep(0, 0.08, luma) * (1 - 0.6 * luma) + 0.05)` so pure black stays clean while mid-tone glows look organic and band-free.
