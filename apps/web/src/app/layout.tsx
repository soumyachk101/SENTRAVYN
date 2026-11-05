import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Background from "@/components/Background";
import { CinematicFooter } from "@/components/CinematicFooter";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sentravyn.example"),
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
        <PwaRegistrar />
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
