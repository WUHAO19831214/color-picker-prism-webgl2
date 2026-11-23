# Color Picker · Prism (WebGL2 Optical Refraction Replica + Skill)

Zero-dependency 1:1 local replica of the interactive WebGL2 optical prism color picker (all 3 variants), paired with a reusable Antigravity Agent Skill (`webgl-optical-refraction`) distilling the physical Cauchy dispersion, beveled glass ray-tracing, volumetric haze, chromatic caustics, and HDR filmic bloom pipeline.

## Variants Included

- **`?v=1` (`plan`)** — Top-down protractor optical bench with degree numerals and sensor connector wire.
- **`?v=2` (`wide`)** — 3D perspective glass prism on a glossy reflective floor with a glowing frosted detector rod.
- **`?v=3` (`dark`)** — Top-down optical lab grid with crosshairs and illuminated floor markings.

## Run Locally

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/?v=3` in your browser.
- Drag or flick the prism to rotate (120Hz spring-damper & angular inertia).
- Press `h` / `l` or click `<` / `>` to switch between variants `1/3`, `2/3`, `3/3`.
- Edit `Hex`, `Wavelength`, `Hue`, or `Angle` directly to drive the prism to the matching angle.

## Reusable Agent Skill

The distilled optical refraction & HDR rendering pipeline is packaged as an Antigravity Skill at:

```text
.agents/skills/webgl-optical-refraction/
├── SKILL.md
├── references/
│   ├── optics-and-color.md
│   ├── webgl2-pipeline.md
│   └── look-presets.md
└── templates/
    ├── optics.js
    ├── shaders.js
    └── renderer.js
```

To install globally for all workspaces, copy `.agents/skills/webgl-optical-refraction` into `~/.gemini/config/skills/`.
