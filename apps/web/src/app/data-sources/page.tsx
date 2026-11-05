import type { Metadata } from 'next';
import '@/components/static-pages/static-pages.css';

/**
 * `/data-sources` — the honest provider register (docs/DATA-SOURCES.md).
 *
 * This page mirrors the register document, not a production claim: every
 * entry is labelled by its register status, and no provider is presented
 * as enabled, ingesting or covering a region unless the register says so
 * (docs/DATA-SOURCES.md 6 "No fabricated coverage"). The provider registry
 * in the API ships disabled by default (ADR-007: quarantine-by-default),
 * and this page says that plainly.
 */
export const metadata: Metadata = {
  title: 'Data sources',
  description:
    "SENTRAVYN's data source register: the candidate official sources the " +
    'platform reviews and ingests, with their status. No provider is claimed ' +
    'enabled or covering a region until the register says so.',
};

interface SourceRow {
  provider: string;
  use: string;
  url: string;
  urlLabel: string;
  status: string;
}

/**
 * Rows mirror docs/DATA-SOURCES.md section 1 (candidate sources). The
 * status line is the register's honest state — "candidate", not "enabled".
 * The only source with a documented as-built adapter is GDACS; the generic
 * CAP adapter exists but has no registered publisher yet.
 */
const SOURCES: SourceRow[] = [
  {
    provider: 'GDACS',
    use: 'Global disaster event and alert information.',
    url: 'https://www.gdacs.org/',
    urlLabel: 'GDACS',
    status:
      'Candidate. A minimal as-built JSON feed adapter (event id, title, ' +
      'datetime, description) exists in the ingest pipeline and is exercised ' +
      'with fixtures; verify against the current GDACS API before production ' +
      'enablement.',
  },
  {
    provider: 'GDACS API',
    use: 'API documentation for the GDACS feeds.',
    url: 'https://www.gdacs.org/gdacsapi/swagger/index.html',
    urlLabel: 'GDACS API documentation',
    status:
      'Documentation reference. Terms and usage limits must be re-verified before production use.',
  },
  {
    provider: 'USGS',
    use: 'Earthquake events and GeoJSON feeds.',
    url: 'https://earthquake.usgs.gov/data/',
    urlLabel: 'USGS earthquake data',
    status:
      'Candidate. No adapter is registered for this feed in the current pipeline.',
  },
  {
    provider: 'Copernicus EMS',
    use: 'Emergency mapping and geospatial products.',
    url: 'https://mapping.emergency.copernicus.eu/',
    urlLabel: 'Copernicus EMS',
    status:
      'Candidate. Tracked in the provider registry as the copernicus-emdat family; not enabled.',
  },
  {
    provider: 'Copernicus Data Space',
    use: 'Service and data documentation for Copernicus products.',
    url: 'https://documentation.dataspace.copernicus.eu/',
    urlLabel: 'Copernicus Data Space documentation',
    status:
      'Documentation reference. Licence and attribution terms pending review.',
  },
  {
    provider: 'CAP (Common Alerting Protocol)',
    use:
      'CAP 1.2 parsing where a source publishes CAP feeds; issuer, severity, ' +
      'urgency, certainty, times and area validation are required.',
    url: 'https://docs.ogc.org/standard/cap12/cap12.html',
    urlLabel: 'CAP 1.2 specification',
    status:
      'Capability, not a source. The generic CAP adapter exists, but no CAP ' +
      'publisher is registered yet; a publisher must be added with its ' +
      'terms before enablement. Not all global authorities publish CAP.',
  },
  {
    provider: 'OpenStreetMap',
    use: 'Community geographic data, points of interest and standard raster tiles.',
    url: 'https://www.openstreetmap.org/',
    urlLabel: 'OpenStreetMap',
    status:
      'Dev-only tiles. The web map surface uses OSM standard raster tiles ' +
      'as a development baseline with mandatory ODbL attribution; ' +
      'production-scale usage is pending a terms review. An OSM listing is ' +
      'never proof that a place is open, safe or operational.',
  },
  {
    provider: 'WHO',
    use: 'Public-health emergency guidance.',
    url: 'https://www.who.int/health-topics/emergencies',
    urlLabel: 'WHO emergency topics',
    status:
      'Candidate. No adapter is registered for this source in the current pipeline.',
  },
  {
    provider: 'WMO',
    use: 'Meteorological information and coordination.',
    url: 'https://wmo.int/',
    urlLabel: 'WMO',
    status:
      'Candidate. No adapter is registered for this source in the current pipeline.',
  },
  {
    provider: 'OCHA',
    use: 'Humanitarian coordination.',
    url: 'https://www.unocha.org/',
    urlLabel: 'OCHA',
    status:
      'Candidate. No adapter is registered for this source in the current pipeline.',
  },
  {
    provider: 'ReliefWeb',
    use: 'Humanitarian reports and situation updates.',
    url: 'https://reliefweb.int/',
    urlLabel: 'ReliefWeb',
    status:
      'Candidate. No adapter is registered for this source in the current pipeline.',
  },
  {
    provider: 'EM-DAT',
    use: 'Historical disaster research data.',
    url: 'https://www.emdat.be/',
    urlLabel: 'EM-DAT',
    status:
      'Candidate. Tracked in the provider registry as the copernicus-emdat family; not enabled.',
  },
  {
    provider: 'India NDMA SACHET',
    use: 'India-specific official alerts.',
    url: 'https://sachet.ndma.gov.in/',
    urlLabel: 'NDMA SACHET',
    status:
      'Candidate. No adapter is registered for this feed in the current pipeline.',
  },
];

