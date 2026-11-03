// docs.playpetri.xyz serves the documentation from the same app: its paths map onto /docs/* (the root onto the
// introduction), while www.playpetri.xyz and every other host get the main site unchanged. Next 16 calls this file
// `proxy` (it was `middleware` before).

import { NextResponse, type NextRequest } from "next/server";

/** Hosts that serve the docs at their root. docs.localhost lets the rewrite be tried locally. */
const DOCS_HOSTS = new Set(["docs.playpetri.xyz", "docs.localhost"]);

export function proxy(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  if (!DOCS_HOSTS.has(host)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  // The docs host has no /docs prefix: send old or hand-typed /docs/... addresses to the clean one.
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    const where = pathname.slice("/docs".length).replace(/^\/introduction$/, "") || "/";
    return NextResponse.redirect(new URL(`${where}${search}`, `${proto}://${req.headers.get("host")}`), 308);
  }
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/docs/introduction" : `/docs${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: never Next's own files, the API routes or anything with a file extension (icons, the engine's wasm),
  // except the docs' plain-text map, /llms.txt.
  matcher: ["/((?!_next/|api/|.*\\..*).*)", "/llms.txt"],
};
