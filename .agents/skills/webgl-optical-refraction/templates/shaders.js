// WebGL2 GLSL 300 es shaders for the optical prism light-transport and ray-tracing pipeline.

export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Instanced 2D Gaussian light beam segments (accumulated additively in RGBA16F)
export const BEAM_SEG_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
layout(location = 2) in vec4 aCol;
layout(location = 3) in vec2 aFade;
uniform vec4 uRect;
out float vAcross;
out float vFade;
out vec4 vCol;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw;
  vec2 d = b - a;
  float len = max(length(d), 1e-5);
  vec2 t = d / len, n = vec2(-t.y, t.x);
  float s = aCol.a;
  vec2 p = mix(a, b, aCorner.x) + n * aCorner.y * 3.0 * s;
  vAcross = aCorner.y;
  vFade = mix(aFade.x, aFade.y, aCorner.x);
  vCol = aCol;
  gl_Position = vec4((p - uRect.xy) * uRect.zw * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BEAM_SEG_FRAG = `#version 300 es
precision highp float;
in float vAcross;
in float vFade;
in vec4 vCol;
out vec4 o;
void main() {
  float g = exp(-4.5 * vAcross * vAcross) / (vCol.a * 2.5066);
  o = vec4(vCol.rgb * g * vFade * vFade, 1.0);
}`;

// Instanced 2D isotropic Gaussian splats (glints, slit edge scatter, sensor glow, caustic photons)
export const SPLAT_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPos;
layout(location = 2) in vec3 aCol;
uniform vec4 uRect;
out vec2 vP;
out vec3 vCol;
void main() {
  vP = aCorner;
  vCol = aCol / (6.2832 * aPos.z * aPos.z);
  vec2 p = aPos.xy + aCorner * 3.0 * aPos.z;
  gl_Position = vec4((p - uRect.xy) * uRect.zw * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SPLAT_FRAG = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vCol;
out vec4 o;
void main() {
  o = vec4(vCol * exp(-4.5 * dot(vP, vP)), 1.0);
}`;

// Flat shadow polygon pass for the key-light caustic/shadow map
export const FLAT_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec4 uRect;
void main() {
  gl_Position = vec4((aPos - uRect.xy) * uRect.zw * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FLAT_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 o;
void main() { o = uColor; }`;

// 13-tap Jimenez downsample with optional soft bloom knee
export const DOWNSAMPLE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uKnee;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 d) { return texture(uTex, vUv + d * uTexel).rgb; }
void main() {
  vec3 a = s(vec2(-2, -2)), b = s(vec2(0, -2)), c = s(vec2(2, -2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, 2)), h = s(vec2(0, 2)), i = s(vec2(2, 2));
  vec3 j = s(vec2(-1, -1)), k = s(vec2(1, -1)), l = s(vec2(-1, 1)), m = s(vec2(1, 1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uKnee > 0.0) {
    float v = max(col.r, max(col.g, col.b));
    col *= max(v - uKnee, 0.0) / max(v, 1e-4);
  }
  o = vec4(col, 1.0);
}`;

// 9-tap tent filter upsample
export const UPSAMPLE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGain;
in vec2 vUv;
out vec4 o;
vec3 s(vec2 d) { return texture(uTex, vUv + d * uTexel).rgb; }
void main() {
  vec3 col = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
    + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
  o = vec4(col * (uGain / 16.0), 1.0);
}`;

// 9-tap separable Gaussian blur for key-light caustics/shadows
export const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 col = texture(uTex, vUv) * 0.227027;
  col += (texture(uTex, vUv + uStep * 1.384615) + texture(uTex, vUv - uStep * 1.384615)) * 0.316216;
  col += (texture(uTex, vUv + uStep * 3.230769) + texture(uTex, vUv - uStep * 3.230769)) * 0.070270;
  o = col;
}`;

// 3D ray-traced optical bench shader (floor, volumetric beam haze, beveled dispersive glass prism, slit jaws & sensor rod)
const SCENE_FRAG_TEMPLATE = `#version 300 es
//DEFINES
precision highp float;
in vec2 vUv;
out vec4 o;

uniform vec2 uRes;
uniform vec3 uCamP, uCamR, uCamU, uCamF;
uniform float uFocal;

uniform vec2 uN[3];
uniform float uIn, uH, uBev;
uniform vec3 uIor;
uniform float uTheta;

uniform sampler2D uLight, uGlow, uArt, uKeyMap;
uniform vec4 uRect;
uniform float uBeamY, uBeamV;

uniform int uBoxN;
uniform vec3 uBoxC[4];
uniform vec3 uBoxS[4];
uniform vec2 uBoxR[4];
uniform int uBoxGlowI;
uniform vec3 uBoxGlow;

uniform vec3 uKeyDir;
uniform vec4 uPool;
uniform float uMetal, uRim, uOpen, uCaustic;
uniform float uKey, uAmb, uAlbedo, uSpill, uInk, uInkLit, uHaze, uGlowK, uGlassK, uGlassGlow, uGloss, uBoxLit;
uniform vec4 uSoft1, uSoft2;
uniform vec3 uSoftL;
uniform vec4 uIndex;
uniform vec4 uRing;
uniform float uPx;

const float PI = 3.14159265;
const float FAR = 1e9;

vec3 gm(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = min(c.r, min(c.g, c.b));
  if (m < 0.0) {
    if (l <= 0.0) return vec3(0.0);
    c = l + (c - l) * (l / (l - m));
  }
  return c;
}

vec2 mapUv(vec2 q) { return (q - uRect.xy) * uRect.zw; }
float inMap(vec2 uv) {
  vec2 e = min(uv, 1.0 - uv);
  return smoothstep(0.0, 0.06, min(e.x, e.y));
}
vec3 lightAt(vec2 q) { vec2 uv = mapUv(q); return gm(texture(uLight, uv).rgb) * inMap(uv); }
vec3 glowAt(vec2 q) { vec2 uv = mapUv(q); return gm(texture(uGlow, uv).rgb) * inMap(uv); }

float softRect(vec2 p, vec2 half_, float feather) {
  vec2 d = abs(p) - half_;
  return (1.0 - smoothstep(-feather, feather, d.x)) * (1.0 - smoothstep(-feather, feather, d.y));
}

float gRoom = 1.0;

vec3 env(vec3 d) {
  if (d.y <= 0.02 || gRoom == 0.0) return vec3(0.0);
  vec2 c = d.xz / d.y;
  float a = softRect(c - uSoft1.xy, uSoft1.zw, uSoftL.z);
  float b = softRect(c - uSoft2.xy, uSoft2.zw, uSoftL.z * 0.5);
  float band = smoothstep(0.02, 0.12, d.y) * (1.0 - smoothstep(0.25, 0.6, d.y));
  float side = 0.5 - 0.5 * dot(normalize(d.xz), normalize(uKeyDir.xz));
  return vec3(uSoftL.x * a + uSoftL.y * b) * smoothstep(0.02, 0.2, d.y) + vec3(uRim * band * (0.25 + 0.75 * side));
}

vec3 haze(vec3 ro, vec3 rd, float tmax, float sharp, float wide) {
  if (abs(rd.y) < 1e-4) return vec3(0.0);
  float t = (uBeamY - ro.y) / rd.y;
  if (t <= 0.0 || t >= tmax) return vec3(0.0);
  vec2 q = ro.xz + rd.xz * t;
  return (lightAt(q) * sharp + glowAt(q) * wide) * min(1.0 / abs(rd.y), 3.5);
}

float fresnel(float c, float n1, float n2) {
  float s2 = (n1 / n2) * (n1 / n2) * (1.0 - c * c);
  if (s2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - s2);
  float rs = (n1 * c - n2 * ct) / (n1 * c + n2 * ct);
  float rp = (n1 * ct - n2 * c) / (n1 * ct + n2 * c);
  return 0.5 * (rs * rs + rp * rp);
}

bool hitPrism(vec3 ro, vec3 rd, out float t, out vec3 n) {
  float t0 = -FAR, t1 = FAR;
  vec3 n0 = vec3(0.0);
  for (int k = 0; k < 5; k++) {
    vec3 nk = k < 3 ? vec3(uN[k].x, 0.0, uN[k].y) : (k == 3 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0));
    float off = k < 3 ? uIn : (k == 3 ? uH : 0.0);
    float den = dot(nk, rd), dist = dot(nk, ro) - off;
    if (abs(den) < 1e-7) {
      if (dist > 0.0) return false;
      continue;
    }
    float tk = -dist / den;
    if (den < 0.0) {
      if (tk > t0) { t0 = tk; n0 = nk; }
    } else t1 = min(t1, tk);
  }
  if (t0 > t1 || t0 < 0.0) return false;
  t = t0;
  n = n0;
  return true;
}

void insideHit(vec3 ro, vec3 rd, out float t, out vec3 n) {
  t = FAR;
  n = vec3(0.0, 1.0, 0.0);
  for (int k = 0; k < 5; k++) {
    vec3 nk = k < 3 ? vec3(uN[k].x, 0.0, uN[k].y) : (k == 3 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0));
    float off = k < 3 ? uIn : (k == 3 ? uH : 0.0);
    float den = dot(nk, rd);
    if (den > 1e-7) {
      float tk = (off - dot(nk, ro)) / den;
      if (tk < t) { t = tk; n = nk; }
    }
  }
}

