import { render, screen } from '@testing-library/react';
import type { Alert, AlertDetail } from '@sentravyn/shared-types';

/**
 * /alerts/[id] render test (jsdom, mirroring AlertsClient.test.tsx).
 *
 * Locks in the CLAUDE.md rule-10 offline state for the detail route: while
 * offline the view shows a distinct "not live" offline state (and the PWA
 * last-sync strip), and does not treat a cached record as current
 * (SAFETY-POLICY.md 8). The thin data layer (@/lib/alerts) is mocked so a
 * fixed payload drives the assertions.
 */

jest.mock('@/lib/alerts', () => ({
  listPublicAlerts: jest.fn(),
  getPublicAlertDetail: jest.fn(),
  INFORMATION_CLASS_LABELS: {
    OFFICIAL_SOURCE: 'Official source content',
    SENTRAVYN_SUMMARY: 'SENTRAVYN-reviewed summary (not an official order)',
    THIRD_PARTY: 'Third-party data',
    USER_SUBMISSION: 'User submission (unverified)',
    DERIVED_CALCULATION: 'Derived calculation',
    UNVERIFIED_OR_STALE: 'Unverified or stale information',
  },
  FRESHNESS_LABELS: {
    fresh: 'Fresh',
    stale: 'Stale — information may no longer be current',
    expired: 'Expired — information is no longer current',
    unknown: 'Freshness unknown — no last-update time on record',
  },
}));

import { getPublicAlertDetail } from '@/lib/alerts';
import { AlertsDetailClient } from '../AlertsDetailClient';

const mockedDetail = jest.mocked(getPublicAlertDetail);

function detailOf(overrides: Partial<Alert> = {}): AlertDetail {
  // A complete Alert base (every required field present) so an overrides
  // spread keeps the result assignable to Alert.
  const base: Alert = {
    id: 'alert-1',
    externalRef: 'CAP-MSG-0001',
    status: 'PUBLISHED',
    verification: 'OFFICIAL',
    informationClass: 'OFFICIAL_SOURCE',
    headline: 'Severe weather warning — river valley',
    issuer: 'National Weather Service',
    severity: 'Severe',
    urgency: 'Immediate',
    certainty: 'Observed',
    issuedAt: '2025-06-01T10:00:00.000Z',
    effectiveAt: '2025-06-01T12:00:00.000Z',
    expiresAt: '2025-06-01T20:00:00.000Z',
    publishedAt: '2025-06-01T10:05:00.000Z',
    createdAt: '2025-06-01T10:05:00.000Z',
    updatedAt: '2025-06-01T10:05:00.000Z',
    freshness: {
      state: 'fresh',
      ageMinutes: 12,
      expiresAt: '2025-06-01T20:00:00.000Z',
      policyHours: 6,
    },
  };
  const alert = { ...base, ...overrides };
  return { alert, revisions: [], provenance: null };
}

/** jsdom does not implement navigator.onLine toggles; patch it per test. */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });
}

beforeEach(() => {
  mockedDetail.mockReset();
});

describe('/alerts/[id] detail route (AlertsDetailClient)', () => {
  it('renders the loaded record with its headline when online', async () => {
    setOnline(true);
    mockedDetail.mockResolvedValue(detailOf());

    render(<AlertsDetailClient alertId="alert-1" />);

    expect(
      await screen.findByText('Severe weather warning — river valley'),
    ).toBeInTheDocument();
  });

  it('shows a distinct not-live offline state (with the last-sync strip) when offline', async () => {
    setOnline(false);
    // Offline on a fresh mount: the view does NOT re-fetch (the service
    // worker never caches /api/*, so there is no offline copy to serve). The
    // record is therefore not shown, and the not-live strip is the signal.
    mockedDetail.mockResolvedValue(detailOf());

    render(<AlertsDetailClient alertId="alert-1" />);

    // The distinct offline state (CLAUDE.md rule 10) and its working retry
    // control — the control that re-runs the fetch when back online.
    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();

    // The PWA last-sync / not-live strip is mounted and reads as not live
    // (a not-live view is never shown as current — SAFETY-POLICY.md 8). The
    // last-sync line is deterministic here: no recordLocalSync ran, so the
    // strip reports that no live sync exists on this device.
    expect(
      screen.getByText(/no live data synced yet on this device/i),
    ).toBeInTheDocument();

    // The record was NOT loaded while offline, so its headline is absent —
    // we never present an offline/cached detail as current.
    expect(
      screen.queryByText('Severe weather warning — river valley'),
    ).toBeNull();
  });
});
