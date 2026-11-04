import type { Viewport } from "next";
import { Gloock, Figtree } from "next/font/google";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Wells } from "@/components/site/Wells";
import "./site.css";

const display = Gloock({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const viewport: Viewport = { themeColor: "#120a05" };

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`site ${display.variable} ${body.variable}`}>
      <a href="#main" className="skip">Skip to content</a>
      <Nav />
      <main id="main">{children}</main>
      <Footer />
      <Wells />
    </div>
  );
}