vec3 bevel(vec3 p, vec3 n) {
  vec3 acc = n;
  for (int k = 0; k < 4; k++) {
    vec3 nk = k < 3 ? vec3(uN[k].x, 0.0, uN[k].y) : vec3(0.0, 1.0, 0.0);
    if (dot(nk, n) > 0.9) continue;
    float off = k < 3 ? uIn : uH;
    float d = off - dot(nk, p);
    float w = 1.0 - clamp(d / uBev, 0.0, 1.0);
    acc += nk * w * w;
  }
  return normalize(acc);
}

bool hitBox(int i, vec3 ro, vec3 rd, out float t, out vec3 n) {
  vec2 cs = uBoxR[i];
  vec3 oc = ro - uBoxC[i];
  vec3 ol = vec3(cs.x * oc.x + cs.y * oc.z, oc.y, -cs.y * oc.x + cs.x * oc.z);
  vec3 dl = vec3(cs.x * rd.x + cs.y * rd.z, rd.y, -cs.y * rd.x + cs.x * rd.z);
  dl = mix(dl, vec3(1e-6), lessThan(abs(dl), vec3(1e-6)));
  vec3 ta = (-uBoxS[i] - ol) / dl, tb = (uBoxS[i] - ol) / dl;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tn < 0.0) return false;
  t = tn;
  vec3 nl = -sign(dl) * step(tmin.yzx, tmin.xyz) * step(tmin.zxy, tmin.xyz);
  n = vec3(cs.x * nl.x - cs.y * nl.z, nl.y, cs.y * nl.x + cs.x * nl.z);
  return true;
}

