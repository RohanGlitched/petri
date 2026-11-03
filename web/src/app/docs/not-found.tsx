import Link from "next/link";
import { PAGES, docHref } from "@/components/docs/nav";

export default function DocsNotFound() {
  return (
    <main id="doc" className="d-main">
      <article className="d-article">
        <header className="d-head">
          <p className="d-crumb">Not found</p>
          <h1>There is no page here</h1>
          <p className="d-lede">The address may be from an older version of the docs. Every page is listed below and in the sidebar, and the search (Ctrl K) finds sections and methods.</p>
        </header>
        <div className="d-body">
          <ul>
            {PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={docHref(p.slug)}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      </article>
    </main>
  );
}
