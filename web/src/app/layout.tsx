import type { Metadata, Viewport } from "next";
import "./base.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.playpetri.xyz"),
  title: { default: "Petri — a coin that is alive", template: "%s · Petri" },
  description:
    "A NEAR contract runs Conway's Life on a shared dish. Every cell belongs to a real account, the agar feeds the living PETRI, planting pays half back and burns half, and every hour the NEAR vault pays out to the colonies that earned. Free play on testnet, real NEAR on mainnet.",
  openGraph: {
    type: "website",
    title: "Petri — a coin that is alive",
    description: "Conway's Life with owners, run by a NEAR contract: buy PETRI, plant colonies, win NEAR at the hourly tides, and replay the whole dish from genesis yourself.",
    url: "/",
    images: ["/og.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
