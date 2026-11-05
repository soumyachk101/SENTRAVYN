import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Background from "@/components/Background";
import { CinematicFooter } from "@/components/CinematicFooter";
import { Header } from "@/components/Header";
import { SessionProvider } from "@/lib/session";

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
    "Restricted administration console for SENTRAVYN: source configuration, " +
    "alert review, place verification, guide approval and audit history.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode,
}) {
  return (
    <html lang="en">
      <body>
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
