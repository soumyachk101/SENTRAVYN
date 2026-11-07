import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  GeoService,
  NearbyQuery,
  PlaceGeoRow,
} from '../src/geospatial/geo.service';

/**
 * Phase 4 gate (ROADMAP Phase 4): spatial correctness: PostGIS distance/radius
 * verified against the real engine, not stubs.
 *
 * DB gating: dbConfigured = Boolean(process.env.DATABASE_URL). Every
 * database-dependent case logs 'SKIP: DATABASE_URL not configured; <case> not
 * run' and returns early - a skip is never a pass. The lead runs
 * `prisma migrate deploy` against the local Postgres docker service (or the CI
 * postgres service) before this spec, so the PostGIS extension and the
 * geography columns exist.
 *
 * All spatial assertions run through GeoService's real $queryRaw tagged
 * templates against Postgres/PostGIS - no mocked query layer. Fixtures carry
 * run-unique kind values so a shared disposable database does not pollute the
 * assertions (relative membership/ordering, not absolute counts).
 */
describe('GeoService (Phase 4 PostGIS gate)', () => {
  const dbConfigured = Boolean(process.env.DATABASE_URL);

  let prisma: PrismaService;
  let service: GeoService;
  let moduleRef: TestingModule;

  // Search centre and staged fixture coordinates (north of the centre).
  //   a: ~445 m in (hospital)
  //   b: ~1002 m in (shelter)
  //   d: ~2226 m in (second hospital)
  //   c: no coordinates at all (excluded from radius search until updated)
  //   e: coordinates present, dedicated to the backfill-idempotency case
  const runId = Date.now();
  const centre: Pick<NearbyQuery, 'lat' | 'lng'> = { lat: 40.7, lng: -74.0 };
  const kind = {
    a: `geo-hospital-${runId}`,
    b: `geo-shelter-${runId}`,
    c: `geo-school-${runId}`,
    d: `geo-hospital2-${runId}`,
    e: `geo-backfill-${runId}`,
  };
  const fixtures = {
    a: { kind: kind.a, lat: 40.704, lng: -74.0 },
    b: { kind: kind.b, lat: 40.709, lng: -74.0 },
    c: { kind: kind.c, lat: null, lng: null },
    d: { kind: kind.d, lat: 40.72, lng: -74.0 },
    e: { kind: kind.e, lat: 40.705, lng: -74.0 },
  };
  const ids: Record<keyof typeof fixtures, string> = {
    a: '',
    b: '',
    c: '',
    d: '',
    e: '',
  };

  async function locationSet(placeId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*) AS "n" FROM "Place" WHERE "id" = ${placeId} AND "location" IS NOT NULL
    `;
    return (rows[0] as { n: number }).n > 0;
  }

  beforeAll(async () => {
    if (!dbConfigured) return;

    moduleRef = await Test.createTestingModule({
      providers: [ConfigService, PrismaService, GeoService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(GeoService);

    for (const key of ['a', 'b', 'c', 'd', 'e'] as const) {
      const f = fixtures[key];
      ids[key] = (
        await prisma.place.create({
          data: {
            name: `geo-${key}-${runId}`,
            kind: f.kind,
            lat: f.lat,
            lng: f.lng,
          },
        })
      ).id;
    }

    // Populate the derived geography column from staged lat/lng before the
    // spatial cases (ADR-004: lat/lng are the source of truth).
    await service.backfillLocations();
  });

  afterAll(async () => {
    if (!dbConfigured) return;
    await prisma.place.deleteMany({
      where: { id: { in: Object.values(ids) } },
    });
    await moduleRef.close();
  });

  it('verifies the PostGIS geography columns exist on Place and Incident', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; column presence not run');
      return;
    }
    await prisma.$queryRaw`SELECT "location" FROM "Place" LIMIT 0`;
    await prisma.$queryRaw`SELECT "footprint" FROM "Incident" LIMIT 0`;
  });

  it('nearby: distance, ordering and radius are computed by the real PostGIS engine', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; nearby radius not run');
      return;
    }
    // Wide radius so a, b and d all rank in; c has no coordinates and must not.
    const results = await service.nearby({
      ...centre,
      radiusMeters: 2500,
      limit: 200,
    });
    const byName = new Map(
      results.map((r): [string, PlaceGeoRow] => [r.name, r]),
    );

    const ia = results.findIndex((r: PlaceGeoRow) => r.id === ids.a);
    const ib = results.findIndex((r: PlaceGeoRow) => r.id === ids.b);
    const id = results.findIndex((r: PlaceGeoRow) => r.id === ids.d);

    // Nearest-first ordering among the three fixtures that have locations.
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(id);

    // Geodetic metres (geography type, ADR-004) against real-world bounds.
    const a = byName.get(`geo-a-${runId}`) as PlaceGeoRow;
    const b = byName.get(`geo-b-${runId}`) as PlaceGeoRow;
    expect(a.distanceMeters).toBeGreaterThanOrEqual(400);
    expect(a.distanceMeters).toBeLessThanOrEqual(500);
    expect(b.distanceMeters).toBeGreaterThanOrEqual(950);
    expect(b.distanceMeters).toBeLessThanOrEqual(1050);
  });

  it('nearby: places without a location are excluded (unknown never ranks as near)', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; null-location exclusion not run',
      );
      return;
    }
    // c has no coordinates, so it has no PostGIS location: it must not appear.
    expect(await locationSet(ids.c)).toBe(false);
    const results = await service.nearby({
      ...centre,
      radiusMeters: 2500,
      limit: 200,
    });
    expect(results.some((r: PlaceGeoRow) => r.id === ids.c)).toBe(false);
  });

  it('nearby: optional kind filter uses the separate tagged query', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; kind filter not run');
      return;
    }
    // kind.b is run-unique, so exactly one row in the database matches it.
    const shelters = await service.nearby({
      ...centre,
      radiusMeters: 2500,
      kind: kind.b,
      limit: 200,
    });
    expect(shelters.length).toBe(1);
    expect(shelters[0].id).toBe(ids.b);
    expect(shelters[0].kind).toBe(kind.b);
  });

  it('nearby: input guards clamp radius at the service boundary', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; input clamping not run');
      return;
    }
    // radiusMeters: 1 clamps up to the 100 m floor; the ~445 m fixture a is
    // outside even the clamped radius, so it is absent from the result.
    const clamped = await service.nearby({
      ...centre,
      radiusMeters: 1,
      limit: 200,
    });
    expect(clamped.some((r: PlaceGeoRow) => r.id === ids.a)).toBe(false);
  });

  it('updatePlaceLocation: keeps lat/lng and the geography column in sync', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; updatePlaceLocation not run',
      );
      return;
    }
    const updated = await service.updatePlaceLocation(ids.c, 40.702, -74.0);
    expect(updated).toBe(true);

    const row = await prisma.place.findUniqueOrThrow({ where: { id: ids.c } });
    expect(row.lat).toBe(40.702);
    expect(row.lng).toBe(-74.0);

    // The derived geography column moved with it: c now ranks as near.
    expect(await locationSet(ids.c)).toBe(true);
    const near = await service.nearby({
      ...centre,
      radiusMeters: 300,
      limit: 200,
    });
    expect(near.some((r: PlaceGeoRow) => r.id === ids.c)).toBe(true);
  });

  it('updatePlaceLocation: returns false for an unknown place id', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; unknown-id update not run',
      );
      return;
    }
    const updated = await service.updatePlaceLocation(
      `missing-${runId}`,
      40.7,
      -74.0,
    );
    expect(updated).toBe(false);
  });

  it('backfillLocations: idempotent - a re-run leaves populated rows unchanged', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; backfill idempotency not run',
      );
      return;
    }
    // e was populated by the beforeAll backfill; it stays set.
    expect(await locationSet(ids.e)).toBe(true);
    // A second backfill only touches location-IS-NULL rows, so e is untouched.
    await service.backfillLocations();
    expect(await locationSet(ids.e)).toBe(true);
  });
});
