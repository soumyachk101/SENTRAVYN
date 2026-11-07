import type { Metadata, Viewport } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import Background from '@/components/Background';
import { CinematicFooter } from '@/components/CinematicFooter';
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
} from '@/lib/fonts';
import { PwaRegistrar } from '@/components/PwaRegistrar';
import { JsonLdScript } from '@/components/JsonLdScript';
import { siteGraph, webBaseUrl } from '@/lib/jsonld';
import './globals.css';

// The canonical origin for absolute-URL metadata (canonical/OG tags). A real
// deployment sets NEXT_PUBLIC_WEB_BASE_URL; until then we fall back to the
// example domain rather than fabricate a production host (CLAUDE.md: never
// claim a domain without evidence). Shared with robots/sitemap/JSON-LD via
// webBaseUrl() so the origin can never drift between them.
const METADATA_BASE = new URL(webBaseUrl());

// Site-wide Organization + WebSite structured data (the actual publisher,
// factual only — no logo, ratings or invented credentials). This Next
// version's Metadata type has no `jsonLd` key, so the recommended pattern is
// an inline <script type="application/ld+json"> in the layout, rendered
// below via JsonLdScript. Per-page graphs (the guide TechArticle) render
// their own script tags where that data exists.
const SITE_JSONLD = siteGraph(webBaseUrl());

export const metadata: Metadata = {
  metadataBase: METADATA_BASE,
  title: {
    default: 'SENTRAVYN — Global Emergency Intelligence & Public Safety',
    template: '%s — SENTRAVYN',
  },
  description:
    'SENTRAVYN helps people access authoritative emergency alerts, understand ' +
    'reviewed protective guidance, discover nearby emergency services and ' +
    'prepare households. An information and preparedness platform, not an ' +
    'operational emergency service.',
  manifest: '/manifest.webmanifest',
  applicationName: 'SENTRAVYN',
  // Open Graph / social-card metadata from real, factual content only (no
  // invented images, ratings or claims — docs/SEO-AEO-GEO.md). Absolute URLs
  // resolve against metadataBase.
  openGraph: {
    type: 'website',
    siteName: 'SENTRAVYN',
    title: 'SENTRAVYN — Global Emergency Intelligence & Public Safety',
    description:
      'Authoritative emergency alerts, reviewed protective guidance, nearby ' +
      'emergency services and household preparedness. An information and ' +
      'preparedness platform, not an operational emergency service.',
  },
};

export const viewport: Viewport = {
  themeColor: '#101418',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // next/font loads the self-hosted woff2 files as @font-face and injects a
  // CSS var (--font-*) per family on <html>. The token vars in globals.css
  // (DESIGN.md typography) are re-pointed at those real families via FONT_VARS,
  // so every surface (hero, map, footer ASCII) uses the loaded fonts.
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
    .join(' ');
  return (
    <html lang="en">
      {/*
        The next/font .variable classes set --font-* on <body>; FONT_VARS
        re-points the DESIGN.md token vars (--font-display/-body/-mono) at
        those real families, and lives on <body> so every descendant
        (hero, map, footer ASCII) inherits them.
      */}
      <body className={fontClasses} style={FONT_VARS as CSSProperties}>
        <PwaRegistrar />
        <Background />
        {/* Organization + WebSite structured data, site-wide. */}
        <JsonLdScript graph={SITE_JSONLD} />
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
