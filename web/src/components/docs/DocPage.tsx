import type { Metadata } from "next";
import Link from "next/link";
import { BUILD_COMMIT, BUILD_COMMIT_SHORT, DOCS, REPO, blob } from "./facts";
import { docHref, neighbours, pageOf } from "./nav";
import { Toc } from "./Toc";

/** Metadata for a docs page: its title, description and canonical address on docs.playpetri.xyz. */
export function docMetadata(slug: string): Metadata {
  const p = pageOf(slug);
  if (!p) return {};
  const url = slug === "introduction" ? `${DOCS}/` : `${DOCS}/${slug}`;
  return {
    title: slug === "introduction" ? { absolute: "Petri docs" } : p.title,
    description: p.description,
    alternates: { canonical: url },
    openGraph: { title: `${p.title} · Petri docs`, description: p.description, url, type: "article" },
  };
}

export function DocPage({ slug, lede, children, source }: { slug: string; lede?: React.ReactNode; children: React.ReactNode; source?: { label: string; path: string }[] }) {
  const p = pageOf(slug);
  if (!p) throw new Error(`no docs page ${slug}`);
  const { prev, next } = neighbours(slug);
  return (
    <>
      <main id="doc" className="d-main" tabIndex={-1}>
        <article className="d-article">
          <header className="d-head">
            <p className="d-crumb">{p.group}</p>
            <h1>{p.title}</h1>
            <p className="d-lede">{lede ?? p.description}</p>
            {source && source.length > 0 && (
              <p className="d-source">
                Read from{" "}
                {source.map((s, i) => (
                  <span key={s.path}>
                    {i > 0 && (i === source.length - 1 ? " and " : ", ")}
                    <a href={blob(s.path)}>{s.label}</a>
                  </span>
                ))}
                .
              </p>
            )}
          </header>
          <div className="d-body">{children}</div>
          <nav className="d-pager" aria-label="Previous and next page">
            {prev ? (
              <Link href={docHref(prev.slug)} className="d-pager-prev">
                <small>Previous</small>
                <span>{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={docHref(next.slug)} className="d-pager-next">
                <small>Next</small>
                <span>{next.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
          <footer className="d-foot">
            <p>
              Petri is open source under the MIT licence. These pages describe the contract at commit <a href={`${REPO}/tree/${BUILD_COMMIT}`}>{BUILD_COMMIT_SHORT}</a>, the v6.1 build both dishes run. Where a page and the code disagree, the code is right; say so in an <a href="https://github.com/RohanGlitched/petri/issues">issue</a>.
            </p>
          </footer>
        </article>
      </main>
      <aside className="d-aside">
        <Toc />
      </aside>
    </>
  );
}
