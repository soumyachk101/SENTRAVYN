import { fireEvent, render, screen } from '@testing-library/react';
import type { Alert, Paginated } from '@sentravyn/shared-types';

/**
 * /alerts render tests (jsdom, mirroring MapPanel.test.tsx): mount the
 * AlertsClient and assert on the DOM — the page renders, the EMPTY state
 * shows when the API has no public records, the ERROR state shows a
 * working retry control, and a stale record's FRESHNESS label text is
 * visible (SAFETY-POLICY.md 8: stale data is shown as stale, never as
 * live). The thin data layer (@/lib/alerts -> @sentravyn/api-client) is
 * mocked so a fixed payload drives the assertions.
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

import { listPublicAlerts } from '@/lib/alerts';
import { AlertsClient } from '../AlertsClient';

const mockedList = jest.mocked(listPublicAlerts);

function alertRow(overrides: Partial<Alert> = {}): Alert {
  return {
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
    freshness: {
      state: 'fresh',
      ageMinutes: 12,
      expiresAt: '2025-06-01T20:00:00.000Z',
      policyHours: 6,
    },
    createdAt: '2025-06-01T10:05:00.000Z',
    updatedAt: '2025-06-01T10:05:00.000Z',
    ...overrides,
  };
}

function pageOf(items: Alert[]): Paginated<Alert> {
  return {
    items,
    pagination: { page: 1, pageSize: 20, total: items.length },
  };
}

beforeEach(() => {
  mockedList.mockReset();
});

describe('/alerts page (AlertsClient)', () => {
  it('renders the empty state when the API has no public alerts', async () => {
    mockedList.mockResolvedValue(pageOf([]));

    render(<AlertsClient />);

    // The section heading is present (the page mounted, not a blank).
    expect(
      screen.getByRole('heading', { name: /public emergency alerts/i }),
    ).toBeInTheDocument();

    // The fetch resolves with zero items -> the empty state, with the
    // honest "does not mean no events are occurring" wording — never a
    // fabricated list. (The state panel's title is a <p> with the shared
    // .state-panel__title styling, matching the map/guides panels — assert
    // on the visible text, not a heading role.)
    const emptyTitle = await screen.findByText(
      /no public alerts are currently available/i,
    );
    expect(emptyTitle).toBeInTheDocument();
    expect(
      screen.getByText(/does not mean no events are occurring/i),
    ).toBeInTheDocument();
  });

  it('shows an explicit STALE freshness label on a stale record', async () => {
    mockedList.mockResolvedValue(
      pageOf([
        alertRow({
          id: 'alert-stale',
          headline: 'Flooding advisory — upland area',
          status: 'EXPIRED',
          freshness: {
            state: 'stale',
            ageMinutes: 900,
            expiresAt: '2025-06-01T20:00:00.000Z',
            policyHours: 6,
          },
        }),
      ]),
    );

    render(<AlertsClient />);

    // The record's headline renders from the payload.
    expect(
      await screen.findByText('Flooding advisory — upland area'),
    ).toBeInTheDocument();

    // The STALE label is shown as text (colour is never the only signal):
    // a stale record is labelled stale, never presented as current.
    const staleLabel = screen.getByText(
      /stale — information may no longer be current/i,
    );
    expect(staleLabel).toBeInTheDocument();
    // The information-class label is shown too (SAFETY-POLICY.md 2).
    expect(screen.getByText(/official source content/i)).toBeInTheDocument();
  });

  it('shows the error state with a working retry control on fetch failure', async () => {
    // The api-client surfaces a network-level failure (offline / DNS / CORS)
    // as the fetch TypeError.
    mockedList.mockRejectedValue(
      new TypeError('The SENTRAVYN API could not be reached.'),
    );

    render(<AlertsClient />);

    // The error panel's title is a <p> (state-panel__title, matching the
    // map/guides panels) — assert on the visible text, not a heading role.
    const errorTitle = await screen.findByText(/could not load alerts/i);
    expect(errorTitle).toBeInTheDocument();

    // Every control must work (CLAUDE.md rule 9): a Retry control is
    // present, labelled, and re-runs the fetch.
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledTimes(1);

    mockedList.mockClear();
    mockedList.mockResolvedValueOnce(pageOf([]));
    // fireEvent wraps the dispatch in act(...) so the state update from the
    // retry handler settles before the assertion (raw .click() does not).
    fireEvent.click(retry);

    // After a successful retry the list (empty) replaces the error panel.
    expect(
      await screen.findByText(/no public alerts are currently available/i),
    ).toBeInTheDocument();
  });
});
