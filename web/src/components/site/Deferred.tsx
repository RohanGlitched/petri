"use client";
// A band that renders only once it is within a screen or so of the viewport. Until then a placeholder of about its
// height holds its place (with the same id and section name, so the page's section list and #links still work), and
// none of its reads or scripts run while the reader is still at the top of the page.

import { useEffect, useRef, useState } from "react";

export function Deferred({ id, section, minHeight, children }: { id: string; section: string; minHeight: number; children: React.ReactNode }) {
  const [near, setNear] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A link straight to this band (#id) renders it at once.
    if (window.location.hash === `#${id}`) return setNear(true);
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setNear(true), io.disconnect()), { rootMargin: "120% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  if (near) return <>{children}</>;
  return <div ref={box} id={id} data-section={section} style={{ minHeight }} aria-busy="true" />;
}
