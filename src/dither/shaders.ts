/**
 * The dither layer: luminance -> a screen (rippled horizontal lines by default; ASCII glyphs, a
 * pixel mosaic or dotted lines for some opponents; behind the game, all of them morphing across
 * drifting Voronoi cells) -> duotone with an optional accent -> hash grain. One full-screen triangle, three textures (current subject, previous subject,
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

// Compiled per variant (fragmentSource): SCREEN_A / SCREEN_B are the screens of the incoming and
// outgoing subjects (0 lines, 1 glyphs, 2 mosaic, 3 dotted lines); DISSOLVE and MORPH switch on
// the code for a running dissolve and the promotion morph; MORPHSCREEN replaces the fixed screens
// by the morphing Voronoi field. Constant screens let the compiler drop the unused patterns,
// which software renderers cannot do for uniforms.
uniform vec3 uAccent;         // opponent's accent for the light ink
uniform float uAccentAmt;     // 0..1

uniform sampler2D uGlyphs;    // glyph ramp, light to dark ink, in one row of square cells
uniform float uGlyphCount;
uniform vec2 uScreenOffset;   // the screen pattern's own drift and parallax, device px
uniform float uTime;          // seconds, for the morphing screen
uniform float uCellSize;      // Voronoi cell size of the morphing screen, device px

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

// Tone of plane A (which 0) or B at a screen uv, after the tone curve and calm.
float toneOf(int which, vec2 uv) {
  // if/else, not ?:, so only one plane is sampled (some compilers evaluate both sides of ?:).
  float t;
  if (which == 0) t = sceneTone(uSubjA, uFitA, uv);
  else t = sceneTone(uSubjB, uFitB, uv);
#if MORPH
  t = mix(t, morphTone(uv), uMorphMix);
#endif
  // Tone curve: let deep shadows go fully to the shadow ink and highlights fill the cell.
  t = pow(clamp((t - 0.07) / 0.86, 0.0, 1.0), 1.12);
  // Calm: compress the tone range a little so the image sits behind the board.
  return 0.42 + (t - 0.42) * (1.0 - 0.35 * uCalm);
}

// 4x4 ordered-dither threshold.
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(floor(p), 4.0));
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}

// Coverage of the light ink for one plane on its screen; also its tone, and the mark's half
// width and the distance from its axis (for the tint in the cores of the brightest marks).
// The pattern lives at fc + uScreenOffset, so it can drift; the image is sampled where it is.
float cover(float screen, int which, vec2 fc, float ripple, float g1, float grainAmt, float reveal,
            out float t, out float w, out float dist) {
  const float aa = 0.85;
  vec2 q = fc + uScreenOffset;
  if (screen < 0.5) {
    // Lines: one horizontal line per period, as wide as the tone.
    float yw = q.y + ripple;
    float centre = (floor(yw / uPeriod) + 0.5) * uPeriod;
    dist = abs(yw - centre);
    // Sample the image at the line centre so each line is symmetric around its axis.
    t = toneOf(which, vec2(fc.x, centre - ripple - uScreenOffset.y) / uRes);
    w = 0.5 * uPeriod * clamp(t + (g1 - 0.5) * grainAmt, 0.0, 1.0) * reveal;
    return smoothstep(w + aa, w - aa, dist) * step(0.02, w);
  }
  if (screen < 1.5) {
    // Glyphs: an ASCII ramp, one character per cell (a monospace cell, taller than wide),
    // denser characters for brighter tone.
    vec2 cell = vec2(uPeriod * 2.5, uPeriod * 4.0);
    vec2 qq = vec2(q.x, q.y + ripple * 0.5);
    vec2 c = (floor(qq / cell) + 0.5) * cell;
    t = toneOf(which, (c - vec2(0.0, ripple * 0.5) - uScreenOffset) / uRes);
    float level = clamp(t + (g1 - 0.5) * grainAmt * 0.3, 0.0, 1.0) * reveal;
    float k = floor(level * (uGlyphCount - 0.001));
    vec2 local = (qq - (c - 0.5 * cell)) / cell;
    float ink = texture(uGlyphs, vec2((k + local.x) / uGlyphCount, local.y)).r;
    w = 1.0;
    dist = 1.0;
    return smoothstep(0.35, 0.65, ink);
  }
  if (screen < 2.5) {
    // Pixel mosaic: the image in square blocks, each filled with a 4x4 ordered dither.
    float block = uPeriod * 4.0;
    vec2 c = (floor(q / block) + 0.5) * block;
    t = toneOf(which, (c - uScreenOffset) / uRes);
    w = 1.0;
    dist = 1.0;
    float level = clamp(t + (g1 - 0.5) * grainAmt * 0.25, 0.0, 1.0) * reveal;
    return step(bayer4(q / (block * 0.25)), level);
  }
  // Dotted lines: the line screen broken into round dots, like trailing particles.
  float sp = uPeriod * 1.5;
  float yw = q.y + ripple;
  float centre = (floor(yw / sp) + 0.5) * sp;
  float cx = (floor(q.x / sp) + 0.5) * sp;
  t = toneOf(which, (vec2(cx, centre - ripple) - uScreenOffset) / uRes);
  w = 0.5 * sp * sqrt(clamp(t + (g1 - 0.5) * grainAmt, 0.0, 1.0)) * reveal;
  dist = length(vec2(q.x - cx, yw - centre));
  return smoothstep(w + aa, w - aa, dist) * step(0.04 * sp, w);
}

#if MORPHSCREEN
vec2 hash2(vec2 p) {
  return vec2(hash(p * 1.0 + 3.1), hash(p * 1.7 + 11.3));
}

// The morphing screen behind the game: drifting Voronoi cells, each showing one screen, which
// it hands on to the next every few seconds through a pixel-by-pixel threshold dissolve.
float morphScreen(vec2 fc) {
  vec2 g = fc / uCellSize;
  vec2 ip = floor(g);
  float best = 1e9;
  vec2 bestId = ip;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 id = ip + vec2(float(x), float(y));
      vec2 h = hash2(id);
      vec2 seed = id + 0.5 + 0.38 * sin(uTime * vec2(0.09, 0.07) + 6.2831853 * h);
      float d = length(g - seed);
      if (d < best) {
        best = d;
        bestId = id;
      }
    }
  }
  float h = hash(bestId + 7.0);
  float cyc = uTime / 11.0 + h * 4.0;
  float k = floor(cyc);
  float f = fract(cyc);
  float s0 = mod(k + floor(h * 4.0), 4.0);
  float s1 = mod(s0 + 1.0, 4.0);
  float n = hash(floor(fc / (uPeriod * 2.0)) + bestId * 13.0);
  return f > 0.8 && n < (f - 0.8) / 0.2 ? s1 : s0;
}
#endif

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = fc / uRes;

  // ---- line screen geometry -------------------------------------------------------------
  // The ripple amplitude itself varies along x, so edges shimmer like a vibrating engraving.
  vec2 q = fc + uScreenOffset;
  float ampMod = 0.55 + 0.45 * sin(q.x * 0.0023 + uPhase * 0.61 + sin(q.y * 0.0031 + uPhase * 0.2));
  float ripple = uRippleAmp * ampMod * sin(6.2831853 * q.x / uRippleWave + uPhase);
  float line = floor((q.y + ripple) / uPeriod);

  // ---- grain -----------------------------------------------------------------------------
  vec2 gp = fc + uGrainOffset;
  float g1 = hash3(vec3(gp, uFrame));
  float g2 = hash3(vec3(gp + 7.31, uFrame + 3.0));
  float grainAmt = uGrain * 0.9;
  float revealLine = clamp(uReveal * 1.6 - hash(vec2(line, 5.0)) * 0.6, 0.0, 1.0);

  // ---- coverage of both planes -----------------------------------------------------------
#if MORPHSCREEN
  float screenA = morphScreen(fc);
  float screenB = screenA;
#else
  float screenA = float(SCREEN_A);
  float screenB = float(SCREEN_B);
#endif
  float tA, wA, dA, tB, wB, dB;
  float covA = cover(screenA, 0, fc, ripple, g1, grainAmt, revealLine, tA, wA, dA);
  float covB = covA;
  tB = tA; wB = wA; dB = dA;
#if DISSOLVE
  covB = cover(screenB, 1, fc, ripple, g1, grainAmt, revealLine, tB, wB, dB);
#endif

  // ---- segment-wise threshold dissolve ------------------------------------------------------
  float segLen = uPeriod * (6.0 + 10.0 * hash(vec2(line, 91.0)));
  float seg = floor((q.x + hash(vec2(line, 13.0)) * segLen) / segLen);
  float n = hash(vec2(seg, line));
  float p = clamp((uDissolve - n * 0.6) / 0.4, 0.0, 1.0);
  // Old marks thin and break first, new marks then form segment by segment.
  float cov = max(covB * (1.0 - smoothstep(0.0, 0.55, p)), covA * smoothstep(0.45, 1.0, p));
  float w = mix(wB, wA, step(0.5, p));
  float dist = mix(dB, dA, step(0.5, p));

  // ---- duotone -----------------------------------------------------------------------------
  float bleed = smoothstep(0.32, 0.0, uv.y) * (0.65 + 0.35 * sin(uv.x * 3.1 + uPhase * 0.17));
  vec3 lightInk = mix(uInkLight, uInkBleed, bleed * (1.0 - 0.7 * uCalm));
  // The opponent's accent colours the light ink.
  lightInk = mix(lightInk, uAccent, uAccentAmt * (1.0 - 0.45 * uCalm));
  // A thin secondary tint in the cores of the brightest marks.
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

/** Which parts of the fragment shader a frame needs. */
export interface FragmentVariant {
  screenA: number;
  /** null when no dissolve is running. */
  screenB: number | null;
  morph: boolean;
  /** The morphing Voronoi screen (behind the game) instead of the fixed screens. */
  morphScreen: boolean;
}

export function variantKey(v: FragmentVariant): string {
  return `${v.screenA}${v.screenB ?? '-'}${v.morph ? 'M' : ''}${v.morphScreen ? 'V' : ''}`;
}

export function fragmentSource(v: FragmentVariant): string {
  const defines = [
    `#define SCREEN_A ${v.screenA}`,
    `#define SCREEN_B ${v.screenB ?? v.screenA}`,
    `#define DISSOLVE ${v.screenB === null ? 0 : 1}`,
    `#define MORPH ${v.morph ? 1 : 0}`,
    `#define MORPHSCREEN ${v.morphScreen ? 1 : 0}`
  ].join('\n');
  return FRAGMENT.replace('#version 300 es\n', `#version 300 es\n${defines}\n`);
}
