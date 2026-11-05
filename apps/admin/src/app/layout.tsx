import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "./globals.css";
import Background from "@/components/Background";
import { CinematicFooter } from "@/components/CinematicFooter";
import { Header } from "@/components/Header";
import { SessionProvider } from "@/lib/session";
import {
  FONT_VARS,
  geist,
  inter,
  interLatinExt,
  plexMono400,
  plexMono500,
  plexMono600,
  plexMono700,
  plexMonoLatinExt,
} from "@/lib/fonts";

// The canonical origin for absolute-URL metadata. A real deployment sets
// NEXT_PUBLIC_ADMIN_BASE_URL; until then we fall back to the example domain
// rather than fabricate a production host (CLAUDE.md: never claim a domain
// without evidence).
const METADATA_BASE = new URL(
  process.env.NEXT_PUBLIC_ADMIN_BASE_URL ?? "https://sentravyn.example",
);

export const metadata: Metadata = {
  metadataBase: METADATA_BASE,
  title: "SENTRAVYN — Administration",
  description:
    'Restricted administration console for SENTRAVYN: source configuration, ' +
    'alert review, place verification, guide approval and audit history.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode,
}) {
  // next/font loads the self-hosted woff2 files as @font-face and injects a
  // CSS var (--font-*) per family on <body>. FONT_VARS re-points the
  // DESIGN.md token vars (--font-display/-body/-mono) at those real
  // families, so every surface (header, console, footer ASCII) uses the
  // loaded fonts. Multilingual coverage is not claimed (latin subsets).
  const fontClasses = [
    geist.variable,
    inter.variable,
    interLatinExt.variable,
    plexMono400.variable,
    plexMono500.variable,
    plexMono600.variable,
    plexMono700.variable,
    plexMonoLatinExt.variable,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <html lang="en">
      <body className={fontClasses} style={FONT_VARS as CSSProperties}>
        {/* Custom background system (DESIGN.md 3: mandatory). */}
        <Background />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SessionProvider>
          <Header />
          <main id="main" className="admin-main">
            {children}
          </main>
          {/* Signature cinematic ASCII footer (DESIGN.md 4: mandatory). */}
          <CinematicFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
