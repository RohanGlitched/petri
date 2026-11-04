// WebGL2 renderer for the dish. Same-colony cells merge into one colony body (a soft field summed over each
// neighbourhood). Three looks share it:
//   plate  glossy domed colonies on lit amber agar (light pages)
//   fluor  fluorescence microscopy: colonies glow in their channel colour on black
//   macro  a close-up under raking light, deep agar, strong highlights
// Births swell in and deaths fade out across a short transition between generations. The dish is a torus, so the
// view wraps without seams in every direction.

export type Look = "plate" | "fluor" | "macro";
const LOOK_ID: Record<Look, number> = { plate: 0, fluor: 1, macro: 2 };

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uCells;
uniform usampler2D uPrev;
uniform usampler2D uOverlay;
uniform sampler2D uPalette;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uT;
uniform float uRadius;     // > 0: round field of view of this radius (device px); 0: fill the canvas
uniform ivec2 uDish;
uniform float uTime;
uniform int uLook;
uniform vec3 uAgarDeep;
uniform vec3 uAgarLit;
uniform vec3 uLight;
uniform float uGlow;       // fluor glow strength, animated on load
uniform vec3 uGhost;       // the player's stain, for the "fits here" ghost
out vec4 outColor;

vec3 colonyColor(uint id) { return texelFetch(uPalette, ivec2(int(id % 256u), int(id / 256u)), 0).rgb; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
ivec2 wrapCell(ivec2 c) { return ivec2((c.x % uDish.x + uDish.x) % uDish.x, (c.y % uDish.y + uDish.y) % uDish.y); }

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 rel = px - uRes * 0.5;
  float r = length(rel);
  bool round = uRadius > 0.0;
  if (round && r > uRadius + 1.5) { outColor = vec4(0.0); return; }
  float R = round ? uRadius : length(uRes) * 0.5;

  vec2 cellPos = uCenter + rel / uZoom;
  ivec2 base = ivec2(floor(cellPos));
  vec2 f = cellPos - vec2(base);

  float sumNow = 0.0, sumPrev = 0.0, wsum = 0.0, born = 0.0, died = 0.0;
  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);
  float glowW = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 c = wrapCell(base + ivec2(dx, dy));
      uint now = texelFetch(uCells, c, 0).r;
      uint prev = texelFetch(uPrev, c, 0).r;
      if (now == 0u && prev == 0u) continue;
      vec2 centre = vec2(float(dx), float(dy)) + 0.5;
      float d = length(f - centre);
      float k = max(0.0, 1.0 - d / 1.18);
      k = k * k;
      float g = exp(-d * d / 2.6);
      float wn = now > 0u ? k : 0.0;
      float wp = prev > 0u ? k : 0.0;
      sumNow += wn;
      sumPrev += wp;
      uint id = now > 0u ? now : prev;
      vec3 cc = colonyColor(id);
      float w = mix(wp, wn, uT);
      if (w > 0.0) { col += w * cc; wsum += w; }
      float gw = mix(prev > 0u ? g : 0.0, now > 0u ? g : 0.0, uT);
      glow += gw * cc;
      glowW += gw;
      if (now > 0u && prev == 0u) born += k;
      if (now == 0u && prev > 0u) died += k;
    }
  }
  float field = mix(sumPrev, sumNow, smoothstep(0.0, 1.0, uT));
  vec3 culture = wsum > 0.0 ? col / wsum : (glowW > 0.0 ? glow / glowW : vec3(0.0));
  float far = 1.0 - smoothstep(3.0, 10.0, uZoom);
  float edge = mix(0.40, 0.20, far);
  float body = smoothstep(edge, edge + 0.10, field);
  float grain = noise(cellPos * 1.7) * 0.5 + noise(cellPos * 0.31) * 0.5;
  float lamp = 1.0 - smoothstep(0.0, R * 1.1, r);
  vec3 c;

  if (uLook == 1) {
    // Fluorescence: dark field, each colony glows in its channel colour, tone-mapped so dense colonies saturate.
    vec3 bg = vec3(0.010, 0.014, 0.026) + vec3(0.006, 0.008, 0.014) * grain;
    vec3 emit = culture * body * 1.25 + glow * 0.16 * uGlow;
    emit += born * (1.0 - uT) * 0.9 * vec3(1.0);
    emit += died * (1.0 - uT) * 0.25 * culture;
    float core = smoothstep(1.0, 2.0, field);
    emit += culture * core * 0.6;
    c = bg + (vec3(1.0) - exp(-emit * 1.35));
    if (uZoom > 10.0) {
      vec2 gq = abs(f - 0.5);
      float line = smoothstep(0.5 - 0.6 / uZoom, 0.5, max(gq.x, gq.y));
      c += vec3(0.05, 0.07, 0.11) * line * smoothstep(10.0, 24.0, uZoom);
    }
  } else {
    // Plate and macro: colonies are glossy domes lit from above; a soft contact shadow sits on the agar.
    float dome = body * (0.55 + 0.45 * smoothstep(edge, 1.5, field));
    float s = uZoom * (uLook == 2 ? 0.55 : 0.32);
    vec3 n = normalize(vec3(-dFdx(dome) * s, -dFdy(dome) * s, 1.0));
    vec3 L = normalize(uLight);
    float diff = clamp(dot(n, L), 0.0, 1.0);
    float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), uLook == 2 ? 46.0 : 70.0);
    vec3 agar = mix(uAgarDeep, uAgarLit, lamp * 0.85 + 0.1) * (0.95 + 0.07 * grain);
    float shadow = smoothstep(0.02, edge, field) * (1.0 - body);
    agar *= 1.0 - shadow * (uLook == 2 ? 0.45 : 0.22);
    agar = mix(agar, culture * 0.7 + agar * 0.3, shadow * 0.12);
    vec3 colony = culture * (0.50 + 0.62 * diff);
    colony += spec * (uLook == 2 ? 0.75 : 0.5) * vec3(1.0, 0.98, 0.94);
    float halo = born * (1.0 - uT) * 0.45;
    colony += halo * vec3(1.0, 0.97, 0.9);
    c = mix(agar, colony, body);
    if (uZoom > 10.0) {
      vec2 gq = abs(f - 0.5);
      float line = smoothstep(0.5 - 0.6 / uZoom, 0.5, max(gq.x, gq.y));
      c = mix(c, c * 0.9, line * smoothstep(10.0, 24.0, uZoom) * 0.5);
    }
  }

  // Overlay: 1 ghost ok, 2 ghost blocked, 3 forbidden buffer, 4 pending planting, 5 highlight,
  // 6 inside a slide frame, 7 a cell the slide would keep, 8 outside the frame (dimmed, as under a field stop).
  uint ov = texelFetch(uOverlay, wrapCell(base), 0).r;
  if (ov == 8u) {
    c *= 0.62;
  } else if (ov == 6u || ov == 7u) {
    c = mix(c, vec3(1.0, 0.97, 0.9), 0.05);
    if (ov == 7u) {
      vec2 q = f - 0.5;
      float ringK = smoothstep(0.36, 0.42, length(q)) * (1.0 - smoothstep(0.46, 0.52, length(q)));
      c = mix(c, mix(uGhost, vec3(1.0), 0.45), ringK * 0.55);
    }
    // The frame's edge: a fine line on each side whose neighbour lies outside the frame.
    float lw = clamp(1.6 / uZoom, 0.03, 0.22);
    vec3 edgeInk = vec3(1.0, 0.86, 0.58);
    uint l = texelFetch(uOverlay, wrapCell(base + ivec2(-1, 0)), 0).r;
    uint rr = texelFetch(uOverlay, wrapCell(base + ivec2(1, 0)), 0).r;
    uint t = texelFetch(uOverlay, wrapCell(base + ivec2(0, -1)), 0).r;
    uint b = texelFetch(uOverlay, wrapCell(base + ivec2(0, 1)), 0).r;
    float e = 0.0;
    if (l != 6u && l != 7u) e = max(e, 1.0 - smoothstep(lw * 0.5, lw, f.x));
    if (rr != 6u && rr != 7u) e = max(e, smoothstep(1.0 - lw, 1.0 - lw * 0.5, f.x));
    if (t != 6u && t != 7u) e = max(e, 1.0 - smoothstep(lw * 0.5, lw, f.y));
    if (b != 6u && b != 7u) e = max(e, smoothstep(1.0 - lw, 1.0 - lw * 0.5, f.y));
    c = mix(c, edgeInk, e * 0.95);
  } else if (ov != 0u) {
    vec2 gq = abs(f - 0.5);
    float m = max(gq.x, gq.y);
    bool dark = uLook != 0;
    vec3 okInk = dark ? vec3(0.92, 0.96, 1.0) : vec3(0.08, 0.13, 0.2);
    vec3 badInk = vec3(0.95, 0.28, 0.36);
    if (ov == 3u) {
      // Screen-space diagonal hatching, so the buffer reads as a hatched zone at any zoom.
      float d = (gl_FragCoord.x + gl_FragCoord.y) / 9.0;
      float hatch = smoothstep(0.30, 0.42, fract(d)) * (1.0 - smoothstep(0.58, 0.70, fract(d)));
      c = mix(c, badInk * (dark ? 0.55 : 0.8), 0.16);
      c = mix(c, badInk * (dark ? 0.85 : 0.7), 0.30 * hatch);
    } else if (ov == 4u) {
      float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
      c = mix(c, okInk, (0.25 + 0.3 * pulse) * (1.0 - smoothstep(0.38, 0.5, m)));
    } else if (ov == 1u) {
      // The stamp where it would grow, in the player's own stain, breathing softly.
      float pulse = 0.5 + 0.5 * sin(uTime * 3.2);
      vec2 q = f - 0.5;
      float bead = 1.0 - smoothstep(0.30, 0.40, length(q));
      float ring = smoothstep(0.38, 0.43, m) * (1.0 - smoothstep(0.46, 0.5, m));
      vec3 ink = mix(uGhost, vec3(1.0), 0.18 + 0.12 * pulse);
      c = mix(c, ink, bead * (0.55 + 0.25 * pulse) + ring * 0.6);
    } else {
      vec3 ink = ov == 2u ? badInk : okInk;
      float inner = 1.0 - smoothstep(0.30, 0.38, m);
      float ring = smoothstep(0.36, 0.42, m) * (1.0 - smoothstep(0.46, 0.5, m));
      c = mix(c, ink, inner * 0.5 + ring * 0.9);
    }
  }

  float vign = smoothstep(R * 0.5, R, r);
  c *= 1.0 - (uLook == 0 ? 0.16 : 0.42) * vign * vign;
  float alpha = 1.0;
  if (round) {
    // Meniscus: agar climbs the glass, darkening then catching a thin line of light at the rim.
    float men = smoothstep(R - 18.0, R - 2.0, r);
    c *= 1.0 - 0.22 * men;
    float lip = smoothstep(R - 4.0, R - 1.5, r) * (1.0 - smoothstep(R - 1.5, R, r));
    c = mix(c, vec3(1.0, 0.97, 0.9), lip * (uLook == 1 ? 0.12 : 0.5));
    alpha = 1.0 - smoothstep(R - 0.5, R + 1.0, r);
  }
  outColor = vec4(c, alpha);
}`;

export type Camera = { cx: number; cy: number; zoom: number };

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
let fast: boolean | null = null;

/**
 * Whether this browser draws WebGL2 on a real GPU. Checked once, on a throwaway canvas (a canvas that has had a WebGL
 * context can never get a 2D one): the context must come up without a major performance caveat, and the renderer must
 * not be a software one (SwiftShader, llvmpipe), as in headless Chrome. `?gl=2d` forces the fallback, for testing.
 */
export function fastGL(): boolean {
  if (fast !== null) return fast;
  fast = false;
  try {
    if (/[?&]gl=2d(&|$)/.test(window.location.search)) return fast;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) return fast;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    fast = !SOFTWARE.test(renderer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    fast = false;
  }
  return fast;
}

export type LookParams = { agarDeep: [number, number, number]; agarLit: [number, number, number]; light: [number, number, number] };

export const LOOKS: Record<Look, LookParams> = {
  plate: { agarDeep: [0.86, 0.6, 0.24], agarLit: [0.99, 0.86, 0.56], light: [-0.45, 0.6, 0.75] },
  fluor: { agarDeep: [0, 0, 0], agarLit: [0, 0, 0], light: [0, 0, 1] },
  macro: { agarDeep: [0.16, 0.07, 0.02], agarLit: [0.52, 0.27, 0.08], light: [-0.7, 0.55, 0.5] },
};

export class CultureGL {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  tex: { cells: WebGLTexture; prev: WebGLTexture; overlay: WebGLTexture; palette: WebGLTexture };
  w: number;
  h: number;
  loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement, w: number, h: number) {
    // A software rasteriser would take hundreds of milliseconds a frame on this shader: refuse it, and let the caller
    // fall back to the 2D renderer (see `fastGL`).
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: true, failIfMajorPerformanceCaveat: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.w = w;
    this.h = h;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uCells", "uPrev", "uOverlay", "uPalette", "uRes", "uCenter", "uZoom", "uT", "uRadius", "uDish", "uTime", "uLook", "uAgarDeep", "uAgarLit", "uLight", "uGlow", "uGhost"]) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
    this.tex = {
      cells: this.makeInt(w, h, gl.R16UI, gl.UNSIGNED_SHORT, new Uint16Array(w * h)),
      prev: this.makeInt(w, h, gl.R16UI, gl.UNSIGNED_SHORT, new Uint16Array(w * h)),
      overlay: this.makeInt(w, h, gl.R8UI, gl.UNSIGNED_BYTE, new Uint8Array(w * h)),
      palette: gl.createTexture()!,
    };
    gl.bindTexture(gl.TEXTURE_2D, this.tex.palette);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * 256 * 4));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeInt(w: number, h: number, internal: number, type: number, data: ArrayBufferView) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RED_INTEGER, type, data);
    return t;
  }

  setCells(now: Uint16Array, prev: Uint16Array) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.cells);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, now);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.prev);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, prev);
  }

  setOverlay(o: Uint8Array) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.overlay);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, o);
  }

  /** colors[id] = 0xRRGGBB */
  setPalette(colors: Map<number, number>) {
    const data = new Uint8Array(256 * 256 * 4);
    colors.forEach((rgb, id) => {
      if (id <= 0 || id >= 65536) return;
      const o = id * 4;
      data[o] = (rgb >> 16) & 255;
      data[o + 1] = (rgb >> 8) & 255;
      data[o + 2] = rgb & 255;
      data[o + 3] = 255;
    });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.palette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  draw(cam: Camera, size: { w: number; h: number }, opts: { radius: number; t: number; time: number; look: Look; glow: number; ghost?: number }) {
    const gl = this.gl;
    const p = LOOKS[opts.look];
    gl.viewport(0, 0, size.w, size.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.loc[name], unit);
    };
    bind(0, this.tex.cells, "uCells");
    bind(1, this.tex.prev, "uPrev");
    bind(2, this.tex.overlay, "uOverlay");
    bind(3, this.tex.palette, "uPalette");
    gl.uniform2f(this.loc.uRes, size.w, size.h);
    gl.uniform2f(this.loc.uCenter, cam.cx, cam.cy);
    gl.uniform1f(this.loc.uZoom, cam.zoom);
    gl.uniform1f(this.loc.uT, opts.t);
    gl.uniform1f(this.loc.uRadius, opts.radius);
    gl.uniform2i(this.loc.uDish, this.w, this.h);
    gl.uniform1f(this.loc.uTime, opts.time);
    gl.uniform1i(this.loc.uLook, LOOK_ID[opts.look]);
    gl.uniform3fv(this.loc.uAgarDeep, p.agarDeep);
    gl.uniform3fv(this.loc.uAgarLit, p.agarLit);
    gl.uniform3fv(this.loc.uLight, p.light);
    gl.uniform1f(this.loc.uGlow, opts.glow);
    const g = opts.ghost ?? 0xf2b45a;
    gl.uniform3f(this.loc.uGhost, ((g >> 16) & 255) / 255, ((g >> 8) & 255) / 255, (g & 255) / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    Object.values(this.tex).forEach((t) => gl.deleteTexture(t));
    gl.deleteProgram(this.prog);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader failed");
  return s;
}
