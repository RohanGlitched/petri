import type { Metadata, Viewport } from "next";
import { Gloock, Figtree } from "next/font/google";
import { Shell } from "@/components/docs/Shell";
import { DOCS } from "@/components/docs/facts";
import "./docs.css";

const display = Gloock({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(DOCS),
  title: { default: "Petri docs", template: "%s · Petri docs" },
  description: "Documentation for Petri, Conway's Life with owners run by one NEAR contract: how to play, the rules and formulas, the contract API, NEAR Intents, verification and security.",
};

export const viewport: Viewport = { themeColor: "#120a05" };

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`docs ${display.variable} ${body.variable}`}>
      <Shell>{children}</Shell>
    </div>
  );
}
