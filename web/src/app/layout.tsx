import type { Metadata, Viewport } from "next";
import { STIX_Two_Text, Archivo } from "next/font/google";
import { TopBar } from "@/components/TopBar";
import { Colophon } from "@/components/Colophon";
import "./globals.css";

const stix = STIX_Two_Text({ subsets: ["latin"], variable: "--font-stix", display: "swap", style: ["normal", "italic"] });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap", axes: ["wdth"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://petri-dish.vercel.app"),
  title: { default: "Petri — a coin that is alive", template: "%s · Petri" },
  description:
    "A NEAR contract runs Conway's Life on a shared dish. Every cell belongs to a real account, every generation mints PETRI to the living, and planting burns it.",
  openGraph: { type: "website", title: "Petri — a coin that is alive", images: ["/og.png"] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9f8" },
    { media: "(prefers-color-scheme: dark)", color: "#101722" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${stix.variable} ${archivo.variable}`}>
      <body>
        <a href="#main" className="skip">Skip to the dish</a>
        <div className="notebook">
          <TopBar />
          <main id="main">{children}</main>
          <Colophon />
        </div>
      </body>
    </html>
  );
}