export default function DataSourcesPage() {
  return (
    <section className="info-page" aria-labelledby="sources-heading">
      <p className="info-page__eyebrow">Trust &amp; sources</p>
      <h1 id="sources-heading" className="info-title">
        Data sources
      </h1>
      <p className="info-sub">
        This is the register of candidate sources the SENTRAVYN pipeline reviews
        against. It is a starting register, not proof that any endpoint is
        available for unrestricted production use — and a map or feed listing is
        never treated as proof that a place is open, safe or operational.
      </p>

      <div className="info-notice" role="note">
        <p className="info-notice__title">No coverage is claimed</p>
        <p>
          The provider registry in the API ships disabled by default, and
          ingestion is gated behind legal review, fixture-based parser tests,
          sandbox ingestion, provenance and freshness validation, and an admin
          review workflow before any controlled production enablement. Where no
          trusted source exists for a region or data type, SENTRAVYN says
          coverage is unavailable or incomplete — gaps are never filled with
          invented shelters, hospitals, numbers or alerts.
        </p>
      </div>

      <div className="info-block" aria-label="Candidate source register">
        {SOURCES.map((row) => (
          <div className="info-source-row" key={row.provider}>
            <h2 className="info-source-row__name">{row.provider}</h2>
            <p className="info-source-row__use">{row.use}</p>
            <p>
              <a
                className="info-source-row__link"
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {row.urlLabel}
              </a>
            </p>
            <p className="info-source-row__status">{row.status}</p>
          </div>
        ))}
      </div>

      <div className="info-block">
        <h2>Source policy</h2>
        <p>
          For every provider, SENTRAVYN records: the official documentation URL,
          data categories, covered regions, feed format, authentication, quotas,
          licence and attribution, redistribution rights, update cadence, last
          successful fetch, known limitations and the contact or escalation path
          where available.
        </p>
        <p>
          Service-level guarantees are never inferred from a feed&rsquo;s
          nominal update interval. Original payloads and source identifiers are
          preserved so that any record can be traced back to where it came from,
          when it was fetched and under which licence.
        </p>
      </div>

      <div className="info-block">
        <h2>Freshness</h2>
        <p>
          Every ingested record carries a freshness state computed against its
          provider&rsquo;s policy. Stale or expired data is displayed with an
          explicit label and its last-updated timestamp; it is never silently
          presented as current.
        </p>
      </div>
    </section>
  );
}