bool hitBoxes(vec3 ro, vec3 rd, out float t, out vec3 n, out int id) {
  t = FAR;
  n = vec3(0.0, 1.0, 0.0);
  id = -1;
  for (int i = 0; i < 4; i++) {
    if (i >= uBoxN) break;
    float ti;
    vec3 ni;
    if (hitBox(i, ro, rd, ti, ni) && ti < t) { t = ti; n = ni; id = i; }
  }
  return t < FAR;
}

vec3 keyAt(vec2 q) {
  vec2 d = (q - uPool.xy) / uPool.z;
  float pool = exp(-dot(d, d));
  vec2 uv = mapUv(q);
  vec4 k = texture(uKeyMap, uv);
  return (vec3(k.a * uOpen) + gm(k.rgb) * uCaustic) * pool * uKey * inMap(uv);
}

vec3 shadeBox(vec3 p, vec3 n, vec3 rd, int id) {
  vec3 key = keyAt(p.xz) * max(dot(n, -uKeyDir), 0.0) / max(-uKeyDir.y, 0.2);
  vec3 col = uMetal * (key + uAmb);
  if (id == uBoxGlowI) return col + uBoxGlow * (0.55 + 0.45 * max(dot(-rd, n), 0.0));
  float c = max(dot(-rd, n), 0.0);
  col += (0.05 + 0.95 * pow(1.0 - c, 5.0)) * env(reflect(rd, n)) * 0.6;
  if (abs(n.y) < 0.5) {
    float v = exp(-0.5 * (p.y - uBeamY) * (p.y - uBeamY) / (uBeamV * uBeamV));
    vec2 q = p.xz + n.xz * 0.8;
    vec2 q2 = p.xz - n.xz * (2.0 * uBoxS[id].x + 0.8);
    col += (lightAt(q) + 0.7 * lightAt(q2)) * v * uBoxLit + glowAt(q) * uSpill * 3.0;
  } else {
    col += glowAt(p.xz) * uSpill * 1.5;
  }
  return col;
}

float line(float d, float w, float px) { return clamp((w - d) / px + 0.5, 0.0, 1.0); }

