"use client";

import { useEffect, useState } from "react";

type Item = { id: string; text: string; level: 2 | 3 };

/** "On this page", built from the article's own headings, with the section being read marked. */
export function Toc() {
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>("#doc h2[id], #doc h3[id]"));
    setItems(heads.map((h) => ({ id: h.id, text: (h.textContent ?? "").replace(/^#/, "").trim(), level: h.tagName === "H2" ? 2 : 3 })));
    if (heads.length === 0) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        // The first heading on screen, or failing that the last one above it.
        const visible = heads.find((h) => seen.get(h.id));
        if (visible) return setActive(visible.id);
        const above = heads.filter((h) => h.getBoundingClientRect().top < 0).pop();
        if (above) setActive(above.id);
      },
      { rootMargin: "-72px 0px -55% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, []);

  if (items.length === 0) return <div className="d-toc" />;
  return (
    <nav className="d-toc" aria-label="On this page">
      <p className="d-toc-title">On this page</p>
      <ul>
        {items.map((it) => (
          <li key={it.id} className={it.level === 3 ? "d-toc-sub" : undefined}>
            <a href={`#${it.id}`} aria-current={active === it.id ? "location" : undefined}>
              {it.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
