// The colours a colony can take: real histological and fluorescent stains, so the dish reads like a stained slide.
// Every stain has to stand out on the dark macro agar, so the near-black ones (nigrosin, Sudan black) are left out, and
// no two sit closer than about 12 units of CIELAB distance (most are 20 or more apart).
export const STAINS: { name: string; color: number }[] = [
  { name: "Crystal violet", color: 0x6b2fa0 },
  { name: "Safranin", color: 0xc8325a },
  { name: "Methylene blue", color: 0x2364aa },
  { name: "Malachite green", color: 0x1e8c6e },
  { name: "Carbol fuchsin", color: 0xb0287e },
  { name: "Congo red", color: 0xc8431f },
  { name: "Toluidine blue", color: 0x3a4fa3 },
  { name: "Bismarck brown", color: 0x7a4a22 },
  { name: "Nile blue", color: 0x1f7f9e },
  { name: "Eosin", color: 0xe0567f },
  { name: "Auramine", color: 0xd9b42a },
  { name: "Light green", color: 0x4c9a3a },
  { name: "Calcofluor white", color: 0xd4ecf4 },
  { name: "Fluorescein", color: 0xb6dd3c },
  { name: "Basic fuchsin", color: 0xd843d2 },
  { name: "Giemsa", color: 0x9670e6 },
  { name: "Coomassie blue", color: 0x3f63ec },
  { name: "Bromophenol blue", color: 0x4cb8f2 },
  { name: "Janus green", color: 0x52d6a6 },
  { name: "Phloxine", color: 0xff8ac6 },
  { name: "Picric acid", color: 0xf4e45c },
  { name: "Orange G", color: 0xff9a3c },
  { name: "Alcian blue", color: 0x1fc8c8 },
  { name: "Neutral red", color: 0xe8695e },
];

/** Stains in the order a new colony is offered them: the ones that read best on dark agar first. */
const PREFERRED = [
  "Eosin",
  "Light green",
  "Auramine",
  "Nile blue",
  "Carbol fuchsin",
  "Calcofluor white",
  "Fluorescein",
  "Bromophenol blue",
  "Basic fuchsin",
  "Janus green",
  "Picric acid",
  "Giemsa",
  "Alcian blue",
  "Phloxine",
  "Coomassie blue",
  "Orange G",
  "Safranin",
  "Malachite green",
  "Neutral red",
  "Congo red",
  "Crystal violet",
  "Methylene blue",
  "Toluidine blue",
  "Bismarck brown",
];

export function stainName(color: number): string | null {
  return STAINS.find((s) => s.color === color)?.name ?? null;
}

/** CIELAB of a 0xRRGGBB colour (D65), for telling stains apart the way an eye does. */
function lab(rgb: number): [number, number, number] {
  const lin = (c: number) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const r = lin(((rgb >> 16) & 255) / 255);
  const g = lin(((rgb >> 8) & 255) / 255);
  const b = lin((rgb & 255) / 255);
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (a: number, b: number) => {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/**
 * The stain a new colony is offered: the first preferred one that no living colony wears and that is not easily
 * confused with one that does; failing that, the first one nobody wears; and when all are worn, the first preferred.
 * `taken` should hold only the colours of colonies that still have living cells (a dead colony's stain is free).
 */
export function firstFreeStain(taken: Set<number>): number {
  const free = PREFERRED.map((n) => STAINS.find((x) => x.name === n)!).filter((s) => !taken.has(s.color));
  const clear = free.find((s) => [...taken].every((t) => distance(s.color, t) >= 20));
  return (clear ?? free[0] ?? STAINS.find((x) => x.name === PREFERRED[0])!).color;
}

/** The colours worn by colonies that still have living cells, each with its colony's name. */
export function livingStains(colonies: { id: number; color: number; name: string }[], liveCounts: ArrayLike<number>): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of colonies) if ((liveCounts[c.id] ?? 0) > 0 && !m.has(c.color)) m.set(c.color, c.name);
  return m;
}
