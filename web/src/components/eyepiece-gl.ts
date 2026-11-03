// WebGL2 renderer for the dish: cells drawn as stained cultures on amber agar, seen through an eyepiece.
// Same-colony cells merge into one colony body (a soft field summed over each 3x3 neighbourhood); births swell in
// and deaths fade out across a short transition between generations.

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
uniform vec2 uRes;        // canvas size in device px
uniform vec2 uCenter;     // dish coordinate at the lens centre (cells)
uniform float uZoom;      // device px per cell
uniform float uT;         // 0..1 transition from previous to current generation
uniform float uRadius;    // lens radius in device px
uniform ivec2 uDish;      // width, height in cells
uniform float uTime;
uniform float uDark;      // 1.0 in dark mode
out vec4 outColor;

vec3 colonyColor(uint id) {
  return texelFetch(uPalette, ivec2(int(id % 256u), int(id / 256u)), 0).rgb;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

ivec2 wrapCell(ivec2 c) {
  return ivec2((c.x % uDish.x + uDish.x) % uDish.x, (c.y % uDish.y + uDish.y) % uDish.y);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 rel = px - uRes * 0.5;
  float r = length(rel);
  if (r > uRadius + 1.5) { outColor = vec4(0.0); return; }

  vec2 cellPos = uCenter + rel / uZoom;
  ivec2 base = ivec2(floor(cellPos));
  vec2 f = cellPos - vec2(base);

  // Agar: lit from below, brightest in the middle, with a faint grain that moves with the dish.
  float lamp = 1.0 - smoothstep(0.0, uRadius * 1.05, r);
  float grain = noise(cellPos * 1.7) * 0.5 + noise(cellPos * 0.31) * 0.5;
  vec3 agarDeep = mix(vec3(0.70, 0.45, 0.13), vec3(0.20, 0.14, 0.07), uDark * 0.6);
  vec3 agarLit = mix(vec3(0.98, 0.83, 0.50), vec3(0.62, 0.45, 0.20), uDark * 0.5);
  vec3 agar = mix(agarDeep, agarLit, lamp * 0.85 + 0.1) * (0.94 + 0.08 * grain);

  float sumNow = 0.0, sumPrev = 0.0;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  float born = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = wrapCell(base + ivec2(dx, dy));
      uint now = texelFetch(uCells, c, 0).r;
      uint prev = texelFetch(uPrev, c, 0).r;
      vec2 centre = vec2(float(dx), float(dy)) + 0.5;
      float d = length(f - centre);
      float k = max(0.0, 1.0 - d / 1.18);
      k = k * k;
      float wn = now > 0u ? k : 0.0;
      float wp = prev > 0u ? k : 0.0;
      sumNow += wn;
      sumPrev += wp;
      float w = mix(wp, wn, uT);
      if (w > 0.0) {
        uint id = now > 0u ? now : prev;
        col += w * colonyColor(id);
        wsum += w;
      }
      if (now > 0u && prev == 0u) born += k;
    }
  }
  float field = mix(sumPrev, sumNow, smoothstep(0.0, 1.0, uT));
  vec3 culture = wsum > 0.0 ? col / wsum : vec3(0.0);
  // Zoomed out, colonies are a few pixels across: lower the edge so they read as solid stains, thin the rim.
  float far = 1.0 - smoothstep(3.0, 10.0, uZoom);
  float edge = mix(0.40, 0.18, far);
  float body = smoothstep(edge, edge + 0.08, field);
  float rim = body * (1.0 - smoothstep(edge + 0.08, edge + mix(0.30, 0.12, far), field)) * (1.0 - far * 0.7);
  float core = smoothstep(0.85, 1.6, field);
  // Stain bleeding into the agar around each colony.
  float bleed = smoothstep(0.02, edge, field) * (1.0 - body);
  vec3 stained = culture * (0.78 + 0.32 * core);
  stained = mix(stained, culture * 0.42, rim * 0.85);
  // Fresh births carry a brief bright halo.
  float halo = born * (1.0 - uT) * 0.55;
  stained += halo * vec3(1.0, 0.96, 0.85) * body;
  // Translucent colonies let the agar's light through a little.
  vec3 c = mix(agar, culture * 0.9 + agar * 0.1, bleed * 0.22);
  c = mix(c, stained, body * 0.94);

  // Cells beyond the plate's own square are wrapped copies: shown, but quieter.
  bool outside = cellPos.x < 0.0 || cellPos.y < 0.0 || cellPos.x >= float(uDish.x) || cellPos.y >= float(uDish.y);
  if (outside) c = mix(c, agarDeep * 0.9, 0.42);

  // Fine ruling when zoomed in.
  if (uZoom > 9.0) {
    vec2 g = abs(f - 0.5);
    float line = smoothstep(0.5 - 0.6 / uZoom, 0.5, max(g.x, g.y));
    c = mix(c, c * 0.86, line * smoothstep(9.0, 22.0, uZoom) * 0.6);
  }

  // Overlay: 1 ghost ok, 2 ghost blocked, 3 forbidden buffer, 4 pending planting.
  uint ov = texelFetch(uOverlay, wrapCell(base), 0).r;
  if (ov == 3u) {
    float hatch = step(0.5, fract((cellPos.x + cellPos.y) * 1.5));
    c = mix(c, vec3(0.55, 0.12, 0.20), 0.16 + 0.10 * hatch);
  } else if (ov == 1u || ov == 2u || ov == 4u) {
    vec2 g = abs(f - 0.5);
    float inner = 1.0 - smoothstep(0.30, 0.38, max(g.x, g.y));
    float edge = smoothstep(0.36, 0.42, max(g.x, g.y)) * (1.0 - smoothstep(0.46, 0.5, max(g.x, g.y)));
    vec3 ink = ov == 2u ? vec3(0.76, 0.18, 0.27) : vec3(0.11, 0.16, 0.29);
    if (ov == 4u) {
      float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
      c = mix(c, ink, 0.25 + 0.25 * pulse);
    } else {
      c = mix(c, ink, inner * 0.55 + edge * 0.9);
    }
  }

  // Lens: darker towards the edge, a thin bright inner rim, soft anti-aliased boundary.
  float vign = smoothstep(uRadius * 0.55, uRadius, r);
  c *= 1.0 - 0.38 * vign * vign;
  float ring = smoothstep(uRadius - 3.0, uRadius - 1.0, r) * (1.0 - smoothstep(uRadius - 1.0, uRadius + 0.5, r));
  c = mix(c, vec3(1.0, 0.95, 0.85), ring * 0.35);
  float alpha = 1.0 - smoothstep(uRadius - 0.5, uRadius + 1.0, r);
  outColor = vec4(c, alpha);
}`;

export type Camera = { cx: number; cy: number; zoom: number };

export class EyepieceGL {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  tex: { cells: WebGLTexture; prev: WebGLTexture; overlay: WebGLTexture; palette: WebGLTexture };
  w: number;
  h: number;
  loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement, w: number, h: number) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.w = w;
    this.h = h;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
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
    for (const n of ["uCells", "uPrev", "uOverlay", "uPalette", "uRes", "uCenter", "uZoom", "uT", "uRadius", "uDish", "uTime", "uDark"]) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
    this.tex = {
      cells: this.makeUint16(w, h),
      prev: this.makeUint16(w, h),
      overlay: this.makeUint8(w, h),
      palette: gl.createTexture()!,
    };
    gl.bindTexture(gl.TEXTURE_2D, this.tex.palette);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * 256 * 4));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeUint16(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(w * h));
    return t;
  }

  private makeUint8(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(w * h));
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

  draw(cam: Camera, size: { w: number; h: number }, radius: number, t: number, time: number, dark: boolean) {
    const gl = this.gl;
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
    gl.uniform1f(this.loc.uT, t);
    gl.uniform1f(this.loc.uRadius, radius);
    gl.uniform2i(this.loc.uDish, this.w, this.h);
    gl.uniform1f(this.loc.uTime, time);
    gl.uniform1f(this.loc.uDark, dark ? 1 : 0);
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
