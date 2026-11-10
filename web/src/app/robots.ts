// /robots.txt on every host: everything may be crawled; the sitemap lists the main site's pages, and /llms.txt is the
// plain-text map for agents.

import type { MetadataRoute } from "next";
import { SITE } from "@/components/docs/facts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
