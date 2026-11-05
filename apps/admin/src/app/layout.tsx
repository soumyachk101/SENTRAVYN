import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Background from '@/components/Background';
import { CinematicFooter } from '@/components/CinematicFooter';
import { Header } from '@/components/Header';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  metadataBase: new URL('https://sentravyn.example'),
  title: 'SENTRAVYN — Administration',
  description:
    'Restricted administration console for SENTRAVYN: source configuration, ' +
    'alert review, place verification, guide approval and audit history.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
