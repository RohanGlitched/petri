import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Ext, Formula, H2, Table } from "@/components/docs/ui";
import { SITE } from "@/components/docs/facts";

export const metadata = docMetadata("specimens");

export default function Page() {
  return (
    <DocPage
      slug="specimens"
      source={[
        { label: "contract/src/slides.rs", path: "contract/src/slides.rs" },
        { label: "core/src/lib.rs (region_bitmap, slide_svg, fits_slide)", path: "core/src/lib.rs" },
        { label: "contract/src/lib.rs (plant)", path: "contract/src/lib.rs" },
      ]}
    >
      <H2 id="what">What a slide is</H2>
      <p>
        A specimen slide fixes a rectangle of one colony&rsquo;s living cells at one generation, the way a lab fixes a sample on glass. It is a NEP-171 token owned by the minter&rsquo;s account. Its picture is an SVG the contract draws from the captured cells every time a wallet asks for the token, so the image cannot go missing or be swapped: it is a function of what the ledger recorded.
      </p>
      <p>
        A slide that captured at least 12 cells (<C>licence_min_cells</C>) is also a <strong>pattern licence</strong>; a smaller one is a keepsake. Anyone may plant a licensed slide&rsquo;s exact pattern again, moved anywhere on the dish, under the slide&rsquo;s licence: the planting costs 25% less (<C>slide_discount_bps</C>), and a planter that does not hold the slide pays its holder 10% of that discounted cost in PETRI (<C>slide_royalty_bps</C>), or the agar, if the planter has never attached NEAR. A pattern that proved itself is cheaper to plant, and whoever holds the slide earns from every planting of it. See <a href="#replant">The licence</a>. The cells the slide shows may be long dead; the slide keeps them. Browse them in the <Ext href={`${SITE}/specimens`}>specimens gallery</Ext>.
      </p>
      <Callout kind="note">
        <p>
          Both dishes started again from generation 0 on 4 November 2026 (v6.1), so neither had minted a slide when it started (<C>state().slides</C> is <C>&quot;0&quot;</C> at the start). The house strains are set to fossilize their densest 16 × 16 patch every 6 hours on testnet and every 12 on mainnet, once they hold at least 12 cells there and can keep enough PETRI to go on planting.
        </p>
      </Callout>

      <H2 id="minting">Minting rules</H2>
      <p>
        <C>mint_slide(x, y, w, h, title, credit)</C>, called by a colony&rsquo;s account (<Doc to="contract-api" hash="m-mint_slide">full reference</Doc>):
      </p>
      <ul>
        <li>The rectangle is <C>w × h</C> cells, each side 4 to 32, with its top-left corner at (x, y) on the dish. It wraps at the edges.</li>
        <li>The dish is caught up first; the slide captures the stored board at that generation.</li>
        <li>
          Only the minting colony&rsquo;s own living cells are captured. Cells of other colonies inside the rectangle, and empty cells, are 0 in the bitmap. Nobody can mint a slide of someone else&rsquo;s cells (<C>nobody_can_mint_a_rivals_cells</C>).
        </li>
        <li>It must capture at least 5 cells, or it fails with <C>a slide needs at least 5 of your living cells; that rectangle holds n</C>.</li>
        <li>The title is optional, at most 40 characters and 160 bytes, with no hidden characters.</li>
      </ul>

      <H2 id="cost">Cost and storage</H2>
      <Table>
        <thead>
          <tr>
            <th></th>
            <th>Amount</th>
            <th>Where it goes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>PETRI</th>
            <td>1 PETRI per captured cell (<C>slide_cells_price</C>); unclaimed earnings count</td>
            <td>All burned, counted in <C>state().burned</C> and <C>state().slides_burned</C></td>
          </tr>
          <tr>
            <th>NEAR</th>
            <td>
              The slide&rsquo;s storage plus 184 bytes reserved for later owners; quoted by <C>slide_deposit(w, h, title_bytes)</C>, 0.00693 NEAR for 16 × 16 untitled
            </td>
            <td>Pays the storage. Credit is used first (up to what the storage needs), then attached NEAR; attached NEAR left over is sent back</td>
          </tr>
        </tbody>
      </Table>
      <p>
        The reserve covers what later owners can add: an owner account up to 64 characters and a new entry in the owners&rsquo; index, so no chain of transfers can make the contract store more than the minter paid for (<C>transfers_never_outgrow_the_storage_a_slide_paid_for</C>). Approvals are paid for by the owner who grants them and refunded when they go.
      </p>

      <H2 id="svg">The image, drawn on chain</H2>
      <p>
        <C>petri_core::slide_svg(bitmap, w, h, color, generation)</C> draws the slide. The contract calls it inside <C>nft_token</C> and <C>nft_tokens</C>; the browser&rsquo;s engine exposes the same function, so the gallery draws exactly what wallets receive.
      </p>
      <Formula>{`side   = ⌈√(w² + h²)⌉ + 2                    the disc holds the whole rectangle with a cell to spare
canvas = side × side; a #0b0705 square, a #24130a agar disc of radius side/2 − 0.4
cells  = each set bit a zero-length path segment at its cell centre, stroked twice in the colony's colour
         (0.9 wide with round caps, 0.72 wide with square caps): a small rounded square
label  = "gen <generation>" in the corner`}</Formula>
      <p>
        A 32 × 32 slide stays under 6 KB for any pattern Life can hold (<C>a_slide_image_is_small_and_draws_every_cell</C>). The token&rsquo;s <C>media</C> is the SVG as a base64 data URI and <C>media_hash</C> its SHA-256, so a wallet can check the image it shows.
      </p>
      <p>
        The bitmap is row by row from the rectangle&rsquo;s top left: bit <C>i</C> is byte <C>i ÷ 8</C>, mask <C>1 &lt;&lt; (i mod 8)</C>. A 16 × 16 slide is 32 bytes.
      </p>

      <H2 id="standards">NEP standards</H2>
      <Table>
        <thead>
          <tr>
            <th>Standard</th>
            <th>Methods</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>NEP-171 core</td>
            <td>
              <C>nft_transfer</C>, <C>nft_transfer_call</C>, <C>nft_resolve_transfer</C>, <C>nft_token</C>
            </td>
            <td>
              Events <C>nft_mint</C> and <C>nft_transfer</C>, version 1.2.0. Transfers need exactly 1 yoctoNEAR. A slide cannot be sent to its owner or to the dish.
            </td>
          </tr>
          <tr>
            <td>NEP-177 metadata</td>
            <td>
              <C>nft_metadata</C>, token metadata
            </td>
            <td>
              Contract: spec <C>nft-2.1.0</C>, name <C>Petri specimens</C>, symbol <C>SLIDE</C>, an SVG icon.
            </td>
          </tr>
          <tr>
            <td>NEP-178 approvals</td>
            <td>
              <C>nft_approve</C>, <C>nft_revoke</C>, <C>nft_revoke_all</C>, <C>nft_is_approved</C>
            </td>
            <td>At most 16 approvals a slide; each pays its own storage and is refunded on revoke or transfer.</td>
          </tr>
          <tr>
            <td>NEP-181 enumeration</td>
            <td>
              <C>nft_total_supply</C>, <C>nft_tokens</C>, <C>nft_supply_for_owner</C>, <C>nft_tokens_for_owner</C>
            </td>
            <td>At most 10 tokens a call, since each carries its image (<C>nft_enumeration_draws_at_most_ten_images_a_call</C>).</td>
          </tr>
        </tbody>
      </Table>
      <p>Token metadata is built at view time:</p>
      <Code lang="json" title="nft_token(&quot;1&quot;).metadata, shape">{`{
  "title": "Specimen #1 · <colony name now>",
  "description": "“<title>”. <cells> living cells of <colony name>, fixed at generation <g> of the Petri dish: a <w> × <h> slide at (<x>, <y>).",
  "media": "data:image/svg+xml;base64,…",
  "media_hash": "<base64 sha256 of the SVG>",
  "copies": 1,
  "issued_at": "<minted_ms>",
  "extra": "{\\"colony\\":…,\\"generation\\":\\"…\\",\\"x\\":…,\\"y\\":…,\\"w\\":…,\\"h\\":…,\\"cells\\":…,\\"bitmap\\":\\"<base64>\\"}",
  "expires_at": null, "starts_at": null, "updated_at": null, "reference": null, "reference_hash": null
}`}</Code>
      <p>
        The colour is fixed at mint; the name is the colony&rsquo;s name when the token is read, so a <C>rename</C> shows up in the title. For the site, <C>slides</C> (up to 500 a call), <C>slide</C> and <C>slides_for</C> return the same data without the image, plus the licence&rsquo;s two counters: <C>moves</C>, how many times the slide has changed hands (every transfer and every return of a <C>nft_transfer_call</C> counts), and <C>royalties</C>, the PETRI its holders have been paid. <C>slide_royalties(token_id)</C> returns the royalties alone.
      </p>

      <H2 id="proof">Replay proof</H2>
      <p>
        Every mint writes a <C>Slide</C> entry with the rectangle, the cell count, the bitmap and the PETRI burned. Both replays (<C>/verify</C> in the browser and <C>scripts/verify.mjs</C>) recompute <C>region_bitmap</C> for that colony and rectangle on their own replayed board at that generation and require:
      </p>
      <ul>
        <li>the sides are 4 to 32;</li>
        <li>token ids run 1, 2, 3, … in ledger order;</li>
        <li>the bitmap is byte for byte the colony&rsquo;s cells as the dish stood;</li>
        <li>the cell count matches the set bits and is at least 5;</li>
        <li>the cost is exactly 1 PETRI per cell, and it is counted as burned.</li>
      </ul>
      <p>
        The verifier prints this as <C>Specimens n of n match the dish</C>. A slide that was minted from anything but the real board, or priced wrong, makes it differ.
      </p>
      <p>
        Plantings under a licence are checked too, in the row <C>Licensed plantings: shape, holder, royalty</C>: each one&rsquo;s slide must have captured at least 12 cells, and its cells must be exactly the slide&rsquo;s pattern moved but not turned (petri-core&rsquo;s <C>fits_slide</C>, the same function the contract calls), its price the discounted one and its royalty exactly 10% of it (the engine&rsquo;s <C>licence</C>), and the holder it paid, or the agar for a planter that had never attached NEAR, the minter until the slide&rsquo;s first move and one and the same account between two moves. At the end, each slide&rsquo;s owner, moves and royalties must match the <C>slides</C> view (row <C>Slide holders and royalties</C>).
      </p>

      <H2 id="replant">The licence: replanting a slide</H2>
      <p>
        <C>plant(cells, note, credit, slide)</C> with <C>slide</C> set to a token id plants under that slide&rsquo;s licence (<Doc to="contract-api" hash="m-plant">full reference</Doc>):
      </p>
      <ul>
        <li>
          <strong>Big enough.</strong> The slide must have captured at least <C>licence_min_cells</C> (12) cells. A smaller slide can still be minted (at least <C>slide_min_cells</C>, 5), as a keepsake, but a planting under it is refused with <C>slide N captured C cells; only a slide of at least 12 cells is a licence</C> (<C>a_small_slide_is_a_keepsake_not_a_licence</C>). Blocks, blinkers, beehives, loaves, gliders, lightweight spaceships and small oscillators can no longer be licensed.
        </li>
        <li>
          <strong>Moved, not turned.</strong> The cells must be exactly the slide&rsquo;s pattern, every set bit once and nothing else, shifted to any place on the dish (wrapping at its edges). A turned, flipped or partial copy is refused with <C>those cells are not the slide&rsquo;s pattern: plant exactly its cells, moved anywhere but not turned</C> (<C>a_turned_slide_is_not_licensed</C>, <C>a_planting_of_another_shape_is_not_licensed</C>; core <C>a_slide_licence_is_the_same_shape_anywhere</C>). Every other planting rule still applies: empty cells, at most 64 cells, one planting a generation.
        </li>
        <li>
          <strong>The discount.</strong> The planting costs <C>slide_discount_bps</C> (2500, 25%) less than the same cells would: <C>quote(cells, siege, licensed: true)</C> gives the price. Half is burned and half goes back to the agar, as with any planting. The discount is the same for everyone, the holder included (<C>the_holder_plants_its_slide_at_the_licence_discount</C>).
        </li>
        <li>
          <strong>The royalty.</strong> A planter that does not hold the slide also pays its holder <C>slide_royalty_bps</C> (1000, 10%) of that discounted cost, in PETRI, from balance to balance: a transfer, not a burn (<C>a_stranger_plants_a_slide_and_pays_its_holder_a_royalty</C>). After a transfer the royalties go to the new holder (<C>after_a_transfer_royalties_go_to_the_new_holder</C>). A holder with no PETRI registration is registered by the planting, at the planter&rsquo;s expense (the 125 bytes of a balance record). A royalty paid to a holder that has never attached NEAR is kept PETRI (it must be planted before it can be sold). A planter that has never attached NEAR before the planting pays the royalty to the agar instead (counted in <C>returned</C>); the holder and the slide&rsquo;s <C>royalties</C> get nothing (<C>a_guest_pays_its_royalty_to_the_agar</C>).
        </li>
        <li>
          <strong>Sieges are not waived.</strong> A licensed planting inside a rival&rsquo;s buffer still costs 3 times as much, then 25% less: a licence never makes a rival&rsquo;s ground cheap to take.
        </li>
        <li>
          <strong>The house</strong> plants only slides it holds, so its PETRI never goes to a player as a royalty (<C>the_house_pays_no_royalty_to_players</C>).
        </li>
      </ul>
      <Formula>{`cost    = planting_cost(cells, siege) − planting_cost(cells, siege) × 2500 / 10000
royalty = cost × 1000 / 10000     (0 when the planter holds the slide)
burned  = cost × 5000 / 10000;  back to the agar = cost − burned;  royalty to the holder, or to the agar if the planter never attached NEAR`}</Formula>
      <p>
        <C>plant_deposit(cells, note_bytes, slide)</C> quotes the NEAR to bring: the planting&rsquo;s storage and cell fee as always, plus the licence&rsquo;s bytes in the ledger entry and, if the holder has no PETRI registration yet, the holder&rsquo;s registration. The <C>Plant</C> entry carries a <C>licence</C> with the token, the slide&rsquo;s <C>moves</C> at that moment, the <C>holder</C> paid (none when the planter held it), the <C>royalty</C> and <C>to_agar</C> (true when the royalty went to the agar); the <C>plants</C> view shows the slide&rsquo;s id. Moves themselves are not logged, because a transfer carries exactly one yoctoNEAR and could not pay for a ledger entry; the move count in each licence is what lets both replays tell holders apart.
      </p>
      <p>
        On the site, <strong>Plant this pattern</strong> on a specimen&rsquo;s page, or <C>/dish?replant=&lt;token id&gt;</C>, loads the slide&rsquo;s cells into the dish page&rsquo;s stamp. Planted as they are, moved but not turned or flipped, they are planted under the licence and the page shows the royalty it will pay; turned or flipped, they are an ordinary planting with no discount and no royalty. A slide that captured fewer than 12 cells has no licence: the page says so, and its cells load as an ordinary planting. A slide of more than 64 cells cannot be replanted in one planting. The house strains fossilize slides but do not plant under licences.
      </p>
    </DocPage>
  );
}
