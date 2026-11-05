import { render, screen } from '@testing-library/react';
import type { PlaceGeoRow } from '@sentravyn/shared-types';
import type { PlaceSearchResult } from '@/lib/places-client';

/**
 * MapLibre's real bundle evaluates browser APIs (URL.createObjectURL, a
 * WebGL context) at import time, which jsdom does not provide. The tests
 * exercise only the DOM data layer (states + verification chips + no
 * fabricated data), and MapPanel guards the map init behind a WebGL check
 * that is false in jsdom — so the map is never actually constructed here.
 * A minimal stub stands in for the module; the canvas internals are
 * deliberately NOT tested (CLAUDE.md: don't over-test MapLibre).
 */
jest.mock('maplibre-gl', () => ({
  Map: class Map {
    on() {
      return this;
    }
    addSource() {}
    addLayer() {}
    getSource() {
      return null;
    }
    jumpTo() {}
    remove() {}
  },
  GeoJSONSource: class GeoJSONSource {},
}));

import { MapPanel } from '../MapPanel';

/**
 * Phase 4 map render tests (jsdom). We mount MapPanel and assert on the
 * DOM: the panel renders, the EMPTY state shows when there is no data, and a
 * mocked places payload renders a verificationLabel chip.
 *
 * The places client is mocked so a fixed payload drives the assertions.
 */

jest.mock('@/lib/places-client', () => ({
  searchPlacesNear: jest.fn(),
  getPlaceDetail: jest.fn(),
}));

import { searchPlacesNear } from '@/lib/places-client';

const mockedSearch = jest.mocked(searchPlacesNear);

function placeRow(overrides: Partial<PlaceGeoRow> = {}): PlaceGeoRow {
  return {
    id: 'place-1',
    name: 'Riverside General Hospital',
    kind: 'hospital',
    verification: 'VERIFIED',
    operationalStatus: 'Open',
    operationalEvidence: 'Daily',
    staleSince: null,
    lat: 51.5074,
    lng: -0.1278,
    distanceMeters: 445,
    verificationLabel: 'VERIFIED',
    verificationLabelReasons: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockedSearch.mockReset();
});

describe('MapPanel', () => {
  it('mounts the map section and shows the empty state with no data', async () => {
    // No places in range: the client wrapper resolves to zero items.
    const empty: PlaceSearchResult = {
      items: [],
      moreAvailable: false,
      coverageNote:
        'a map listing is not proof that a place is open, safe or operational',
      fetchedAt: new Date().toISOString(),
    };
    mockedSearch.mockResolvedValue(empty);

    render(<MapPanel />);

    // The section (a labelled <section> is exposed as role "region") and its
    // title are present (the panel mounts).
    expect(
      screen.getByRole('region', { name: /emergency map/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /emergency map/i }),
    ).toBeInTheDocument();

    // The fetch resolves to "ready" with zero items -> the empty state, not a
    // fabricated list.
    const emptyState = await screen.findByText(
      /No reviewed places in this area yet/i,
    );
    expect(emptyState).toBeInTheDocument();
    // The honest "coverage is not complete" wording must be present.
    expect(screen.getByText(/Coverage is not complete/i)).toBeInTheDocument();
  });

  it('renders a verificationLabel chip from a mocked places payload', async () => {
    // One place with a non-plain label: the chip must show the TEXT label
    // (colour is never the only signal, so assert on the visible text).
    const result: PlaceSearchResult = {
      items: [
        placeRow({
          id: 'shelter-1',
          name: 'Community Shelter',
          kind: 'shelter',
          verificationLabel: 'STALE',
          verificationLabelReasons: [
            'shelter verification is older than the 30-day revalidation window',
          ],
          distanceMeters: 820,
        }),
        placeRow({
          id: 'hospital-2',
          name: 'St. Mary Clinic',
          kind: 'clinic',
          verificationLabel: 'EXPIRED',
          distanceMeters: 1300,
        }),
      ],
      moreAvailable: false,
      coverageNote: null,
      fetchedAt: new Date().toISOString(),
    };
    mockedSearch.mockResolvedValue(result);

    render(<MapPanel />);

    // Both places' names render from the payload.
    expect(await screen.findByText('Community Shelter')).toBeInTheDocument();
    expect(screen.getByText('St. Mary Clinic')).toBeInTheDocument();

    // The verification chip text is present for each state. A "STALE" place
    // must read "Stale" and "EXPIRED" must read "Expired" — the label is
    // data-driven, not invented.
    const staleChips = screen.getAllByTestId('chip-STALE');
    expect(staleChips.length).toBeGreaterThanOrEqual(1);
    const expiredChips = screen.getAllByTestId('chip-EXPIRED');
    expect(expiredChips.length).toBeGreaterThanOrEqual(1);
    // A verification chip literally contains the human-readable label.
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();

    // Distance is shown with the mandatory "calculation, not a safety
    // recommendation" wording (it appears once per place with a distance).
    const distanceNotes = screen.getAllByText(
      /a calculation, not a safety recommendation/i,
    );
    expect(distanceNotes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the error state with a retry control on fetch failure', async () => {
    mockedSearch.mockRejectedValue(
      new Error('The SENTRAVYN API could not be reached.'),
    );

    render(<MapPanel />);

    const errorHeading = await screen.findByRole('heading', {
      name: /Could not load places/i,
    });
    expect(errorHeading).toBeInTheDocument();
    // Every control must work: a Retry control is present and labelled.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
