# Spectral Colorimetry, Cauchy Dispersion & Prism Ray-Tracing

## 1. Analytic CIE 1931 2° Spectral RGB

To make 360 monochromatic rays sum back into **pure neutral white** where they overlap (e.g., inside the incident beam or at the prism entry point), use Wyman's multi-lobe asymmetric Gaussian approximation of the CIE 1931 2° color matching functions:

```js
const gaussianLobe = (x, mu, sLeft, sRight) => {
  const t = (x - mu) / (x < mu ? sLeft : sRight);
  return Math.exp(-0.5 * t * t);
};
```

- Convert `(X, Y, Z)` to **linear sRGB** via the standard Rec.709 matrix.
- **Do not clamp negative linear sRGB lobes** during accumulation! Spectral colors lie outside the sRGB gamut; clamping them before summing distorts the white point and washes out the rainbow.
- Normalize each channel over `[380, 730] nm` so the integral of all wavelengths equals `[1, 1, 1]`.
- Apply a gentle perceptual violet roll-off below `440 nm` so short-wavelength indigo/violet stays vivid on sRGB/P3 displays, then re-normalize the red channel integral.

## 2. Cauchy Dispersion & Uniform-in-IOR Sampling

Glass refractive index varies with wavelength `λ` (in nm) according to Cauchy's equation:

$$n(\lambda) = A + \frac{B}{(\lambda / 1000)^2}$$

| Material | `A` | `B` | Visual Character |
| :--- | :---: | :---: | :--- |
| **SF11 Flint Glass (Default)** | `1.7388` | `0.0160` | Dramatic, wide rainbow fan (best for UI/hero art) |
| **SF6 Dense Flint** | `1.7620` | `0.0145` | Strong dispersion, slightly tighter fan |
| **N-BK7 Crown Glass** | `1.5046` | `0.0042` | Subtle, realistic optical lens dispersion |
| **Diamond** | `2.3800` | `0.0250` | Extreme fire & high internal reflection (TIR) |
| **Water** | `1.3240` | `0.0031` | Soft aquatic caustics |

### Why Sample Uniformly in `n` (Not `λ`)?
Because $n(\lambda)$ is steeper in the blue/violet region than in red, uniform steps in `λ` leave gaps in the blue tail and bunch up in red. Instead:
1. Step `n` linearly from `nRed = ior(716)` to `nViolet = ior(384)` across `N = 360` rays.
2. Recover wavelength: $\lambda(n) = 1000 \sqrt{B / (n - A)}$.
3. Multiply each ray's spectral RGB by the Jacobian $|\mathrm{d}\lambda/\mathrm{d}n| \cdot \Delta n$:
   $$\left|\frac{\mathrm{d}\lambda}{\mathrm{d}n}\right| = 500 \sqrt{B}\,(n - A)^{-3/2}$$

This guarantees smooth, band-free rainbow gradients with exact energy conservation.

## 3. Unpolarized Fresnel & Snell Ray Tracing

At every air↔glass boundary:
1. Compute outward face normal $\mathbf{n}$ and $\cos\theta_i = -(\mathbf{d}\cdot\mathbf{n})$.
2. Compute unpolarized Fresnel reflectance $R = \frac{1}{2}(R_s^2 + R_p^2)$:
   - If $(n_1/n_2)^2 (1 - \cos^2\theta_i) \ge 1$, **Total Internal Reflection (TIR)** occurs ($R = 1$).
3. Energy split:
   - **Entry face**: Reflected white ray carries $R \cdot P \cdot \text{stray}$; refracted ray enters with $(1 - R)$.
   - **Internal faces**: On Pass `0`, refract out with weight $w \cdot (1 - R)$ unless TIR forces an internal bounce. On Pass `1` (`extraBounces = 1`), force one additional Fresnel reflection ($w \leftarrow w \cdot R$) to produce authentic faint secondary ghost beams inside and outside the glass.
4. **Glints & Scatter**:
   - Place bright Gaussian splats at the beam entry point, weighted-average exit point (`0.8×`), and wherever dispersed rays strike opaque baffles/slit jaws.

## 4. Adapting to Other Glass Shapes

The 2D tracer in [templates/optics.js](../templates/optics.js) uses a simple convex-polygon half-edge loop (`for k in 0..numFaces`). To switch from an equilateral triangle to:
- **Right-angle / Dove / Pentaprism**: Replace `vertices(theta)` and loop over `k < numVertices`.
- **Convex / Biconvex Lens**: Intersect rays against two circular arcs (or a 24-segment polygon approximation).
- **Custom 3D Glass Slab**: Update `hitPrism` / `insideHit` / `bevel` in `shaders.js` with the slab's outward plane normals `uN[k]` and offsets.
