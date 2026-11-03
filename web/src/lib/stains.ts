// The colours a colony can take: real histological stains, so the dish reads like a stained slide.
// Every stain has to stand out on the dark macro agar, so the near-black ones (nigrosin) are left out.
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
];

/** Stains in the order a new colony is offered them: the ones that read best on dark agar first. */
const PREFERRED = ["Eosin", "Light green", "Auramine", "Nile blue", "Carbol fuchsin", "Safranin", "Malachite green", "Congo red", "Crystal violet", "Methylene blue", "Toluidine blue", "Bismarck brown"];

export function stainName(color: number): string | null {
  return STAINS.find((s) => s.color === color)?.name ?? null;
}

/** The first high-contrast stain no colony is using yet (or the first preferred one if all are taken). */
export function firstFreeStain(taken: Set<number>): number {
  for (const n of PREFERRED) {
    const s = STAINS.find((x) => x.name === n);
    if (s && !taken.has(s.color)) return s.color;
  }
  return STAINS.find((x) => x.name === PREFERRED[0])!.color;
}
