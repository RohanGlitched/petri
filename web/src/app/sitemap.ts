// /sitemap.xml: the main site's pages (the docs live on docs.playpetri.xyz, mapped by its /llms.txt).

import type { MetadataRoute } from "next";
import { SITE } from "@/components/docs/facts";

const PAGES = ["/", "/dish", "/rules", "/strains", "/strains/new", "/strains/join", "/strains/break", "/specimens", "/judges", "/verify", "/colonies", "/records", "/coin", "/break", "/sim"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${SITE}${p === "/" ? "" : p}`, changeFrequency: p === "/" || p === "/dish" ? "hourly" : "daily", priority: p === "/" ? 1 : p === "/dish" || p === "/judges" ? 0.9 : 0.6 }));
}
