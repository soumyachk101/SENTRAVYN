import type { Metadata } from 'next';
import { MapPanel } from '@/components/map/MapPanel';

export const metadata: Metadata = {
  title: 'Emergency map',
  description:
    'Discover hospitals, clinics, fire and police services, relief points and ' +
    'shelters by category. Distance is a calculation, never a safety ' +
    'recommendation. Development tiles only; production pending a terms review.',
};

/**
 * Phase 4 place-discovery map. A manual, radius-based search around a chosen
 * centre — no device geolocation (ADR-017 / SECURITY.md 5). OpenStreetMap
 * raster tiles are a DEV-ONLY provider with mandatory ODbL attribution;
 * production-scale usage is pending a terms review (docs/DATA-SOURCES.md 3).
 *
 * The panel handles every data-driven state: loading, empty (no reviewed
 * places in range — coverage is not complete), error/retry, stale and
 * offline (CLAUDE.md rule 10).
 */
export default function MapPage() {
  return <MapPanel />;
}
