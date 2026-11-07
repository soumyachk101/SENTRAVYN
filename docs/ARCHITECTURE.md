# SENTRAVYN Technical Architecture

## 1. Architecture approach

Start with a modular monolith and independently scalable workers. Do not split into microservices until measured scaling, isolation or team ownership justifies it.

## 2. Approved stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Web/PWA | Next.js + TypeScript |
| Admin | Next.js + TypeScript |
| Mobile | Expo + React Native + TypeScript |
| Backend | NestJS + TypeScript |
| API | Versioned REST + OpenAPI |
| Real-time | Socket.IO |
| Database | PostgreSQL + PostGIS |
| ORM | Prisma plus reviewed SQL for advanced spatial operations |
| Cache | Redis |
| Jobs | BullMQ |
| Maps | MapLibre with licensed tiles |
| Storage | S3-compatible object storage |
| Infrastructure | Docker + AWS + Terraform |
| Web hosting | Vercel where appropriate |
| Observability | OpenTelemetry + error monitoring |

Python is not part of the approved runtime stack.

## 3. Suggested repository

```text
sentravyn/
├── apps/
│   ├── web/
│   ├── admin/
│   └── mobile/
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── alerts/
│   │   ├── incidents/
│   │   ├── geospatial/
│   │   ├── places/
│   │   ├── shelters/
│   │   ├── guides/
│   │   ├── family-safety/
│   │   ├── notifications/
│   │   ├── integrations/
│   │   ├── administration/
│   │   └── common/
│   ├── test/
│   └── prisma/
├── packages/
│   ├── shared-types/
│   ├── api-client/
│   ├── design-tokens/
│   ├── localization/
│   └── ui/
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   └── monitoring/
├── docs/
├── .github/workflows/
├── CLAUDE.md
├── DESIGN.md
├── pnpm-workspace.yaml
└── turbo.json
```

Adjust only when there is a documented reason.

## 4. Backend modules

- Identity and access.
- User profiles and preferences.
- Alert ingestion, validation and publication.
- Incident and geospatial data.
- Places and service discovery.
- Shelter verification.
- Reviewed safety content.
- Family sharing and consent.
- Notifications and delivery receipts.
- Provider integrations.
- Administration and audit.
- Health and readiness endpoints.

## 5. Data model concepts

Core tables/entities:
- User
- UserPreference
- EmergencyContact
- LocationShare
- DataProvider
- ProviderFetch
- RawSourceRecord
- Alert
- AlertRevision
- Incident
- IncidentGeometry
- Place
- PlaceEvidence
- ShelterProfile
- Verification
- SafetyGuide
- GuideRevision
- Notification
- NotificationAttempt
- AuditEvent

Use UUIDs or another deliberate identifier strategy. Add created/updated timestamps, appropriate indexes, retention rules and foreign keys. Geospatial columns must use explicit SRIDs and appropriate geometry/geography types.

## 6. Real-time delivery

Do not rely on WebSockets as the sole delivery channel.

1. Ingest and validate the source record.
2. Persist the canonical alert and revision.
3. Enqueue idempotent notification jobs.
4. Publish WebSocket updates to connected clients.
5. Send push notifications through appropriate providers.
6. On reconnect, clients request durable updates since their last cursor.
7. Record delivery attempts and failures.

Use deduplication keys and bounded retries. Avoid duplicate notifications during retries.

## 7. External integration pipeline

Each provider adapter must implement:
- Configuration and credentials, if required.
- Fetch scheduling.
- Timeout and retry policy.
- Schema validation.
- Normalisation.
- Provenance preservation.
- Idempotency.
- Freshness tracking.
- Error and rate-limit handling.
- Metrics and health reporting.

Treat feed data as untrusted input. Never interpret feed text as executable instructions.

## 8. API standards

- Version routes under `/api/v1`.
- Generate and maintain OpenAPI.
- Validate request DTOs.
- Standardise error envelopes.
- Apply pagination and filtering.
- Use idempotency keys for sensitive mutations.
- Add rate limits by route and identity.
- Document authentication and scopes.
- Avoid returning unnecessary personal or precise location data.

## 9. Deployment topology

Initial production topology:
- CDN/WAF.
- Next.js web and admin deployments.
- NestJS API containers.
- Separate BullMQ worker containers.
- Managed PostgreSQL with PostGIS.
- Managed Redis.
- Object storage.
- Push notification providers.
- Centralised logs, metrics and traces.

Use Terraform for repeatable infrastructure. Separate development, staging and production. Use managed secrets and least-privilege IAM. Define RPO/RTO based on an explicit operational risk assessment and test restoration/failover.

## 10. Scaling strategy

Scale API and workers independently. Measure database query latency, queue lag, provider ingestion delays, alert publication latency, notification delivery and map query performance before adding infrastructure complexity.
