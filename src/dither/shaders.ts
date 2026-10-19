/**
 * The dither layer: luminance -> horizontal line screen rippled by a sine of x -> duotone ->
 * hash grain. One full-screen triangle, three textures (current subject, previous subject,
 * promotion atlas). All coordinates in device pixels unless noted.
 */

export const VERTEX = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}
`;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;            // canvas size, device px
uniform float uPhase;         // wave phase, radians
uniform float uFrame;         // frame counter for grain

uniform sampler2D uSubjA;     // incoming subject: R lum, G coverage, B background lum
uniform sampler2D uSubjB;     // outgoing subject
uniform vec4 uFitA;           // screen uv -> texture uv: xy scale, zw offset
uniform vec4 uFitB;
uniform float uDissolve;      // 0 = all B, 1 = all A

uniform sampler2D uMorph;     // promotion atlas
uniform vec4 uMorphGrid;      // cols, rows, frames, frame aspect (w/h)
uniform float uMorphT;        // 0 pawn .. 1 queen
uniform float uMorphMix;      // 0 persona .. 1 morph

uniform vec2 uSubjOffset;     // parallax + knight drift for the subject plane (uv)
uniform vec2 uBgOffset;       // parallax for the background plane (uv)
uniform vec2 uGrainOffset;    // parallax for the grain plane (device px)

uniform vec3 uInkShadow;
uniform vec3 uInkLight;
uniform vec3 uInkBleed;
uniform vec3 uInkTint;
uniform float uTintAmount;
uniform float uGrain;

uniform float uPeriod;        // line spacing
uniform float uRippleAmp;     // ripple amplitude
uniform float uRippleWave;    // ripple wavelength (viewport width / 8: the board rhythm)

uniform float uReveal;        // 0..1 lines grow in (preloader)
uniform float uBlack;         // 0..1 fade to grain-on-black (preloader)
uniform float uCalm;          // 0..1 game-screen calm

out vec4 outColor;

float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}

float hash3(vec3 p) {
  return hash(p.xy + vec2(p.z * 17.0, p.z * 31.0));
}

// Tone of the persona scene at a screen uv (y down).
float sceneTone(sampler2D tex, vec4 fit, vec2 uv) {
  vec2 base = uv * fit.xy + fit.zw;
  vec2 s = texture(tex, base + uSubjOffset).rg;
  float b = texture(tex, base + uBgOffset).b;
  return mix(b, s.x, s.y);
}

// Tone of the promotion atlas, frames centred and filling the viewport height.
float morphTone(vec2 uv) {
  float cols = uMorphGrid.x;
  float rows = uMorphGrid.y;
  float frames = uMorphGrid.z;
  float aspect = uMorphGrid.w;
  float viewAspect = uRes.x / uRes.y;
  // local frame coordinates: height fills the screen, centred horizontally
  vec2 l = vec2((uv.x - 0.5) * viewAspect / aspect + 0.5, uv.y) + uSubjOffset * 0.5;
  vec2 cell = vec2(1.0 / cols, 1.0 / rows);
  vec2 inset = 1.5 / vec2(textureSize(uMorph, 0));
  vec2 lc = clamp(l, vec2(0.0), vec2(1.0));
  float f = uMorphT * (frames - 1.0);
  float f0 = floor(f);
  float f1 = min(f0 + 1.0, frames - 1.0);
  vec2 o0 = vec2(mod(f0, cols), floor(f0 / cols)) * cell;
  vec2 o1 = vec2(mod(f1, cols), floor(f1 / cols)) * cell;
  vec2 c0 = clamp(o0 + lc * cell, o0 + inset, o0 + cell - inset);
  vec2 c1 = clamp(o1 + lc * cell, o1 + inset, o1 + cell - inset);
  vec3 a = texture(uMorph, c0).rgb;
  vec3 b = texture(uMorph, c1).rgb;
  vec3 m = mix(a, b, f - f0);
  return mix(m.b, m.r, m.g);
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);

  // ---- line screen geometry -------------------------------------------------------------
  // The ripple amplitude itself varies along x, so edges shimmer like a vibrating engraving.
  float ampMod = 0.55 + 0.45 * sin(fc.x * 0.0023 + uPhase * 0.61 + sin(fc.y * 0.0031 + uPhase * 0.2));
  float ripple = uRippleAmp * ampMod * sin(6.2831853 * fc.x / uRippleWave + uPhase);
  float yw = fc.y + ripple;
  float line = floor(yw / uPeriod);
  float centre = (line + 0.5) * uPeriod;
  float dist = abs(yw - centre);

  // Sample the image at the line centre so each line is symmetric around its axis.
  vec2 uv = vec2(fc.x, centre - ripple) / uRes;

  // ---- tone ------------------------------------------------------------------------------
  // Uniform branches: the outgoing image and the promotion atlas cost nothing at rest.
  float tA = sceneTone(uSubjA, uFitA, uv);
  float tB = uDissolve < 1.0 ? sceneTone(uSubjB, uFitB, uv) : tA;
  if (uMorphMix > 0.001) {
    float tM = morphTone(uv);
    tA = mix(tA, tM, uMorphMix);
    tB = mix(tB, tM, uMorphMix);
  }
  // Tone curve: let deep shadows go fully to the shadow ink and highlights fill the cell.
  tA = pow(clamp((tA - 0.07) / 0.86, 0.0, 1.0), 1.12);
  tB = pow(clamp((tB - 0.07) / 0.86, 0.0, 1.0), 1.12);

  // Calm: compress the tone range so the image recedes behind the board.
  float calmK = 1.0 - 0.62 * uCalm;
  tA = 0.42 + (tA - 0.42) * calmK;
  tB = 0.42 + (tB - 0.42) * calmK;

  // ---- grain -----------------------------------------------------------------------------
  vec2 gp = fc + uGrainOffset;
  float g1 = hash3(vec3(gp, uFrame));
  float g2 = hash3(vec3(gp + 7.31, uFrame + 3.0));

  // ---- coverage with a segment-wise threshold dissolve -------------------------------------
  float segLen = uPeriod * (6.0 + 10.0 * hash(vec2(line, 91.0)));
  float seg = floor((fc.x + hash(vec2(line, 13.0)) * segLen) / segLen);
  float n = hash(vec2(seg, line));
  float p = clamp((uDissolve - n * 0.6) / 0.4, 0.0, 1.0);

  float grainAmt = uGrain * 0.9;
  float aa = 0.85;
  float revealLine = clamp(uReveal * 1.6 - hash(vec2(line, 5.0)) * 0.6, 0.0, 1.0);

  float wA = 0.5 * uPeriod * clamp(tA + (g1 - 0.5) * grainAmt, 0.0, 1.0) * revealLine;
  float wB = 0.5 * uPeriod * clamp(tB + (g1 - 0.5) * grainAmt, 0.0, 1.0) * revealLine;
  float covA = smoothstep(wA + aa, wA - aa, dist) * step(0.02, wA);
  float covB = smoothstep(wB + aa, wB - aa, dist) * step(0.02, wB);
  // Old lines thin and break first, new lines then form segment by segment.
  float cov = max(covB * (1.0 - smoothstep(0.0, 0.55, p)), covA * smoothstep(0.45, 1.0, p));
  float w = mix(wB, wA, step(0.5, p));

  // ---- duotone -----------------------------------------------------------------------------
  float bleed = smoothstep(0.32, 0.0, uv.y) * (0.65 + 0.35 * sin(uv.x * 3.1 + uPhase * 0.17));
  vec3 lightInk = mix(uInkLight, uInkBleed, bleed * (1.0 - 0.7 * uCalm));
  // A thin secondary tint in the cores of the brightest lines.
  float core = smoothstep(0.42 * w, 0.18 * w, dist) * smoothstep(0.78, 0.95, max(tA, tB));
  lightInk = mix(lightInk, uInkTint, core * uTintAmount * (1.0 - uCalm));
  vec3 col = mix(uInkShadow, lightInk, cov);

  // Fine per-pixel grain over everything, flat areas included.
  col += (g2 - 0.5) * uGrain * 0.22;

  // Preloader: grain on pure black.
  vec3 black = vec3(0.0) + (g2 - 0.5) * 0.09 + 0.02;
  col = mix(col, black, uBlack);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
