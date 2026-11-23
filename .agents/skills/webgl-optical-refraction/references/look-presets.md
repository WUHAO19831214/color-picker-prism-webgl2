# Lighting, Material & Camera Presets (`look` Dictionary)

## Key `look` Uniforms

| Group | Uniform | Default | Effect |
| :--- | :--- | :---: | :--- |
| **Beam Optics** | `rays` | `360` | Spectral sample count (`240–480`; higher removes banding in wide fans) |
| | `power` | `10` | Base radiant power of the white incident beam |
| | `beam` / `beamV` | `0.9` / `2.2` | Horizontal Gaussian beam radius / vertical slab thickness on plates |
| | `stray` / `strayReach` | `0.5` / `250` | Strength & falloff distance of entry Fresnel reflection and internal ghost rays |
| | `glint` / `glintSize` | `3.5` / `1.8` | Hot specular sparkle at glass entry and exit points |
| **Haze & Glass** | `haze` / `hazeGlow` | `1.0` / `0.35–0.6` | Sharp beam visibility vs. wide volumetric glow in air |
| | `glass` / `glassGlow` | `0.45` / `0.12–0.3` | Internal beam scatter visible *through* the glass body |
| | `bevel` | `2.2–2.6` | Ground glass edge radius (in world units); higher catches wider studio specular lines |
| | `soft1`, `soft2`, `softL` | — | Two overhead studio softbox rectangles `[cx, cz, hw, hh]` + `[L1, L2, feather]` |
| | `rim` | `0.22–0.9` | Low horizon rim-light band reflected in glass walls |
| **Floor & Caustics** | `albedo` / `gloss` | `0.012–0.03` / `0–2.2` | Matte floor base vs. Fresnel mirror polish (`gloss: 2.2` for 3D reflections) |
| | `spill` / `ink` / `inkLit` | `0.06–0.1` / `0.1–1` / `0.6–2.6` | Light spill onto floor and how strongly floor markings catch beam glow |
| | `key` / `open` / `caustic` | `0–0.7` / `0.45–0.8` / `2.2–2.4` | Overhead key light, unshadowed floor lift, and 5-band glass caustic intensity |
| **Post / Film** | `bloom` / `bloomKnee` | `0.8` / `1.0` | Final screen bloom gain and HDR knee threshold |
| | `hot` | `0.85` | Highlight desaturation toward white (`smoothstep(2.0, 12.0, maxRGB)`) |
| | `vignette` / `grain` | `0.35–0.5` / `0.02–0.03` | Radial edge darkening and organic luminance-weighted film grain |

## Three Battle-Tested Studio Presets

### 1. `plan` — Minimal Protractor Optical Bench (Top-Down)
- **Camera**: Top-down `focal: 720`, `pos: [270-286, 720, 270-174]`, `up: [0,0,-1]`.
- **Overrides**: `albedo: 0.02`, `open: 0.45`, `caustic: 2.4`, `pool: [20, -20, 140, 0]`, `softL: [0.95, 3.5, 0.08]`, `soft1: [-0.27, -0.3, 0.22, 0.22]`.
- **Feel**: Pure black background, crisp overhead glass specular edges, delicate floor caustics, zero floor gloss.

### 2. `wide` — 3D Sculptural Prism on Glossy Obsidian Floor
- **Camera**: Perspective `pitch: 36°`, `yaw: -14°`, `dist: 760`, `focal: 800`, `target: [52, 20, 84]`, `up: [0,1,0]`, `prismH: 90`, `beamY: 45`.
- **Overrides**: `gloss: 2.2`, `albedo: 0.012`, `key: 0.7`, `pool: [20, 40, 260, 0]`, `hazeGlow: 0.6`, `glowGains: [0.5, 0.36, 0.26, 0.19, 0.14, 0.1]`, `glassGlow: 0.3`, `metal: 0.3`, `softL: [2.2, 5, 0.14]`, `soft1: [-0.3, -0.5, 0.5, 0.3]`, `soft2: [1.2, 0.2, 0.15, 0.8]`, `rim: 0.9`, `bevel: 2.6`, `vignette: 0.5`, `boxLit: 4`.
- **Feel**: Dramatic 3D glass thickness, rich Fresnel floor reflections of both prism and rainbow beam, glowing frosted glass elements.

### 3. `dark` — High-Contrast Optical Lab Grid (Top-Down)
- **Camera**: Top-down telephoto `focal: 1100`, `pos: [270-300, 1100, 270-186]`, `up: [0,0,-1]`, `prismH: 70`, `beamY: 35`.
- **Overrides**: `key: 0`, `ambient: 0`, `albedo: 0.03`, `spill: 0.1`, `ink: 0.1`, `inkLit: 2.6`, `hazeGlow: 0.6`, `glowGains: [0.5, 0.36, 0.26, 0.19, 0.14, 0.1]`, `glassGlow: 0.3`, `softL: [0.5, 1.6, 0.12]`, `rim: 0.22`, `vignette: 0.45`, `grain: 0.03`, `metal: 0.3`.
- **Feel**: Pitch-dark lab where the grid & crosshairs (`ink: 0.1`) stay nearly invisible in shadow and illuminate dramatically (`inkLit: 2.6`) wherever the white beam or rainbow halo passes over them!
