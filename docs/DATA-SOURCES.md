# SENTRAVYN Data Sources & Integration Register

This document is a starting register, not proof that every endpoint is available for unrestricted production use. Before integration, verify current API documentation, terms, licensing, attribution, quotas, geographic coverage, update cadence and redistribution permissions.

## 1. Candidate sources

| Provider | Potential use | Official resource |
|---|---|---|
| GDACS | Global disaster event and alert information | https://www.gdacs.org/ |
| GDACS API | API documentation | https://www.gdacs.org/gdacsapi/swagger/index.html |
| USGS | Earthquake events and GeoJSON feeds | https://earthquake.usgs.gov/data/ |
| Copernicus EMS | Emergency mapping and geospatial products | https://mapping.emergency.copernicus.eu/ |
| Copernicus Data Space | Service/data documentation | https://documentation.dataspace.copernicus.eu/ |
| WHO | Public-health emergency guidance | https://www.who.int/health-topics/emergencies |
| WMO | Meteorological information and coordination | https://wmo.int/ |
| OCHA | Humanitarian coordination | https://www.unocha.org/ |
| ReliefWeb | Humanitarian reports and situation updates | https://reliefweb.int/ |
| EM-DAT | Historical disaster research data | https://www.emdat.be/ |
| OpenStreetMap | Community geographic data and points of interest | https://www.openstreetmap.org/ |
| India NDMA SACHET | India-specific official alerts | https://sachet.ndma.gov.in/ |

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
