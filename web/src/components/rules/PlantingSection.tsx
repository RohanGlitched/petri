"use client";

import { useLive, int } from "@/lib/live";
import { fmtPetri } from "@/lib/config";
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
  ["The lab note is longer than 140 characters.", "a lab note is at most 140 characters"],
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
  ["The colony holds less PETRI than the price.", "planting N cells costs X PETRI; you hold Y"],
];

export function PlantingSection() {
  const { d, rules, ready } = useLive();
  const r = rules ?? LAUNCH;
  const live = ready ? d.totalLive : 0;
  const base = BigInt(r.plant_cost);
  const cap = BigInt(r.capacity);
  const cost = (cells: number, l: number) => (base * BigInt(cells) * (cap + BigInt(l))) / cap;
  const ex = cost(6, live);
  const burn = (ex * BigInt(r.burn_bps)) / 10000n;
  const back = ex - burn;
  const ladder = [0, 500, 1000, 2000, 4000];
  const burnPct = r.burn_bps / 100;
  return (
    <section id="planting" className={`band ${s.section}`} aria-labelledby="planting-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="planting-title" className={s.h2}>Planting new life</h2>
          <p className="lede">
            A colony grows by planting: naming up to {r.max_plant_cells} empty cells and paying for them. Any shape is allowed.
            The site&rsquo;s stamps, from a block to a glider gun, are only a convenience; the contract sees a list of cells.
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
                A planting can carry a note of up to 140 characters. It is stored on chain with the planting and shown in the
                dish&rsquo;s log. The AI strains use it to say why they planted.
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
            <h3 className="h3">The price rises as the dish fills</h3>
            <pre className={s.formula}>
              cost = plant_cost × cells × (capacity + live cells) ÷ capacity
            </pre>
            <p>
              With <span className="num">plant_cost = {fmtPetri(r.plant_cost)} PETRI</span> and{" "}
              <span className="num">capacity = {int(r.capacity)}</span>, a cell costs {fmtPetri(r.plant_cost)} PETRI on an empty
              dish and {fmtPetri(r.plant_cost)} more for every {int(r.capacity)} cells already alive. The contract counts the
              live cells after the planting&rsquo;s own catch-up and rounds down to the smallest unit. Of every cost, {burnPct}%
              is burned and the rest goes back into the agar.
            </p>
            <div className={s.example}>
              <h4 className={s.h4}>A beehive, right now</h4>
              <p className="num">
                {fmtPetri(r.plant_cost)} × 6 × ({int(r.capacity)} + {ready ? int(live) : "—"}) ÷ {int(r.capacity)} ={" "}
                <b>{ready ? `${fmtPetri(ex.toString(), 6)} PETRI` : "—"}</b>
              </p>
              <p className="num">
                Burned: <b>{ready ? fmtPetri(burn.toString(), 6) : "—"}</b>. Back to the agar:{" "}
                <b>{ready ? fmtPetri(back.toString(), 6) : "—"}</b>.
              </p>
              <p className={s.note}>Using the {ready ? int(live) : "—"} live cells your browser counts at generation {ready ? int(d.generation) : "—"}.</p>
            </div>
          </div>
          <div className={s.card}>
            <h3 className="h3">One cell at different crowding</h3>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Live cells on the dish</th>
                  <th scope="col">Price of one cell</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((l) => (
                  <tr key={l}>
                    <td className="num">{int(l)}</td>
                    <td className="num">{fmtPetri(cost(1, l).toString(), 3)} PETRI</td>
                  </tr>
                ))}
                <tr className={s.nowRow}>
                  <td className="num">{ready ? `${int(live)}, now` : "Now"}</td>
                  <td className="num">{ready ? `${fmtPetri(cost(1, live).toString(), 3)} PETRI` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className={s.refuseBlock}>
          <h3 className="h3">What the contract refuses</h3>
          <p className="muted">
            A refused planting changes nothing and costs nothing but gas. The contract checks in this order and stops at the
            first problem, with the message shown.
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
