"use client";

import { useEffect, useState } from "react";
import { useLive, int, near } from "@/lib/live";
import { fmtPetri } from "@/lib/config";
import { getPlantDeposit } from "@/lib/chain";
import { LAUNCH } from "./shared";
import s from "./rules.module.css";

/** The buffer around a rival block: no planted cell may sit inside the hatched square. */
function BufferFigure({ buffer }: { buffer: number }) {
  const W = 17;
  const H = 11;
  const c = 20;
  const rival = [
    [6, 4],
    [7, 4],
    [6, 5],
    [7, 5],
  ];
  const zone = { x0: 6 - buffer, y0: 4 - buffer, x1: 7 + buffer, y1: 5 + buffer };
  const refused = [8 + Math.max(0, buffer - 2), 2];
  const allowed = [8 + buffer, 7];
  return (
    <svg className={s.bufferSvg} viewBox={`0 0 ${W * c} ${H * c}`} role="img" aria-label={`A rival block with the ${buffer}-cell zone around it where no one else may plant. One planted cell inside the zone is refused; one just outside is accepted.`}>
      <defs>
        <pattern id="rules-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="rgba(30,140,110,0.08)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(120,210,180,0.35)" strokeWidth="2" />
        </pattern>
        <radialGradient id="rules-green" cx="34%" cy="30%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.3" stopColor="#1e8c6e" />
          <stop offset="1" stopColor="#1e8c6e" stopOpacity="0.75" />
        </radialGradient>
        <radialGradient id="rules-red" cx="34%" cy="30%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="0.3" stopColor="#c8431f" />
          <stop offset="1" stopColor="#c8431f" stopOpacity="0.75" />
        </radialGradient>
      </defs>
      {Array.from({ length: W * H }, (_, i) => (
        <rect key={i} x={(i % W) * c + 1} y={Math.floor(i / W) * c + 1} width={c - 2} height={c - 2} rx="4" className={s.bufTile} />
      ))}
      <rect
        x={zone.x0 * c}
        y={zone.y0 * c}
        width={(zone.x1 - zone.x0 + 1) * c}
        height={(zone.y1 - zone.y0 + 1) * c}
        fill="url(#rules-hatch)"
        className={s.bufZone}
        rx="6"
      />
      {rival.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x * c + c / 2} cy={y * c + c / 2} r={c * 0.4} fill="url(#rules-green)" />
      ))}
      <circle cx={refused[0] * c + c / 2} cy={refused[1] * c + c / 2} r={c * 0.36} className={s.bufRefused} />
      <path
        d={`M${refused[0] * c + 6} ${refused[1] * c + 6} L${refused[0] * c + c - 6} ${refused[1] * c + c - 6} M${refused[0] * c + c - 6} ${refused[1] * c + 6} L${refused[0] * c + 6} ${refused[1] * c + c - 6}`}
        className={s.bufCross}
      />
      <circle cx={allowed[0] * c + c / 2} cy={allowed[1] * c + c / 2} r={c * 0.4} fill="url(#rules-red)" />
    </svg>
  );
}

const REFUSALS: [string, string][] = [
  ["The lab note holds a control, direction or zero-width character.", "a lab note may not contain control, direction or zero-width characters"],
  ["The lab note is longer than 140 characters or 280 bytes.", "a lab note is at most 140 characters"],
  ["The account has not joined the dish yet.", "join the dish first"],
  [
    "The dish is still behind the clock after the planting caught up as far as one call may. Someone has to call advance first.",
    "the dish is behind the clock; call advance first",
  ],
  ["The colony already planted in this generation.", "one planting per generation; wait for the next one"],
  ["The planting lists no cells.", "plant at least one cell"],
  ["The planting lists more cells than the limit.", "at most 64 cells per planting"],
  ["A cell index is outside the dish.", "cell N is off the dish"],
  ["The same cell is listed twice.", "cell (x, y) is listed twice"],
  ["A target cell is already alive, whoever owns it.", "cell (x, y) is already alive"],
  ["Another colony has a live cell within the buffer of a target cell.", "cell (x, y) is inside colony N's buffer; plant further away or send a glider"],
  ["Less NEAR is attached than the fee for this many cells.", "planting N cells needs at least X NEAR attached"],
  ["The colony holds less PETRI than the price, counting the earnings the planting just claimed.", "planting N cells costs X PETRI; you hold Y"],
  ["What was attached does not cover the storage the planting used plus its fee.", "this planting needs X NEAR attached for its storage and fee"],
];

