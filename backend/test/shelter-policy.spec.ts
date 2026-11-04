import {
  evaluateShelterPolicy,
  ShelterPolicyInput,
  DEFAULT_REVALIDATION_WINDOW_DAYS,
} from '../src/shelters/shelter-policy';

describe('shelter verification policy (SAFETY-POLICY.md 3, Gate E)', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  function input(
    overrides: Partial<ShelterPolicyInput['evidence']> = {},
    approvalOverrides: Partial<ShelterPolicyInput['approval']> = {},
  ): ShelterPolicyInput {
    return {
      evidence: {
        authority: 'City Emergency Management Agency',
        classification: 'Severe-weather shelter (indoor)',
        verificationDate: '2026-11-04T08:00:00Z',
        expiresAt: '2026-12-04T00:00:00Z',
        ...overrides,
      },
      approval: {
        approvedBy: 'admin-1',
        approverPrivileged: true,
        ...approvalOverrides,
      },
      now,
    };
  }

  it('verifies only when evidence is complete AND an authorised approval exists', () => {
    expect(evaluateShelterPolicy(input()).canDisplayAsVerified).toBe(true);
  });

  it('never verifies a shelter with missing evidence (a map point is not a shelter claim)', () => {
    const r = evaluateShelterPolicy(
      input({ authority: null, classification: null }),
    );
    expect(r.canDisplayAsVerified).toBe(false);
    expect(r.displayState).toBe('INCOMPLETE');
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        'missing verifying authority',
        'missing shelter classification',
      ]),
    );
  });

  it('never verifies without an authorised privileged approval', () => {
    const r = evaluateShelterPolicy(
      input({}, { approvedBy: 'public-user', approverPrivileged: false }),
    );
    expect(r.canDisplayAsVerified).toBe(false);
    expect(r.displayState).toBe('UNVERIFIED');
  });

  it('treats an expired verification as EXPIRED, never verified', () => {
    const r = evaluateShelterPolicy(input({ expiresAt: '2026-11-01T00:00:00Z' }));
    expect(r.canDisplayAsVerified).toBe(false);
    expect(r.displayState).toBe('EXPIRED');
  });

  it(
    'labels a verification older than the revalidation window as STALE, not live',
    () => {
      // 2026-10-01 is 34 days before now, beyond the 30-day default window.
      const r = evaluateShelterPolicy(input({ verificationDate: '2026-10-01T00:00:00Z' }));
      expect(r.canDisplayAsVerified).toBe(false);
      expect(r.displayState).toBe('STALE');
    },
  );

  it('a fresh verification within the window is verified even though the date is in the past', () => {
    // 3 days old: within the 30-day window. A past date is not by itself unsafe.
    const r = evaluateShelterPolicy(
      input({ verificationDate: '2026-11-01T12:00:00Z' }),
    );
    expect(r.canDisplayAsVerified).toBe(true);
    expect(r.displayState).toBeUndefined();
  });

  it('honours a per-shelter revalidation window override', () => {
    // 45 days old, but the authority set a 60-day window: still verified.
    const r = evaluateShelterPolicy(
      input({
        verificationDate: '2026-09-20T00:00:00Z',
        revalidationWindowDays: 60,
      }),
    );
    expect(r.canDisplayAsVerified).toBe(true);
  });

  it('exposes the documented default revalidation window', () => {
    expect(DEFAULT_REVALIDATION_WINDOW_DAYS).toBe(30);
  });
});
