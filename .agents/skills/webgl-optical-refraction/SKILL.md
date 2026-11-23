---
name: webgl-optical-refraction
description: >-
  Build physically based real-time WebGL2 optical refraction, spectral Cauchy dispersion,
  beveled glass ray-tracing, volumetric beam haze, chromatic caustics, and HDR filmic bloom
  effects for interactive web UIs, hero scenes, and optical simulations. Use when the user
  asks for realistic glass refraction, prism light dispersion, rainbow beams, caustics,
  volumetric glow/haze, or cinema-grade HDR WebGL2 optical visuals.
---

# WebGL2 Optical Refraction & Dispersion Pipeline

Create zero-dependency, physically grounded WebGL2 (`GLSL 300 es`) glass refraction, spectral dispersion, chromatic caustics, volumetric light haze, and HDR filmic bloom effects.

## When to Use This Skill

- Interactive glass/prism components (color pickers, dials, lenses, crystal sliders, optical benches).
- Product hero visuals or landing-page canvases featuring realistic light refraction, rainbow dispersion, or glossy dark-studio caustics.
- Any WebGL2 scene needing HDR multi-scale bloom, highlight desaturation, and subtle luminance-weighted film grain without Three.js overhead.

## Core Architecture (5-Pass HDR Pipeline)

```text
[CPU: 360-ray Cauchy Dispersion]  ──▶  Pass 1: RGBA16F Light Map (additive Gaussian beams + glints)
                                            │
                                            ▼
                                       Pass 2: 6-Level Jimenez/Tent Pyramid ──▶ Volumetric Haze Map (uGlow)

[CPU: 5-Band 3D Photon Tracing]   ──▶  Pass 3: 640×640 Shadow + Chromatic Caustic Map (uKeyMap, 9-tap blur)

[uLight + uGlow + uKeyMap + uArt] ──▶  Pass 4: 3D Ray-Traced Scene (RGBA16F)
                                            ├─ Full-frame fast floor + haze + floor gloss
                                            └─ Scissor-clipped SOLIDS pass (4×/8× adaptive AA, beveled glass, 4-bounce RGB refraction)
                                            │
                                            ▼
                                       Pass 5: 6-Level HDR Screen Bloom (uKnee) ──▶ Filmic Tone Map + uHot Desat + sRGB + Film Grain
```

## Implementation Workflow

### 1. Choose the Optical & Visual Configuration
Determine the scene's geometry, camera, and lighting mood before writing code:
- **Camera**: Top-down orthographic-like (`focal: 720–1100`, `up: [0,0,-1]`) for 2D instrument benches, or angled 3D perspective (`pitch: 30°–42°`, `yaw: -14°`, `focal: 800`, `gloss: 1.8–2.4`) for sculptural glass on a reflective floor.
- **Glass Material**: Pick Cauchy dispersion coefficients (`n(λ) = A + B / (λ/1000)²`). High-dispersion flint glass (`A = 1.7388, B = 0.016`) produces vivid, wide rainbow fans; BK7 crown glass (`A = 1.5046, B = 0.0042`) produces subtler refraction.
- **Look Preset**: Consult [references/look-presets.md](./references/look-presets.md) for the three verified studio presets (`plan`, `wide`, `dark`) and parameter tuning ranges.

### 2. Implement Spectral Colorimetry & Ray-Tracing Optics
Read [references/optics-and-color.md](./references/optics-and-color.md) or start from [templates/optics.js](./templates/optics.js).
Key physical invariants to preserve:
1. **Sample uniformly in refractive index `n`, not wavelength `λ`**, and weight each ray by the Jacobian `dλ/dn` so spectral energy stays physically uniform across the dispersed fan.
2. **Accumulate signed linear sRGB** in `RGBA16F` and apply luminance-preserving gamut mapping `gm(c)` only when sampling the light map in the scene shader—this keeps pure white incident beams neutral (`R = G = B`) when all 360 rays overlap.
3. **Include both primary and secondary paths**: trace pass `0` (direct refraction) and pass `1` (1 extra internal reflection scaled by `look.stray`), plus Fresnel specular reflection off the entry face and entry/exit glints.

