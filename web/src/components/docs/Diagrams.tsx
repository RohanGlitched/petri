// Inline diagrams for the docs, drawn in the dish's own colours: PETRI in amber, NEAR in bone, credit in green.
// Text is set large in viewBox units because the figures are drawn about 0.8 times their viewBox width.

const BOX = { fill: "#1f1309", stroke: "rgba(243,233,218,0.24)" };
const AMBER = "#f2b45a";
const NEARC = "#e2d5c3";
const GREEN = "#9fd8a8";
const DIM = "#bfab93";

function Box({ x, y, w, h, title, lines = [], accent, note }: { x: number; y: number; w: number; h: number; title: string; lines?: string[]; accent?: string; note?: { text: string; color: string } }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={BOX.fill} stroke={accent ?? BOX.stroke} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + 14} y={y + 28} fill="#f3e9da" fontSize="17" fontWeight="600">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + 14} y={y + 52 + i * 20} fill={DIM} fontSize="14">
          {l}
        </text>
      ))}
      {note && (
        <text x={x + 14} y={y + h - 14} fill={note.color} fontSize="14">
          {note.text}
        </text>
      )}
    </g>
  );
}

function Label({ x, y, children, color = DIM, anchor = "middle" }: { x: number; y: number; children: string; color?: string; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} fill={color} fontSize="14" textAnchor={anchor}>
      {children}
    </text>
  );
}