float marks(vec2 q, float px) {
  float r = length(q);
  float a = atan(q.y, q.x) - (uTheta - PI * 0.5);
  a = mod(a + PI / 3.0, 2.0 * PI / 3.0) - PI / 3.0;
  float m = line(abs(a) * r, uIndex.z, px) * line(abs(r - 0.5 * (uIndex.x + uIndex.y)), 0.5 * (uIndex.y - uIndex.x), px) * uIndex.w;
  m = max(m, line(abs(r - uRing.x), uRing.y, px) * uRing.w);
  return m;
}

vec3 floorBase(vec2 q, float px) {
  vec2 auv = mapUv(q);
  float ink = pow(texture(uArt, auv).r, 2.2) * inMap(auv);
  float mk = marks(q, px);
  vec3 glow = glowAt(q);
  vec3 key = keyAt(q);
  vec3 col = uAlbedo * (key + uAmb) + uSpill * glow;
  col += ink * (uInk + uInkLit * (glow * 6.0 + key));
  col = mix(col, vec3(0.86), mk);
  return col;
}

vec3 outside(vec3 ro, vec3 rd, float px) {
  float tF = rd.y < -1e-5 ? -ro.y / rd.y : FAR;
  vec3 col = haze(ro, rd, tF, uHaze, uGlowK);
  if (tF < FAR) return col + floorBase(ro.xz + rd.xz * tF, px);
  return col + env(rd);
}

vec3 glass(vec3 ro, vec3 rd, float t, vec3 n0, float px) {
  vec3 p = ro + rd * t;
  vec3 n = bevel(p, n0);
  float ci = max(-dot(rd, n), 0.0);
  float F = fresnel(ci, 1.0, uIor.g);
  vec3 col = F * outside(p + n0 * 0.02, reflect(rd, n), px);
  for (int c = 0; c < 3; c++) {
    float ior = uIor[c];
    vec3 d = refract(rd, n, 1.0 / ior);
    vec3 q = p - n0 * 0.02;
    float w = 1.0 - F;
    float acc = 0.0;
    for (int b = 0; b < 4; b++) {
      float tt;
      vec3 nn;
      insideHit(q, d, tt, nn);
      acc += w * haze(q, d, tt, uGlassK, uGlassGlow)[c];
      vec3 e = q + d * tt;
      float cc = dot(d, nn);
      float k = 1.0 - ior * ior * (1.0 - cc * cc);
      float R = 1.0;
      if (k >= 0.0) {
        R = fresnel(cc, ior, 1.0);
        vec3 dout = ior * d + (sqrt(k) - ior * cc) * nn;
        acc += w * (1.0 - R) * outside(e + nn * 0.02, dout, px)[c];
      }
      w *= R;
      if (w < 0.04) break;
      d = reflect(d, nn);
      q = e - nn * 0.02;
    }
    col[c] += acc;
  }
  return col;
}

vec3 rayDir(vec2 frag) {
  vec2 f = frag / uRes;
  vec2 fp = vec2(f.x - 0.5, 0.5 - f.y) * 540.0;
  return normalize(uCamF * uFocal + uCamR * fp.x + uCamU * fp.y);
}

float floorGloss(vec3 rd) {
  float c = max(-rd.y, 0.0);
  return uGloss * (0.04 + 0.96 * pow(1.0 - c, 5.0));
}

#ifdef SOLIDS
vec3 mirror(vec3 ro, vec3 rd, float px) {
  float tP, tB;
  vec3 nP, nB;
  int ib;
  bool hp = hitPrism(ro, rd, tP, nP);
  bool hb = hitBoxes(ro, rd, tB, nB, ib);
  if (hb && (!hp || tB < tP)) return haze(ro, rd, tB, uHaze, uGlowK) + shadeBox(ro + rd * tB, nB, rd, ib);
  if (hp) return haze(ro, rd, tP, uHaze, uGlowK) + glass(ro, rd, tP, nP, px);
  return outside(ro, rd, px);
}

int what(vec3 ro, vec3 rd) {
  float tP, tB;
  vec3 nP, nB;
  int ib;
  bool hp = hitPrism(ro, rd, tP, nP);
  bool hb = hitBoxes(ro, rd, tB, nB, ib);
  float tF = rd.y < -1e-5 ? -ro.y / rd.y : FAR;
  if (hp && tP <= tF && (!hb || tP <= tB)) {
    vec3 p = ro + rd * tP;
    if (nP.y < 0.5 || dot(bevel(p, nP), nP) < 0.9995) return -1;
    return 1 + 10 * int(dot(nP, vec3(1.0, 2.0, 3.0)) * 8.0 + 40.0);
  }
  if (hb && tB <= tF) return 2 + 10 * int(dot(nB, vec3(1.0, 2.0, 3.0)) * 8.0 + 40.0) + 1000 * ib;
  return 0;
}

