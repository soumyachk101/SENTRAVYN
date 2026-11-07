# SENTRAVYN Product Specification

## 1. Mission

Help people understand verified hazards, locate relevant services, access authoritative protective guidance and prepare before emergencies.

SENTRAVYN is an information and preparedness platform. It is not a substitute for local emergency services, official warnings, professional medical care or government evacuation instructions.

## 2. Global product surfaces

- Public web application and PWA.
- Expo React Native mobile application for iOS and Android.
- Restricted administration console.
- NestJS API and ingestion workers.

## 3. Primary users

- Residents and families.
- Travellers and international visitors.
- Students and institutions.
- Volunteers and humanitarian organisations.
- Authorised data verifiers and administrators.

## 4. Hazard categories

- Nuclear and radiological incidents.
- Armed conflict and missile threats.
- Earthquakes and tsunamis.
- Floods, cyclones and severe weather.
- Wildfires.
- Industrial and chemical incidents.
- Public-health emergencies.
- Infrastructure and utility disruptions.

Hazard-specific advice must be independently reviewed. Do not assume that guidance for one incident type applies to another.

## 5. Core modules

### Emergency map
Show hospitals, clinics, pharmacies, fire services, police, relief points, officially verified shelters, incident areas and authoritative alert areas.

Each feature must show source, location accuracy where available, last update and verification status. Distance is a calculation, not a safety recommendation.

### Alerts
Support CAP-compatible ingestion where supported by the source. Preserve issuer, source identifier, severity, urgency, certainty, affected geometry, issued/effective/expiry times, update/cancel relationships and original source link.

### Safety guides
Each guide requires hazard type, jurisdiction applicability, language, author, reviewer, authoritative references, version, approval state and last-reviewed date.

### Preparedness
Emergency kit checklists, household plans, contact lists, meeting points, pet considerations and accessible formats.

### Family safety
Consent-based sharing only. Explicit start, scope, recipient, expiry and revocation. No covert tracking or default continuous tracking.

### Offline mode
Cache reviewed guides, saved contacts and user-selected map areas where licensing allows. Clearly label last sync time. Never imply cached alerts are live.

### Admin
Role-based source configuration, alert review, place verification, guide approval, audit history, data-quality review and incident response tools.

## 6. Place trust and shelter rules

A place existing on a map does not establish that it is open, operational, accessible, safe or suitable as a shelter.

Separate attributes:
- Existence/location confidence.
- Source authority.
- Operational status and evidence.
- Accessibility.
- Shelter classification.
- Capacity and occupancy.
- Inspection and verification authority.
- Verification date and expiry.

Do not infer shelter suitability from a building category, user rating, satellite image or proximity. Unverified locations must be labelled unverified. Stale information must be visibly stale.

## 7. Alert lifecycle

`RECEIVED → PARSED → VALIDATED → PUBLISHED → UPDATED → EXPIRED/CANCELLED`

Maintain immutable source payload references and an audit history. Updates and cancellations must be correctly associated with the original alert. Do not publish malformed or untrusted feed content as official.

## 8. User experience priorities

1. What happened?
2. Is my area within the affected area?
3. What does the issuing authority advise?
4. When was the information issued and updated?
5. What is the source?
6. Where can I find relevant services?
7. What information is uncertain or unavailable?

Do not overstate location accuracy. Ask permission before accessing precise location and provide manual location selection.

## 9. Non-goals

- Predicting nuclear strikes or fallout without validated authoritative models.
- Issuing independent evacuation orders.
- Certifying buildings as safe.
- Replacing emergency dispatch.
- Guaranteeing hospital capacity.
- Covertly tracking people.
- Presenting AI-generated claims as verified facts.