### 3. Assemble the WebGL2 HDR Shaders & Render Loop
Read [references/webgl2-pipeline.md](./references/webgl2-pipeline.md) or start from [templates/shaders.js](./templates/shaders.js).
Critical implementation details:
- **Context & Extensions**: Require `webgl2` + `EXT_color_buffer_float` (or `EXT_color_buffer_half_float`) and `OES_texture_float_linear`. Set `gl.drawingBufferColorSpace = "display-p3"` when `(color-gamut: p3)` matches.
- **Scissor Optimization**: Never run the 4-bounce glass ray-tracer over empty floor pixels. Render the floor pass full-screen, then enable `SCISSOR_TEST` over the projected 2D screen bounding boxes of the glass solid (and its floor reflection if `gloss > 0`).
- **Adaptive Edge AA**: In the `SOLIDS` pass, cast 4 probe rays (`what()`). Use 1 ray for interior flat faces, 4 rays on face/floor silhouettes, and 8 rays on beveled glass edges (`dot(bevel(p, n), n) < 0.9995`).
- **Cached Key Map**: Only rebuild the 5-band caustic photon map (`uKeyMap`) when the glass geometry rotates or moves (`state.th !== lastKeyTheta`).
- **Filmic Highlight Roll-off**: Always apply `uHot` highlight desaturation (`mix(c, vec3(maxC), uHot * smoothstep(2.0, 12.0, maxC))`) before `1.0 - exp(-c)` so intense beam cores turn crisp white while edges stay saturated.

### 4. Add Tactile Physics & Dirty-Flag Rendering
- Use a fixed `1/120` s physics step with spring-damper tracking (`k = 2500, damp = 100` while dragged; `k = 420, damp = 41` while seeking; low angular drag + velocity-tracked flick inertia when free).
- Only re-run Passes 1–4 when state actually changes (`dirty` flag on angle, glow, focus, or resize); keep dynamic quality scaling (`superSample: 2 → 1`) if frame times exceed `24 ms` for 12 consecutive frames.

## Verification Checklist

After implementing the optical scene, verify in a live browser:
1. **Zero WebGL2 errors**: No shader compile/link errors and `EXT_color_buffer_float` / `RGBA16F` FBOs are complete.
2. **Neutral white entry beam**: The unrefracted incident beam appears crisp white (not tinted magenta/green), confirming CIE normalization + signed linear accumulation.
3. **Smooth spectral gradient**: No visible ray banding in the dispersed rainbow fan (increase `rays` to `360` or `beam` sigma if banding appears).
4. **Crisp beveled edges & caustics**: Glass edges catch soft overhead studio softboxes (`uSoft1`, `uSoft2`, `uRim`) without aliasing; glossy floors reflect both the glass and rainbow beams cleanly.
5. **Interactive smoothness**: Dragging/rotating updates at 60fps without frame drops.

## References & Templates

- [references/optics-and-color.md](./references/optics-and-color.md) — CIE 1931 colorimetry, Cauchy dispersion math, Fresnel reflectance, and 2D/3D ray-tracing equations.
- [references/webgl2-pipeline.md](./references/webgl2-pipeline.md) — Detailed 5-pass FBO setup, GLSL shader breakdown, scissor AA, and tone-mapping math.
- [references/look-presets.md](./references/look-presets.md) — Complete uniform dictionary and 3 ready-to-use studio lighting presets (`plan`, `wide`, `dark`).
- [templates/optics.js](./templates/optics.js) — Drop-in ES module for spectral colorimetry, Cauchy dispersion, and prism ray tracing.
- [templates/shaders.js](./templates/shaders.js) — Drop-in ES module with all GLSL 300 es shaders.
