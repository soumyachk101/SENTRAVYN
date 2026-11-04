import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sentravyn.example"),
  title: "SENTRAVYN — Administration",
  description:
    "Restricted administration console for SENTRAVYN: source configuration, " +
    "alert review, place verification, guide approval and audit history.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main" className="admin-main">
          {children}
        </main>
      </body>
    </html>
  );
}
