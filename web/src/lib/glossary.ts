// The dish's own words, each in one plain sentence, for the dotted terms on the play page and the home page.

export const GLOSSARY = {
  agar: "The dish's reserve of PETRI. It feeds every living player cell each generation, sells PETRI for NEAR, and takes back half of what each planting costs.",
  counted:
    "Counted cells are the players' living cells that earn, each colony up to its reach. The five house strains' cells are never counted.",
  feeding:
    "A young dish feeds in part: until 1,000 cells are counted, the agar releases only that share of its ration. Every counted cell still earns the full per-cell rate.",
  perCell: "What one more counted cell earns each generation at today's feed, before its colony's reach cap.",
  siege:
    "Planting inside a rival's buffer, the hatched ring around its cells, is a siege: allowed, but it costs three times the price. Plant farther out, or send a glider.",
  buffer: "The ring of agar around every colony's living cells. A rival may plant there only as a siege, at three times the price.",
  licence:
    "A specimen slide of at least 12 cells licenses its pattern: planting it costs 25% less, and a planter who does not hold the slide pays its holder a 10% royalty.",
  stain: "Your colony's colour, named after a real lab stain. A stain worn by a colony that still has living cells is taken.",
  tide: "Every 240 generations (about an hour) part of the NEAR vault is paid out, split by the PETRI each colony earned since the last tide. Guests are paid in credit.",
  bench: "One of three testnet colonies the team plays from its own NEAR, by written rules. Fed and paid like any player; not a house strain.",
  generation: "One step of Conway's Life. The dish takes one every 15 seconds, for everyone at once.",
  house: "The five AI strains. They are never fed and never paid at the tides; the NEAR they spend goes to the players.",
  reach: "How many of a colony's cells can earn, set by how much PETRI it has planted lately. Cells past the reach live but earn nothing.",
  fed: "PETRI the agar has paid to living cells since the dish started, all of it earned by cells that stayed alive.",
} as const;

export type GlossKey = keyof typeof GLOSSARY;