vec3 shade(vec3 ro, vec3 rd, float px) {
  float tP, tB;
  vec3 nP, nB;
  int ib;
  bool hp = hitPrism(ro, rd, tP, nP);
  bool hb = hitBoxes(ro, rd, tB, nB, ib);
  float tF = rd.y < -1e-5 ? -ro.y / rd.y : FAR;
  float t = min(tF, min(hp ? tP : FAR, hb ? tB : FAR));
  vec3 col = haze(ro, rd, t, uHaze, uGlowK);
  if (hp && tP <= t) return col + glass(ro, rd, tP, nP, px);
  if (hb && tB <= t) return col + shadeBox(ro + rd * tB, nB, rd, ib);
  if (tF < FAR) {
    vec3 p = ro + rd * tF;
    col += floorBase(p.xz, px);
    if (uGloss > 0.0) {
      gRoom = 0.0;
      col += floorGloss(rd) * mirror(p + vec3(0.0, 0.02, 0.0), reflect(rd, vec3(0.0, 1.0, 0.0)), px);
      gRoom = 1.0;
    }
    return col;
  }
  return col + env(rd);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float px = uPx;
  vec2 off[8] = vec2[8](vec2(0.375, 0.125), vec2(-0.125, 0.375), vec2(-0.375, -0.125), vec2(0.125, -0.375),
    vec2(0.0625, 0.0625), vec2(-0.3125, 0.3125), vec2(0.3125, -0.1875), vec2(-0.1875, -0.4375));
  int id0 = what(uCamP, rayDir(frag + off[0]));
  bool same = id0 >= 0;
  bool fine = id0 < 0;
  for (int i = 1; i < 4; i++) {
    int id = what(uCamP, rayDir(frag + off[i]));
    if (id != id0) same = false;
    if (id < 0) fine = true;
  }
  vec3 col;
  if (same) col = shade(uCamP, rayDir(frag), px);
  else {
    int n = fine ? 8 : 4;
    col = vec3(0.0);
    for (int i = 0; i < n; i++) col += shade(uCamP, rayDir(frag + off[i]), px);
    col /= float(n);
  }
  o = vec4(max(col, 0.0), 1.0);
}
#else
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 rd = rayDir(frag);
  float tF = rd.y < -1e-5 ? -uCamP.y / rd.y : FAR;
  vec3 col = haze(uCamP, rd, tF, uHaze, uGlowK);
  if (tF < FAR) {
    vec3 p = uCamP + rd * tF;
    col += floorBase(p.xz, uPx);
    if (uGloss > 0.0) {
      gRoom = 0.0;
      col += floorGloss(rd) * outside(p + vec3(0.0, 0.02, 0.0), reflect(rd, vec3(0.0, 1.0, 0.0)), uPx);
      gRoom = 1.0;
    }
  } else col += env(rd);
  o = vec4(max(col, 0.0), 1.0);
}
#endif
`;

export const makeSceneFrag = (withSolids) =>
  SCENE_FRAG_TEMPLATE.replace("//DEFINES", withSolids ? "#define SOLIDS" : "");

// Final composite: HDR bloom + vignette + exposure + highlight desaturation + sRGB + luminance-weighted grain
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uBloom;
uniform vec2 uRes;
uniform float uBloomK, uExposure, uVignette, uGrain, uSeed, uHot;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = texture(uScene, vUv).rgb + uBloomK * texture(uBloom, vUv).rgb;
  vec2 v = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(v) * 1.25);
  c *= uExposure;
  float m = max(c.r, max(c.g, c.b));
  c = mix(c, vec3(m), uHot * smoothstep(2.0, 12.0, m));
  c = 1.0 - exp(-c);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  vec2 g = gl_FragCoord.xy + uSeed * vec2(37.0, 91.0);
  float n = hash(g) + hash(g + 17.31) - 1.0;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += n * uGrain * (smoothstep(0.0, 0.08, l) * (1.0 - 0.6 * l) + 0.05);
  o = vec4(max(c, 0.0), 1.0);
}`;
