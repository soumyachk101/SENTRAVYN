# SENTRAVYN Data Sources & Integration Register

This document is a starting register, not proof that every endpoint is available for unrestricted production use. Before integration, verify current API documentation, terms, licensing, attribution, quotas, geographic coverage, update cadence and redistribution permissions.

## 1. Candidate sources

| Provider | Potential use | Official resource |
|---|---|---|
| GDACS | Global disaster event and alert information | https://www.gdacs.org/ |
| GDACS API | API documentation | https://www.gdacs.org/gdacsapi/swagger/index.html |
| GDACS API (Phase 3 as-built feed format) | Minimal JSON array of { eventid, title, datetime, description? }; the adapter is a minimal documented contract, see backend/src/integrations/adapters/gdacs.adapter.ts - verify against the current GDACS API before production enablement | https://www.gdacs.org/gdacsapi/swagger/index.html |
| USGS | Earthquake events and GeoJSON feeds | https://earthquake.usgs.gov/data/ |
| Copernicus EMS | Emergency mapping and geospatial products | https://mapping.emergency.copernicus.eu/ |
| Copernicus Data Space | Service/data documentation | https://documentation.dataspace.copernicus.eu/ |
| CAP (generic) | Common Alerting Protocol 1.2 (OASIS) - parsed by the Phase 3 generic CAP adapter; no specific CAP publisher is registered yet; a publisher must be added with its terms before enablement | https://docs.ogc.org/standard/cap12/cap12.html (verify before launch) |
| Maps / tiles / geocoding | OpenStreetMap standard raster tiles: dev-time usage, ODbL, attribution mandatory, production-scale usage pending terms review (section 3). Geocoding: provider chosen only when GEOCODING_PROVIDER and key are configured; no geocoding coverage is claimed until then (section 6) | https://www.openstreetmap.org/ |
| WHO | Public-health emergency guidance | https://www.who.int/health-topics/emergencies |
| WMO | Meteorological information and coordination | https://wmo.int/ |
| OCHA | Humanitarian coordination | https://www.unocha.org/ |
| ReliefWeb | Humanitarian reports and situation updates | https://reliefweb.int/ |
| EM-DAT | Historical disaster research data | https://www.emdat.be/ |
| OpenStreetMap | Community geographic data and points of interest | https://www.openstreetmap.org/ |
| India NDMA SACHET | India-specific official alerts | https://sachet.ndma.gov.in/ |

The Phase 2 provider registry keys the Copernicus/EM-DAT family as `copernicus-emdat` (its seed `docUrl` points at the Copernicus Data Space documentation), with Copernicus EMS and EM-DAT tracked in the attribution text.

## 2. Source policy

For every provider record:
- Provider name and official documentation URL.
- Data categories.
- Countries/regions covered.
- API/feed format.
- Authentication requirements.
- Quota and rate limits.
- Licence and attribution.
- Redistribution/storage rights.
- Expected update cadence.
- Last successful fetch.
- Known limitations.
- Contact and escalation path where available.

Do not infer service-level guarantees from a feed's nominal update interval.

## 3. OpenStreetMap caution

OSM can help discover mapped amenities and geographic features. It does not prove a hospital is open, operational, accepting patients, or suitable as a shelter.

Respect OSM attribution and ODbL obligations. Do not assume the public Nominatim or tile servers are suitable for production-scale usage. Select a provider or operate compliant infrastructure after reviewing its policy.

The Phase 4 web place-discovery map (`apps/web` `/map`) uses OSM standard raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) as a DEV-ONLY tile source. The OSM attribution is rendered in the UI (mandatory under ODbL), the page states that the tile provider is dev-only and that production-scale usage is pending a terms review, and no production tile host is claimed. This is an honest dev-time baseline, not a production data source.

## 4. CAP support

Implement Common Alerting Protocol parsing where source formats support it. Preserve original payload and source identifiers. Validate issuer, status, message type, scope, urgency, severity, certainty, effective time, expiry, area and references to updates/cancellations.

Do not assume all global authorities publish CAP feeds or that all CAP messages have identical semantics.

## 5. Integration stages

1. Documentation and legal review.
2. Provider adapter and schema.
3. Fixture-based parser tests.
4. Sandbox or low-risk ingestion.
5. Provenance and freshness validation.
6. Admin review and quarantine workflow.
7. Controlled production enablement.
8. Monitoring and periodic revalidation.

## 6. No fabricated coverage

If no trusted source exists for a region or data type, show that coverage is unavailable or incomplete. Never fill gaps with invented shelters, hospitals, emergency numbers or alerts.
