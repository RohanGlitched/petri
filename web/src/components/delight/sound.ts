// The dish sings: a generative Web Audio piece played by the live board. Loaded only when someone turns sound on.
//
//   births      soft plucked notes on a D major pentatonic, one small motif per busy colony, its timbre from the
//               colony's stain (reds a felt piano, yellows a marimba, greens a kalimba tine, blues a glass bell,
//               violets a harp), panned to where on the dish they happened
//   deaths      a lower, muted note for a colony that lost cells
//   your cells  a celesta voice of their own, a little brighter and nearer
//   collisions  two colonies destroying each other: a low resonant drum, far back in the room
//   the tide    a breath of filtered noise that rises over the last generations before each tide, then a warm bloom
//   the pad     four slow chords under everything, opening as the dish gets busier
//
// Every generation is one bar: its notes are spread over most of the time until the next one, with timing seeded by
// the generation number, so everyone watching the same dish hears the same piece. Voices are capped (at most eight
// notes a generation, sixteen sounding at once), everything runs through a compressor and a limiter, and the context
// is closed when sound is turned off.

import type { GenReport } from "./analysis";
import { ringDelta } from "./analysis";

export type SingInput = {
  report: GenReport;
  colors: Map<number, number>;
  /** The listener's own colony, which gets its own voice. */
  mine?: number | null;
  w: number;
  h: number;
  /** Seconds until the next generation: the bar's length. */
  barSec: number;
  /** Generations until the next tide, and how often a tide runs. */
  tideIn: number;
  tideEvery: number;
  /** Where the listener is looking (cell x), for panning; the dish's centre when unknown. */
  ear?: number;
  /** Fewer notes a bar, for fast-forward. */
  maxNotes?: number;
};

export type SoundLog = {
  generation: number;
  births: number;
  deaths: number;
  clash: number;
  notes: number;
  skipped: number;
  /** Voices sounding when the bar was scheduled. */
  active: number;
  /** Highest voice count since the previous bar. */
  maxActive: number;
  /** Loudest sample and RMS at the output since the previous bar, in dBFS. */
  peakDb: number;
  rmsDb: number;
  swell: number;
};

const PENTA = [0, 2, 4, 7, 9];
const BASE = 50; // D3
const CHORDS = [
  [50, 57, 64, 66], // D add9
  [47, 54, 62, 64], // B minor 7 (add 11)
  [43, 50, 57, 66], // G maj9 (no third)
  [45, 52, 59, 64], // A sus2
];
const MAX_NOTES = 8;
const MAX_VOICES = 16;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);

/** A small deterministic generator: the same generation always plays the same bar. */
function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

type Timbre = "felt" | "marimba" | "kalimba" | "glass" | "harp";

