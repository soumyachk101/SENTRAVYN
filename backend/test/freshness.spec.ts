import { evaluateFreshness } from '../src/common/freshness';

describe('evaluateFreshness (SAFETY-POLICY.md 8: stale data must never look live)', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('marks a recently updated record as fresh', () => {
    const r = evaluateFreshness({
      updatedAt: new Date('2026-11-04T11:00:00Z'),
      now,
      policyHours: 6,
    });
    expect(r.state).toBe('fresh');
    expect(r.ageMinutes).toBe(60);
  });

  it('marks a record past the freshness policy as stale', () => {
    const r = evaluateFreshness({
      updatedAt: new Date('2026-11-04T05:00:00Z'),
      now,
      policyHours: 6,
    });
    expect(r.state).toBe('stale');
    expect(r.ageMinutes).toBe(420);
  });

  it('marks a record past its source-supplied expiry as expired (never active)', () => {
    const r = evaluateFreshness({
      updatedAt: new Date('2026-11-04T11:00:00Z'),
      expiresAt: new Date('2026-11-04T11:30:00Z'),
      now,
    });
    expect(r.state).toBe('expired');
    expect(r.expiresAt).toBe('2026-11-04T11:30:00.000Z');
  });

  it('reports unknown when no timestamp is available', () => {
    const r = evaluateFreshness({ updatedAt: null, now });
    expect(r.state).toBe('unknown');
    expect(r.ageMinutes).toBeNull();
  });
});