/** The contract's price arithmetic, step by step, in exact integers (petri-core `feed_per_cell` and `plant_price`). */
function priceSteps(agar: bigint, r: { feed_ppm: number; keeper_bps: number; live_floor: number; payback: number; min_cell_price: string }, live: number) {
  const feed = (agar * BigInt(r.feed_ppm)) / 1_000_000n;
  const toCells = feed - (feed * BigInt(r.keeper_bps)) / 10000n;
  const counted = Math.max(live, r.live_floor, 1);
  const perCell = toCells / BigInt(counted);
  const raw = perCell * BigInt(r.payback);
  const floor = BigInt(r.min_cell_price);
  const price = raw > floor ? raw : floor;
  return { feed, toCells, counted, perCell, raw, floor, price, floored: raw <= floor };
}

const DEPOSITS: { label: string; cells: number; note: number | null }[] = [
  { label: "A block, no note", cells: 4, note: null },
  { label: "A beehive, no note", cells: 6, note: null },
  { label: "A beehive with a 60-byte note", cells: 6, note: 60 },
  { label: "A glider gun, no note", cells: 36, note: null },
  { label: "64 cells with a full 280-byte note", cells: 64, note: 280 },
];

function useDeposits(ready: boolean) {
  const [out, setOut] = useState<(string | null)[]>(DEPOSITS.map(() => null));
  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.all(DEPOSITS.map((x) => getPlantDeposit(x.cells, x.note).catch(() => null))).then((v) => {
      if (live) setOut(v);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  return out;
}

export function PlantingSection() {
  const { d, rules, ready, cellPrice } = useLive();
  const r = rules ?? LAUNCH;
  const live = ready ? d.totalLive : 0;
  const agar = ready ? BigInt(Math.round(d.agar)) : BigInt(r.max_supply);
  const now = priceSteps(agar, r, live);
  const hive = now.price * 6n;
  const burn = (hive * BigInt(r.burn_bps)) / 10000n;
  const back = hive - burn;
  const ladder = [0, 500, 1000, 2000, 4000, 8000, 16000];
  const half = agar / 2n;
  const burnPct = r.burn_bps / 100;
  const keeperPct = r.keeper_bps / 100;
  const deposits = useDeposits(ready);
  const matches = ready && BigInt(Math.round(cellPrice)) === now.price;
  return (
    <section id="planting" className={`band ${s.section}`} aria-labelledby="planting-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="planting-title" className={s.h2}>Planting new life</h2>
          <p className="lede">
            A colony grows by planting: naming up to {r.max_plant_cells} empty cells and paying for them in PETRI, with a little
            NEAR attached for storage. Any shape is allowed. The site&rsquo;s stamps, from a block to a glider gun, are only a
            convenience; the contract sees a list of cells.
          </p>
        </div>

        <div className={s.split}>
          <ul className={s.limits}>
            <li className={s.limit}>
              <h3 className="h3">Up to {r.max_plant_cells} cells</h3>
              <p>One planting brings at most {r.max_plant_cells} cells to life. A glider gun is 36 of them.</p>
            </li>
            <li className={s.limit}>
              <h3 className="h3">Once a generation</h3>
              <p>Each colony plants at most once per generation, so at most once every {Number(r.generation_ms) / 1000} seconds.</p>
            </li>
            <li className={s.limit}>
              <h3 className="h3">Empty cells only</h3>
              <p>Every target cell must be dead. You cannot plant over anyone&rsquo;s cells, including your own.</p>
            </li>
            <li className={s.limit}>
              <h3 className="h3">{r.buffer} cells from any rival</h3>
              <p>
                No other colony may have a live cell within {r.buffer} cells of a planted cell, counting diagonals and across the
                wrapped edges. Your own cells do not count, so you can build right next to yourself.
              </p>
            </li>
            <li className={s.limit}>
              <h3 className="h3">A lab note, if you like</h3>
              <p>
                A planting can carry a note of up to 140 characters and 280 bytes. It is stored on chain with the planting and
                shown in the dish&rsquo;s log. Notes, like colony names, may not contain control, direction or zero-width
                characters, so nothing can hide in them. The AI strains use the note to say why they planted.
              </p>
            </li>
          </ul>
          <figure className={`${s.figure} ${s.bufferFig}`}>
            <BufferFigure buffer={r.buffer} />
            <figcaption className={s.caption}>
              <p>
                Green&rsquo;s block and the {r.buffer}-cell buffer around it. Red&rsquo;s planting inside the hatched square is
                refused; the one just outside is accepted. The buffer is checked only when planting. To reach Green, Red has to
                send something that travels, such as a glider.
              </p>
            </figcaption>
          </figure>
        </div>

        <div className={s.priceGrid}>
          <div className={s.card}>
            <h3 className="h3">A cell costs what a cell earns in {int(r.payback)} generations</h3>
            <pre className={s.formula}>
              {`feed per cell = agar × ${r.feed_ppm} ÷ 1,000,000 × (1 − ${keeperPct}%) ÷ max(live cells, ${int(r.live_floor)})
price of a cell = max(feed per cell × ${int(r.payback)}, ${fmtPetri(r.min_cell_price)} PETRI)
cost = price of a cell × cells`}
            </pre>
            <p>
              The price follows the feed. An average cell, left alone, earns back what it cost in {int(r.payback)} generations,
              about {Math.round((r.payback * Number(r.generation_ms)) / 3_600_000)} hours. The price counts at least{" "}
              {int(r.live_floor)} living cells, so a nearly empty dish is not almost free, and it never falls below{" "}
              {fmtPetri(r.min_cell_price)} PETRI a cell. It falls as the agar shrinks and as the dish fills past{" "}
              {int(r.live_floor)} cells, because each cell&rsquo;s share of the feed falls with it. The contract computes it after
              the planting&rsquo;s own catch-up, in whole millionths of a PETRI, rounding down at every step.
            </p>
            <p>
              Of every cost, {burnPct}% is burned and the other {100 - burnPct}% goes back into the agar, to be fed out again.
              Planting first claims the colony&rsquo;s waiting earnings, so they count towards the price.
            </p>
            <div className={s.example}>
              <h4 className={s.h4}>A beehive, right now</h4>
              <dl className={s.workings}>
                <div>
                  <dt>Agar at your browser&rsquo;s generation</dt>
                  <dd className="num">{ready ? `${fmtPetri(agar, 6)} PETRI` : "—"}</dd>
                </div>
                <div>
                  <dt>This generation&rsquo;s feed, {r.feed_ppm} ppm of it</dt>
                  <dd className="num">{ready ? fmtPetri(now.feed, 6) : "—"}</dd>
                </div>
                <div>
                  <dt>Less the keeper&rsquo;s {keeperPct}%</dt>
                  <dd className="num">{ready ? fmtPetri(now.toCells, 6) : "—"}</dd>
                </div>
                <div>
                  <dt>
                    Divided by {ready ? int(now.counted) : "—"}
                    {ready && live < r.live_floor ? ` (${int(live)} alive, the price counts ${int(r.live_floor)})` : " living cells"}
                  </dt>
                  <dd className="num">{ready ? fmtPetri(now.perCell, 6) : "—"}</dd>
                </div>
                <div>
                  <dt>
                    Times {int(r.payback)}
                    {ready && now.floored ? `, below the floor, so ${fmtPetri(r.min_cell_price)}` : ""}
                  </dt>
                  <dd className="num">{ready ? `${fmtPetri(now.price, 6)} a cell` : "—"}</dd>
                </div>
                <div className={s.workTotal}>
                  <dt>Six cells</dt>
                  <dd className="num">{ready ? `${fmtPetri(hive, 6)} PETRI` : "—"}</dd>
                </div>
              </dl>
              <p className="num">
                Burned: <b>{ready ? fmtPetri(burn, 6) : "—"}</b>. Back to the agar: <b>{ready ? fmtPetri(back, 6) : "—"}</b>.
              </p>
              <p className={s.note}>
                Using the {ready ? int(live) : "—"} live cells your browser counts at generation {ready ? int(d.generation) : "—"}.{" "}
                {ready ? (matches ? "The engine's own quote for one cell agrees to the unit." : "The engine's own quote for one cell is " + fmtPetri(cellPrice, 6) + " PETRI.") : ""}
              </p>
            </div>
          </div>
          <div className={s.card}>
            <h3 className="h3">One cell, at different crowding</h3>
            <p>With the agar as it is now, and with half of it gone.</p>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Live cells</th>
                    <th scope="col">Today&rsquo;s agar</th>
                    <th scope="col">Half the agar</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map((l) => (
                    <tr key={l}>
                      <td className="num">{int(l)}</td>
                      <td className="num">{fmtPetri(priceSteps(agar, r, l).price, 3)}</td>
                      <td className="num">{fmtPetri(priceSteps(half, r, l).price, 3)}</td>
                    </tr>
                  ))}
                  <tr className={s.nowRow}>
                    <td className="num">{ready ? `${int(live)}, now` : "Now"}</td>
                    <td className="num">{ready ? fmtPetri(now.price, 3) : "—"}</td>
                    <td className="num">{ready ? fmtPetri(priceSteps(half, r, live).price, 3) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={s.note}>
              PETRI per cell. Below {int(r.live_floor)} live cells the price does not move; far above it the floor of{" "}
              {fmtPetri(r.min_cell_price)} PETRI takes over.
            </p>
          </div>
        </div>

        <div className={s.depositGrid}>
          <div className={s.prose}>
            <h3 className="h3">The NEAR a planting carries</h3>
            <p>
              Storage on NEAR is paid in NEAR, and in Petri the player pays for what their planting stores: the ledger entry, its
              cells and its note. On top of that, every planted cell carries a fee of{" "}
              <b className="num">{near(Number(r.cell_fee), 4)} NEAR</b>. The contract measures the storage the planting actually
              used and keeps it; everything attached above that goes to the tide vault, which pays it back out to colonies by
              territory every {r.tide_every} generations.
            </p>
            <pre className={s.formula}>
              {`deposit = (260 + 6 × cells + (note bytes + 64, if there is a note)) bytes of storage
        + ${near(Number(r.cell_fee), 4)} NEAR × cells`}
            </pre>
            <p>
              The <code className={s.code}>plant_deposit(cells, note_bytes)</code> view returns that sum, and the site attaches it
              for you. A planting that attaches less than its fee, or less than its storage and fee together, is refused.
            </p>
          </div>
          <div className={s.card}>
            <h3 className="h3">What plant_deposit returns now</h3>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Planting</th>
                    <th scope="col">Attach</th>
                    <th scope="col">Of which fee</th>
                  </tr>
                </thead>
                <tbody>
                  {DEPOSITS.map((x, i) => (
                    <tr key={x.label}>
                      <th scope="row">{x.label}</th>
                      <td className="num">{deposits[i] ? `${near(Number(deposits[i]), 5)} NEAR` : "—"}</td>
                      <td className="num">{near(Number(r.cell_fee) * x.cells, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.note}>Read from the contract when this page loaded.</p>
          </div>
        </div>

        <div className={s.refuseBlock}>
          <h3 className="h3">What the contract refuses</h3>
          <p className="muted">
            A refused planting changes nothing and costs nothing but gas; the NEAR attached comes back. The contract checks in
            this order and stops at the first problem, with the message shown.
          </p>
          <dl className={s.refusals}>
            {REFUSALS.map(([plain, msg]) => (
              <div key={msg} className={s.refusal}>
                <dt>{plain}</dt>
                <dd>
                  <code className={s.code}>{msg}</code>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