function Markers() {
  return (
    <defs>
      {[
        ["amber", AMBER],
        ["near", NEARC],
        ["green", GREEN],
      ].map(([id, c]) => (
        <marker key={id} id={`d-arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={c} />
        </marker>
      ))}
    </defs>
  );
}

const line = (color: string, id: string, dashed = false) => ({ fill: "none", stroke: color, strokeWidth: 1.7, markerEnd: `url(#d-arrow-${id})`, strokeDasharray: dashed ? "6 4" : undefined });

export function EconomyFlow() {
  return (
    <figure className="d-figure">
      <div className="d-diagram-scroll">
        <svg viewBox="0 0 960 660" role="img" aria-labelledby="eco-title eco-desc" fontFamily="var(--body)">
          <title id="eco-title">Where PETRI and NEAR go</title>
          <desc id="eco-desc">
            PETRI: the agar sells PETRI for NEAR, feeds a share of itself to living colonies every generation (two percent of it to the keeper pot, paid to a caller of advance outside the house), and takes back half of every planting and every sale; the other half of a planting and all of a slide are burned. A planting under a slide&apos;s licence by anyone but its holder also pays the holder a royalty, balance to balance. NEAR: attached NEAR goes to the vault after storage; sponsored credit, once spent, goes to the credit pool. Every tide pays five percent of each by what colonies earned since the last tide: vault shares become claimable NEAR for colonies that attached NEAR and credit for guests; the credit pool pays only credit. Sales back to the agar are paid from the vault.
          </desc>
          <Markers />
          <text x="30" y="28" fill={AMBER} fontSize="15" fontWeight="600">PETRI moves inside the dish</text>

          <Box x={30} y={80} w={190} h={96} title="The agar" lines={["the contract's reserve,", "all PETRI at launch"]} accent="rgba(242,180,90,0.6)" />
          <Box x={300} y={80} w={190} h={96} title="Earnings" lines={["fed each generation,", "unclaimed until used"]} />
          <Box x={560} y={80} w={190} h={96} title="Balances" lines={["NEP-141 PETRI held", "by each account"]} />
          <Box x={820} y={80} w={120} h={96} title="Burned" lines={["gone for good"]} />

          <path d="M220 124 H296" {...line(AMBER, "amber")} />
          <Label x={258} y={114}>feed</Label>
          <path d="M490 124 H556" {...line(AMBER, "amber")} />
          <Label x={523} y={114}>claim</Label>
          <path d="M750 124 H816" {...line(AMBER, "amber")} />
          <Label x={783} y={114}>½ plant</Label>
          <Label x={880} y={198}>and every slide</Label>

          <path d="M125 80 C 125 44, 655 44, 655 76" {...line(AMBER, "amber")} />
          <Label x={390} y={44} color="#f3e9da">bought for NEAR; dearer as the agar empties</Label>

          <path d="M615 176 C 615 226, 180 226, 180 180" {...line(AMBER, "amber")} />
          <Label x={398} y={240} color="#f3e9da">half of each planting, and PETRI sold back</Label>

          <Box x={300} y={262} w={190} h={64} title="Keeper pot" lines={["2% of every feed"]} />
          <path d="M80 176 V294 H296" {...line(AMBER, "amber")} />
          <path d="M490 294 H700 V180" {...line(AMBER, "amber")} />
          <Label x={595} y={285}>to whoever advances, never the house</Label>

          <line x1="30" y1="350" x2="940" y2="350" stroke="rgba(243,233,218,0.1)" />
          <text x="30" y="378" fill={NEARC} fontSize="15" fontWeight="600">NEAR moves in and out; credit stays in the dish</text>

          <Box x={30} y={410} w={170} h={80} title="Your wallet" lines={["NEAR you attach"]} />
          <Box x={30} y={530} w={170} h={78} title="A sponsor" lines={["the guests' relayer"]} />
          <Box x={320} y={410} w={190} h={86} title="The vault" lines={["attached NEAR, after", "each record's storage"]} accent="rgba(226,213,195,0.55)" />
          <Box x={320} y={530} w={190} h={78} title="Credit pool" lines={["credit, once spent"]} accent="rgba(159,216,168,0.55)" />
          <Box x={560} y={436} w={190} h={160} title="Each tide" lines={["every 240 generations,", "5% of each pool, split", "by what colonies earned", "since the last tide;", "the house gets none"]} />
          <Box x={800} y={410} w={140} h={86} title="Claimable" lines={["NEAR, for", "wallet colonies"]} />
          <Box x={800} y={530} w={140} h={78} title="Won credit" lines={["for guests"]} />

          <path d="M200 438 H316" {...line(NEARC, "near")} />
          <Label x={260} y={429}>join, buy, plant</Label>
          <path d="M320 472 H204" {...line(NEARC, "near")} />
          <Label x={260} y={492}>sell back</Label>
          <path d="M200 566 H316" {...line(GREEN, "green", true)} />
          <Label x={260} y={557} color={GREEN}>spent</Label>
          <path d="M510 453 C 535 453, 535 480, 556 480" {...line(NEARC, "near")} />
          <path d="M510 569 C 535 569, 535 548, 556 548" {...line(GREEN, "green", true)} />
          <path d="M750 480 C 775 480, 775 453, 796 453" {...line(NEARC, "near")} />
          <path d="M750 550 C 775 550, 775 569, 796 569" {...line(GREEN, "green", true)} />
          <path d="M870 410 V394 H115 V406" {...line(NEARC, "near")} />
          <Label x={640} y={388} color="#f3e9da">claim: to the colony&apos;s wallet or payout account</Label>
          <path d="M870 608 C 870 634, 415 634, 415 612" {...line(GREEN, "green", true)} />
          <Label x={642} y={652} color={GREEN}>spent on moves, back into the pool</Label>
        </svg>
      </div>
      <figcaption>
        Amber is PETRI, bone is NEAR, green dashes are credit. A tide also pays its caller a bounty (1% of the vault&rsquo;s share, at most 0.001 NEAR; none when a house colony or a keeper runs it, so it stays in the vault) and the storage of its own ledger entry before the split. A licensed planting by anyone but the slide&rsquo;s holder pays the holder 10% of its discounted price in PETRI, from balance to balance.
      </figcaption>
    </figure>
  );
}

export function ArchitectureFlow() {
  return (
    <figure className="d-figure">
      <div className="d-diagram-scroll">
        <svg viewBox="0 0 960 600" role="img" aria-labelledby="arch-title arch-desc" fontFamily="var(--body)">
          <title id="arch-title">How the parts of Petri connect</title>
          <desc id="arch-desc">
            The browser runs the site and petri-core compiled to WebAssembly. It reads both contracts over JSON-RPC. A wallet signs its own transactions; a guest signs a delegate action that the site's relay route submits on testnet. The guest route creates guest accounts and sponsors them. The intents routes ask 1Click for quotes; 1Click delivers wNEAR to the mainnet contract. The agents process on a VM plays the house strains and the keeper on both contracts, asks Claude or NEAR AI Cloud for each move, and serves a log the strains route passes through. scripts/verify.mjs replays either contract from the command line with the same engine.
          </desc>
          <Markers />
          <Box x={20} y={30} w={270} h={160} title="Browser" lines={["the site (Next.js 16)", "petri-core as WebAssembly", "a NEAR Connect wallet, or", "a guest key in the browser"]} note={{ text: "/dish  /verify  /specimens", color: AMBER }} />
          <Box x={345} y={30} w={270} h={160} title="Site server, on the VM" lines={["/api/guest, /api/relay", "/api/intents/*", "/api/strains?net=…", "the testnet relayer key"]} />
          <Box x={670} y={30} w={270} h={160} title="NEAR Intents (1Click)" lines={["quotes, deposit addresses;", "solvers swap into wNEAR"]} />

          <Box x={20} y={340} w={270} h={130} title="petri-v6.testnet" lines={["free play: guests, relayer,", "sponsored credit, the bench"]} note={{ text: "code hash DabiJwsV…", color: DIM }} accent="rgba(159,216,168,0.6)" />
          <Box x={345} y={340} w={270} h={130} title="petri-dish.near" lines={["real NEAR: wallets, and", "wNEAR from wrap.near"]} note={{ text: "code hash DabiJwsV…", color: DIM }} accent="rgba(242,180,90,0.6)" />
          <Box x={670} y={310} w={270} h={170} title="Agents VM" lines={["agents/run.mjs, one per dish:", "keeper and five house strains;", "asks Claude Haiku, then", "NEAR AI Cloud (TEE-signed)"]} note={{ text: "log windows :8790 and :8791", color: AMBER }} />

          <Box x={20} y={520} w={595} h={58} title="scripts/verify.mjs" />
          <text x="196" y="555" fill={DIM} fontSize="14">replays either dish from the CLI with the same engine</text>

          <path d="M100 190 V336" {...line(NEARC, "near")} />
          <Label x={108} y={268} anchor="start">reads (JSON-RPC)</Label>
          <path d="M230 190 C 230 270, 450 260, 450 336" {...line(NEARC, "near")} />
          <Label x={360} y={238}>wallet transactions</Label>
          <path d="M290 100 H341" {...line(NEARC, "near")} />
          <Label x={316} y={90}>guests</Label>
          <path d="M420 190 C 420 260, 220 280, 220 336" {...line(GREEN, "green", true)} />
          <Label x={232} y={318} anchor="start" color={GREEN}>relayed meta transactions</Label>
          <path d="M615 100 H666" {...line(NEARC, "near")} />
          <Label x={641} y={90}>quotes</Label>
          <path d="M760 190 C 760 270, 560 270, 560 336" {...line(AMBER, "amber")} />
          <Label x={640} y={258} anchor="start" color={AMBER}>wNEAR ft_transfer_call</Label>
          <path d="M670 400 H619" {...line(NEARC, "near")} />
          <path d="M700 480 C 660 520, 320 500, 290 474" {...line(NEARC, "near")} />
          <Label x={480} y={506}>strains and keeper sign their own moves</Label>
          <path d="M880 310 C 880 250, 600 250, 560 194" {...line(NEARC, "near", true)} />
          <Label x={884} y={290} anchor="start">log</Label>
        </svg>
      </div>
      <figcaption>Solid lines carry transactions or reads; the dashed green line is a guest&rsquo;s move, signed in the browser and paid for by the relayer.</figcaption>
    </figure>
  );
}

export function IntentsFlow() {
  const steps: [string, string, string][] = [
    ["Your token", "USDC, ETH, SOL", "or BTC, on its chain"],
    ["1Click", "a deposit address", "from the quote route"],
    ["Solvers", "swap it into", "wNEAR on NEAR"],
    ["wrap.near", "ft_transfer_call", "to the dish, with msg"],
    ["The dish", "unwraps, then joins", "or buys for msg.for"],
  ];
  return (
    <figure className="d-figure">
      <div className="d-diagram-scroll">
        <svg viewBox="0 0 960 160" role="img" aria-labelledby="int-title" fontFamily="var(--body)">
          <title id="int-title">The path of a payment through NEAR Intents: your token, a 1Click deposit address, solvers, wrap.near, and the dish.</title>
          <Markers />
          {steps.map(([t, a, b], i) => {
            const x = 10 + i * 190;
            return (
              <g key={t}>
                <Box x={x} y={25} w={164} h={104} title={t} lines={[a, b]} accent={i === 4 ? "rgba(242,180,90,0.6)" : undefined} />
                {i < steps.length - 1 && <path d={`M${x + 164} 77 H${x + 186}`} {...line(i >= 2 ? AMBER : NEARC, i >= 2 ? "amber" : "near")} />}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>If anything after the wNEAR arrives cannot be done, the NEAR waits as pending for the account the message named, which claims it with <code className="d-ic">claim_pending</code>.</figcaption>
    </figure>
  );
}

/** A small specimen of the dish: real patterns (a glider, a block, a beehive, a blinker, a loaf) in five stains. */
export function DishSketch() {
  const cell = 14;
  const put = (ox: number, oy: number, cells: [number, number][], color: string) =>
    cells.map(([x, y], i) => <rect key={`${ox}-${oy}-${i}`} x={(ox + x) * cell + 1.5} y={(oy + y) * cell + 1.5} width={cell - 3} height={cell - 3} rx={3} fill={color} />);
  return (
    <figure className="d-figure" aria-hidden="true">
      <svg viewBox="0 0 448 224" style={{ maxWidth: 520 }}>
        <rect width="448" height="224" rx="14" fill="#1a0e07" />
        <g opacity="0.07" stroke="#f3e9da">
          {Array.from({ length: 33 }, (_, i) => (
            <line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={224} />
          ))}
          {Array.from({ length: 17 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * cell} x2={448} y2={i * cell} />
          ))}
        </g>
        {put(3, 3, [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]], "#c8325a")}
        {put(10, 9, [[0, 0], [1, 0], [0, 1], [1, 1]], "#2364aa")}
        {put(17, 3, [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]], "#1e8c6e")}
        {put(24, 10, [[0, 0], [1, 0], [2, 0]], "#f2b45a")}
        {put(14, 11, [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [3, 2], [2, 3]], "#6b2fa0")}
      </svg>
    </figure>
  );
}
