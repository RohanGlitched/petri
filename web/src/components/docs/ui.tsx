import Link from "next/link";
import { docHref } from "./nav";

/** A section heading with a link to itself. */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="d-h2">
      <a href={`#${id}`} className="d-anchor" aria-hidden="true" tabIndex={-1}>
        #
      </a>
      {children}
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="d-h3">
      <a href={`#${id}`} className="d-anchor" aria-hidden="true" tabIndex={-1}>
        #
      </a>
      {children}
    </h3>
  );
}

const CALLOUT_LABEL = { note: "Note", warn: "Not yet", check: "Check it yourself", money: "Real NEAR" } as const;

/** A short aside. `warn` is for something that is not done or not true yet; `check` gives a command to confirm a claim. */
export function Callout({ kind = "note", title, children }: { kind?: keyof typeof CALLOUT_LABEL; title?: string; children: React.ReactNode }) {
  return (
    <aside className={`d-callout d-callout-${kind}`}>
      <p className="d-callout-title">{title ?? CALLOUT_LABEL[kind]}</p>
      <div>{children}</div>
    </aside>
  );
}

/** Tables scroll sideways on a phone instead of squeezing their columns. */
export function Table({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <div className="d-table" role="region" aria-label={caption ?? "Table"} tabIndex={0}>
      <table>
        {caption && <caption>{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

/** A link to another docs page (relative, so it works on both hosts). */
export function Doc({ to, hash, children }: { to: string; hash?: string; children: React.ReactNode }) {
  return <Link href={docHref(to, hash)}>{children}</Link>;
}

/** A link outside the docs. */
export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener">
      {children}
    </a>
  );
}

/** A formula, set apart and read as code. */
export function Formula({ children }: { children: string }) {
  return (
    <div className="d-formula" role="math" aria-label={children.replace(/\s+/g, " ")}>
      <pre>{children.replace(/^\n+|\s+$/g, "")}</pre>
    </div>
  );
}

/** Steps in a real sequence. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="d-steps">{children}</ol>;
}

/** A definition list laid out as label and text. */
export function Facts({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="d-facts">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
