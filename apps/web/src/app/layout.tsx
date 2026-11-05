import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Background from "@/components/Background";
import { CinematicFooter } from "@/components/CinematicFooter";
import "./globals.css";

// The canonical origin for absolute-URL metadata (canonical/OG tags). A real
// deployment sets NEXT_PUBLIC_WEB_BASE_URL; until then we fall back to the
// example domain rather than fabricate a production host (CLAUDE.md: never
// claim a domain without evidence).
const METADATA_BASE = new URL(
  process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "https://sentravyn.example",
);

export const metadata: Metadata = {
  metadataBase: METADATA_BASE,
  title: {
    default: "SENTRAVYN — Global Emergency Intelligence & Public Safety",
    template: "%s — SENTRAVYN",
  },
  description:
    "SENTRAVYN helps people access authoritative emergency alerts, understand " +
    "reviewed protective guidance, discover nearby emergency services and " +
    "prepare households. An information and preparedness platform, not an " +
    "operational emergency service.",
  manifest: "/manifest.webmanifest",
  applicationName: "SENTRAVYN",
};

export const viewport: Viewport = {
  themeColor: "#101418",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Background />
        <div className="app-shell">
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <main id="main" className="main-content">
            {children}
          </main>
          <CinematicFooter />
        </div>
      </body>
    </html>
  );
}