function hsl(rgb: number) {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

/** A colony's voice, from its stain colour. */
function voiceOf(rgb: number) {
  const { h, s, l } = hsl(rgb);
  const timbre: Timbre = h < 22 || h >= 318 ? "felt" : h < 72 ? "marimba" : h < 175 ? "kalimba" : h < 255 ? "glass" : "harp";
  // Each colony leans on its own scale degree and register, so two colonies rarely play the same note.
  const home = Math.floor((h / 360) * 5) % 5;
  const octave = l > 0.52 ? 2 : l > 0.36 ? 1 : 1;
  return { timbre, home, octave, bright: 0.55 + 0.45 * s };
}

export class DishSound {
  readonly ctx: AudioContext;
  private master: GainNode;
  private bus: GainNode;
  private wet: GainNode;
  private analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private padFilter: BiquadFilterNode;
  private padGain: GainNode;
  private padOsc: OscillatorNode[] = [];
  private swellGain: GainNode;
  private swellFilter: BiquadFilterNode;
  private noise: AudioBuffer;
  private chord = -1;
  private active = 0;
  private maxActive = 0;
  private peak = 0;
  private sumSq = 0;
  private samples = 0;
  private meter: ReturnType<typeof setInterval> | null = null;
  private lastHit = -1e9;
  private lastTideIn = -1;
  private volume = 0.7;
  reduced = false;
  log: SoundLog[] = [];

  constructor(volume = 0.7) {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "playback" });
    const ctx = this.ctx;
    this.volume = volume;

    // Output: master volume, a gentle compressor, then a hard limiter, so nothing ever clips.
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.master.connect(comp).connect(limit).connect(this.analyser).connect(ctx.destination);

    // A large, soft room.
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(4.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    verb.connect(this.wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.8;
    this.bus.connect(this.master);
    this.bus.connect(verb);

    // The pad: four chord tones, each two detuned saws, through one slow low-pass.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 520;
    this.padFilter.Q.value = 0.6;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master);
    this.padGain.connect(verb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 140;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();
    for (let i = 0; i < 8; i++) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.detune.value = i % 2 ? 7 : -7;
      o.frequency.value = mtof(CHORDS[0][i >> 1]);
      const g = ctx.createGain();
      g.gain.value = (i >> 1) === 0 ? 0.32 : 0.22;
      o.connect(g).connect(this.padFilter);
      o.start();
      this.padOsc.push(o);
    }

    // The tide's breath: looping noise through a band-pass that rises as the tide nears.
    this.noise = this.noiseBuffer(3);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.swellFilter = ctx.createBiquadFilter();
    this.swellFilter.type = "bandpass";
    this.swellFilter.frequency.value = 400;
    this.swellFilter.Q.value = 0.9;
    this.swellGain = ctx.createGain();
    this.swellGain.gain.value = 0;
    src.connect(this.swellFilter).connect(this.swellGain);
    this.swellGain.connect(this.master);
    this.swellGain.connect(verb);
    src.start();

    this.setChord(0);
    this.meter = setInterval(() => this.measure(), 120);
  }

  async start() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.volume * 0.62, t + 2.5);
    this.padGain.gain.setTargetAtTime(this.reduced ? 0.04 : 0.06, t, 2.5);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.volume * 0.62, t, 0.08);
  }

  /** Fade out, then release the audio device. */
  async stop() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.15);
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    await new Promise((r) => setTimeout(r, 700));
    try {
      await this.ctx.close();
    } catch {
      /* already closed */
    }
  }

  suspend() {
    if (this.ctx.state === "running") this.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  stats() {
    return { active: this.active, state: this.ctx.state, log: this.log.slice(-40) };
  }

  /** One generation: schedule its bar. */
  sing(inp: SingInput) {
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    const { report: r, colors, w } = inp;
    const t0 = ctx.currentTime + 0.06;
    const bar = Math.max(0.6, Math.min(10, inp.barSec)) * 0.82;
    const rand = rng(r.generation * 2654435761 + 7);
    const ear = inp.ear ?? w / 2;
    const pan = (x: number) => (Number.isFinite(x) ? Math.max(-0.85, Math.min(0.85, (ringDelta(ear, x, w) / (w / 2)) * 0.85)) : 0);
    const cap = Math.min(inp.maxNotes ?? MAX_NOTES, this.reduced ? 3 : MAX_NOTES);
    let notes = 0;
    let skipped = 0;
    const activeAtStart = this.active;

    // The pad follows the dish: a new chord every eight generations, brighter when more is happening.
    this.setChord(Math.floor(r.generation / 8) % CHORDS.length);
    const activity = Math.min(1, Math.log10(1 + r.births + r.deaths) / 2.6);
    this.padFilter.frequency.setTargetAtTime(420 + 1100 * activity, ctx.currentTime, 2.2);
    const liveLevel = Math.min(1, Math.log10(1 + r.live) / 3.6);
    this.padGain.gain.setTargetAtTime((this.reduced ? 0.035 : 0.05) + 0.03 * liveLevel, ctx.currentTime, 3);

    // Births: the busiest colonies first, a short rising motif each.
    const moments = [...r.colonies.values()];
    const born = moments.filter((m) => m.births > 0).sort((a, b) => b.births - a.births);
    const died = moments.filter((m) => m.deaths > 1).sort((a, b) => b.deaths - a.deaths);
    const mine = inp.mine ? r.colonies.get(inp.mine) : undefined;
    const plan: { at: number; fn: () => void; prio: number }[] = [];

    if (mine && mine.births > 0) {
      const n = mine.births > 3 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const deg = 2 + k * 2 + Math.floor(rand() * 2);
        const at = t0 + bar * (0.08 + 0.3 * k + 0.1 * rand());
        plan.push({ at, prio: 3, fn: () => this.celesta(at, BASE + 24 + this.degree(deg), pan(mine.bornX), 0.5) });
      }
    }
    for (const m of born) {
      if (m.id === inp.mine) continue;
      const v = voiceOf(colors.get(m.id) ?? 0x999999);
      const count = Math.min(3, Math.max(1, Math.round(Math.log2(1 + m.births) / 1.6)));
      const vel = Math.min(0.6, 0.28 + 0.12 * Math.log10(1 + m.births));
      const start = rand() * 0.55;
      for (let k = 0; k < count; k++) {
        const deg = v.home + k * (1 + Math.floor(rand() * 2));
        const at = t0 + bar * Math.min(0.92, start + k * (0.06 + rand() * 0.1));
        plan.push({ at, prio: 2 - k * 0.3, fn: () => this.pluck(at, BASE + 12 * v.octave + this.degree(deg), v.timbre, pan(m.bornX), vel * (k ? 0.75 : 1), v.bright) });
      }
    }
    for (const m of died.slice(0, 3)) {
      const v = voiceOf(colors.get(m.id) ?? 0x999999);
      const at = t0 + bar * (0.35 + rand() * 0.55);
      const vel = Math.min(0.42, 0.18 + 0.08 * Math.log10(1 + m.deaths));
      plan.push({ at, prio: 1, fn: () => this.pluck(at, BASE + this.degree(v.home + 5 - 2), "felt", pan(m.diedX), vel, 0.35) });
    }
    plan.sort((a, b) => b.prio - a.prio);
    for (const p of plan) {
      if (notes >= cap || this.active + notes >= MAX_VOICES) {
        skipped++;
        continue;
      }
      notes++;
      p.fn();
    }

    // Two colonies meeting and losing cells to each other: a low drum, at most every few seconds.
    if (!this.reduced && r.clash && r.clashCells >= 4 && ctx.currentTime - this.lastHit > 4) {
      this.lastHit = ctx.currentTime;
      this.hit(t0 + 0.02, pan(r.clash.x), Math.min(0.9, 0.35 + 0.18 * Math.log10(r.clashCells)));
    }

    // The tide: a breath that rises over the last eight generations, and a bloom when it turns.
    const swell = inp.tideIn > 0 && inp.tideIn <= 8 ? (9 - inp.tideIn) / 8 : 0;
    const now = ctx.currentTime;
    this.swellGain.gain.setTargetAtTime(swell * (this.reduced ? 0.05 : 0.09), now, Math.max(0.5, bar / 2));
    this.swellFilter.frequency.setTargetAtTime(380 + 1400 * swell, now, Math.max(0.5, bar / 2));
    if (this.lastTideIn > 0 && this.lastTideIn <= 2 && inp.tideIn > this.lastTideIn) this.bloom(t0);
    this.lastTideIn = inp.tideIn;

    this.log.push({
      generation: r.generation,
      births: r.births,
      deaths: r.deaths,
      clash: r.clashCells,
      notes,
      skipped,
      active: activeAtStart,
      maxActive: this.maxActive,
      peakDb: Math.round(db(this.peak) * 10) / 10,
      rmsDb: Math.round(db(Math.sqrt(this.sumSq / Math.max(1, this.samples))) * 10) / 10,
      swell: Math.round(swell * 100) / 100,
    });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.peak = 0;
    this.sumSq = 0;
    this.samples = 0;
    this.maxActive = this.active;
  }

  /** The tide turning: the pad opens and a low D swells under it. */
  bloom(at: number) {
    const ctx = this.ctx;
    this.padFilter.frequency.setTargetAtTime(2600, at, 0.8);
    this.padFilter.frequency.setTargetAtTime(600, at + 3, 3);
    this.swellGain.gain.setTargetAtTime(0, at, 1.6);
    for (const m of [38, 50, 57]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = mtof(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(m === 38 ? 0.16 : 0.07, at + 2.2);
      g.gain.setTargetAtTime(0, at + 2.6, 1.8);
      o.connect(g).connect(this.bus);
      this.track(o, at, at + 10, g);
    }
  }

  private degree(d: number) {
    const k = ((d % 5) + 5) % 5;
    return PENTA[k] + 12 * Math.floor(d / 5);
  }

  private setChord(i: number) {
    if (i === this.chord) return;
    this.chord = i;
    const t = this.ctx.currentTime;
    this.padOsc.forEach((o, k) => o.frequency.setTargetAtTime(mtof(CHORDS[i][k >> 1]), t, 1.4));
  }

  /** Start a voice's main oscillator; when it ends, the voice's nodes are disconnected and the voice count drops. */
  private track(o: AudioScheduledSourceNode, at: number, end: number, ...nodes: AudioNode[]) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    o.start(at);
    o.stop(end);
    o.onended = () => {
      this.active--;
      o.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
  }

  /** One plucked note. Everything decays to silence on its own; nothing is held. */
  private pluck(at: number, midi: number, timbre: Timbre, pan: number, vel: number, bright: number) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    out.connect(lp).connect(p).connect(this.bus);
    const decay = { felt: 2.4, marimba: 1.6, kalimba: 2.6, glass: 4.2, harp: 3.2 }[timbre];
    const attack = { felt: 0.012, marimba: 0.004, kalimba: 0.003, glass: 0.02, harp: 0.008 }[timbre];
    lp.frequency.setValueAtTime(Math.min(9000, f * (timbre === "felt" ? 5 : 9) * bright), at);
    lp.frequency.setTargetAtTime(f * 2.2, at + attack, decay / 3);
    const peak = vel * 0.22;
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(peak, at + attack);
    out.gain.setTargetAtTime(0, at + attack, decay / 4.5);
    const end = at + decay * 1.4;

    const car = ctx.createOscillator();
    car.type = timbre === "felt" || timbre === "harp" ? "triangle" : "sine";
    car.frequency.value = f;
    car.connect(out);
    this.track(car, at, end, out, lp, p);
    if (timbre === "marimba" || timbre === "kalimba" || timbre === "harp") {
      // A bright partial that dies quickly: the strike.
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * (timbre === "marimba" ? 4 : timbre === "kalimba" ? 5.4 : 2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak * (timbre === "harp" ? 0.35 : 0.5), at + 0.003);
      g.gain.setTargetAtTime(0, at + 0.004, timbre === "harp" ? 0.5 : 0.09);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 2);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    }
    if (timbre === "glass") {
      // A soft FM bell: the modulator's depth decays, so it starts glassy and settles to a sine.
      const m = ctx.createOscillator();
      m.frequency.value = f * 2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(f * 1.4, at);
      depth.gain.setTargetAtTime(0, at, 0.6);
      m.connect(depth).connect(car.frequency);
      m.start(at);
      m.stop(end);
      m.onended = () => {
        m.disconnect();
        depth.disconnect();
      };
    }
  }

  /** The listener's own colony: a celesta, a fifth and a bell partial over a sine, slightly nearer. */
  private celesta(at: number, midi: number, pan: number, vel: number) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.6;
    out.connect(p).connect(this.bus);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(vel * 0.26, at + 0.01);
    out.gain.setTargetAtTime(0, at + 0.01, 1.1);
    const end = at + 6;
    const partials: [number, number][] = [[1, 1], [2.0, 0.28], [4.07, 0.12]];
    partials.forEach(([ratio, g], i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * ratio;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(out);
      if (i === 0) this.track(o, at, end, gg, out, p);
      else {
        o.start(at);
        o.stop(end);
        o.onended = () => {
          o.disconnect();
          gg.disconnect();
        };
      }
    });
  }

  /** A low drum in a big room: a falling sine and a resonant thump of noise. */
  private hit(at: number, pan: number, vel: number) {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.7;
    const out = ctx.createGain();
    out.connect(p).connect(this.bus);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(vel * 0.5, at + 0.006);
    out.gain.setTargetAtTime(0, at + 0.01, 0.7);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.9);
    o.connect(out);
    this.track(o, at, at + 4, out, p);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.value = 160;
    bp.Q.value = 9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, at);
    ng.gain.setTargetAtTime(0, at, 0.12);
    n.connect(bp).connect(ng).connect(out);
    n.start(at);
    n.stop(at + 1.2);
    n.onended = () => {
      n.disconnect();
      bp.disconnect();
      ng.disconnect();
    };
  }

  private measure() {
    if (this.ctx.state !== "running") return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let pk = 0;
    let sq = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs(this.buf[i]);
      if (v > pk) pk = v;
      sq += v * v;
    }
    this.peak = Math.max(this.peak, pk);
    this.sumSq += sq / this.buf.length;
    this.samples++;
  }

  private noiseBuffer(sec: number) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    // Pink-ish: white noise through a gentle one-pole low-pass.
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.2;
      d[i] = last;
    }
    return b;
  }

  /** A stereo room: decaying noise, darker as it fades, after a short pre-delay. */
  private impulse(sec: number) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    const pre = Math.floor(ctx.sampleRate * 0.025);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / (n - pre);
        const k = 0.35 + 0.6 * t;
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 2.6) * 1.6;
      }
    }
    return b;
  }
}
