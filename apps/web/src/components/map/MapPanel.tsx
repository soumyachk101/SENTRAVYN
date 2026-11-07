'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Map,
  GeoJSONSource,
  type StyleSpecification,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  PlaceGeoRow,
  PlaceDetail,
  VerificationLabel,
} from '@sentravyn/shared-types';
import {
  DEV_ONLY_TILE_NOTICE,
  DISTANCE_DISCLAIMER,
  LEGEND_CATEGORIES,
  OSM_ATTRIBUTION,
  OSM_TILES,
  categoryForKind,
  formatDistance,
  toPlaceGeoJSON,
  verificationChip,
} from '@/lib/map';
import { getPlaceDetail, searchPlacesNear } from '@/lib/places-client';

/**
 * The Phase 4 place-discovery map. Manual centre + radius only; no geolocation
 * (ADR-017 / SECURITY.md 5). Every data-driven view has a state: loading,
 * empty, error, stale and offline are all handled (CLAUDE.md rule 10).
 * Colour is never the only signal for a verification state — each chip
 * carries a text label (DESIGN.md 3 / SAFETY-POLICY.md 8).
 */

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      items: PlaceGeoRow[];
      fetchedAt: string;
      moreAvailable: boolean;
      coverageNote: string | null;
    }
  | { status: 'error'; message: string };

/** A small set of manually selectable centres (no device location). */
const CENTRE_PRESETS: { label: string; lat: number; lng: number }[] = [
  { label: 'London', lat: 51.5074, lng: -0.1278 },
  { label: 'New York', lat: 40.7128, lng: -74.006 },
  { label: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { label: 'Nairobi', lat: -1.2863, lng: 36.8172 },
  { label: 'Bogotá', lat: 4.711, lng: -74.0721 },
  { label: 'Sydney', lat: -33.8688, lng: 151.2093 },
];

const DEFAULT_CENTER = CENTRE_PRESETS[0];
const RADIUS_OPTIONS = [
  { label: '1 km', meters: 1000 },
  { label: '5 km', meters: 5000 },
  { label: '25 km', meters: 25000 },
  { label: '100 km', meters: 100000 },
  { label: '500 km', meters: 500000 },
];

export function MapPanel() {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [radius, setRadius] = useState(5000);
  const [kind, setKind] = useState<string>('all');
  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const [selected, setSelected] = useState<PlaceGeoRow | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState<
    Record<string, boolean>
  >(() => Object.fromEntries(LEGEND_CATEGORIES.map((c) => [c.id, true])));

  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapReadyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // MapLibre processes the inline style asynchronously after `new Map`;
  // addSource/addLayer throw "Style is not done loading" until it completes.
  // Layer setup is gated on this flag so the marker effect only runs once
  // the style is usable.
  const [styleReady, setStyleReady] = useState(false);
  // The marker-click handler reads the current items through a ref so the
  // once-only init effect never captures a stale closure.
  const itemsRef = useRef<PlaceGeoRow[]>([]);

  // Open a place's detail. Reads `selected`/`detail` functionally so a
  // failed detail fetch never discards the row already shown. Stable across
  // renders (all setters are stable + module import), so the once-only
  // marker-click handler can capture it directly without a ref.
  const openDetail = useCallback(async (place: PlaceGeoRow) => {
    setSelected(place);
    setDetail(null);
    setSheetOpen(true);
    try {
      const d = await getPlaceDetail(place.id);
      setDetail(d);
    } catch {
      // Detail fetch failed: the list row already carries its verification
      // label; the panel shows the row and the failure is non-fatal.
      setDetail(null);
    }
  }, []);

  // Offline detection (rule 10): a data-driven view must show an offline
  // state. `useSyncExternalStore` reads navigator.onLine without a
  // set-state-in-effect (the idiom the footer/footwork uses). SSR snapshot
  // assumes online.
  const isOnline = useSyncExternalStore(
    (onStoreChange) => {
      const onUp = () => onStoreChange();
      const onDown = () => onStoreChange();
      window.addEventListener('online', onUp);
      window.addEventListener('offline', onDown);
      return () => {
        window.removeEventListener('online', onUp);
        window.removeEventListener('offline', onDown);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const offline = !isOnline;

  // Run the radius search whenever the query changes. Aborts the in-flight
  // request so a stale response can never overwrite a newer one.
  const runSearch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading' });
    setSelected(null);
    setDetail(null);
    setSheetOpen(false);
    try {
      const result = await searchPlacesNear(
        { lat: center.lat, lng: center.lng },
        radius,
        kind === 'all' ? undefined : kind,
      );
      if (controller.signal.aborted) return;
      setState({
        status: 'ready',
        items: result.items,
        fetchedAt: result.fetchedAt,
        moreAvailable: result.moreAvailable,
        coverageNote: result.coverageNote,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'The API could not be reached.';
      setState({ status: 'error', message });
    }
  }, [center.lat, center.lng, radius, kind]);

  // Re-run the search when the query changes (or when connectivity returns).
  // While offline, MapBody renders the offline state first (it checks
  // `offline` before the fetch state), so there is nothing to fetch here —
  // and forcing the fetch state would be a set-state-in-effect, so we don't.
  // The async run is routed through a locally declared closure to satisfy
  // react-hooks/set-state-in-effect (matching the AuthPanel idiom).
  useEffect(() => {
    if (offline) return;
    const begin = () => {
      void runSearch();
    };
    begin();
    return () => abortRef.current?.abort();
  }, [runSearch, offline]);

  // Initialise MapLibre once the container is mounted. Guarded so a missing
  // WebGL context (or a jsdom test) leaves the panel usable: the data UI,
  // legend and states render regardless of whether the map canvas boots.
  useEffect(() => {
    if (mapReadyRef.current || !containerRef.current) return;
    if (typeof window === 'undefined' || !('WebGLRenderingContext' in window)) {
      // No 2D/3D canvas support: the panel still works as a data view.
      return;
    }
    try {
      const map = new Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [OSM_TILES],
              tileSize: 256,
              attribution: OSM_ATTRIBUTION,
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        } as StyleSpecification,
        center: [center.lng, center.lat],
        zoom: 10,
      });
      // No animated fly-to: centre changes use an instant setView, which
      // respects reduced motion and is calmer for everyone (DESIGN.md 4).
      // Markers are drawn via the "places" geojson source below; clicking a
      // circle layer opens that place's detail.
      mapRef.current = map;
      mapReadyRef.current = true;
      // The marker layer can only be added once the inline style is done
      // processing; `load` fires exactly then.
      map.on('load', () => {
        setStyleReady(true);
      });
      return () => {
        map.remove();
        mapRef.current = null;
        mapReadyRef.current = false;
        setStyleReady(false);
      };
    } catch {
      // Canvas unavailable (e.g. headless): the data panel still works.
    }
    // Only initialise with the first centre; subsequent moves use setView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push a chosen centre to the map immediately: jumpTo is an instant,
  // non-animated move, which respects reduced motion for everyone
  // (DESIGN.md 4; no fly-to).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({ center: [center.lng, center.lat], zoom: 10 });
  }, [center.lat, center.lng]);

  // Draw place markers per category. A layer per category so each can be
  // toggled independently. Clicking a marker opens that place's detail.
  // Gated on `styleReady` (the map's `load` event) because addSource/
  // addLayer throw "Style is not done loading" until the inline style has
  // finished processing after `new Map`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const items = state.status === 'ready' ? state.items : [];
    itemsRef.current = items;
    const visible = items.filter(
      (p) => visibleCategories[categoryForKind(p.kind).id] ?? true,
    );
    const data = toPlaceGeoJSON(visible);
    if (!map.getSource('places')) {
      map.addSource('places', { type: 'geojson', data });
      for (const cat of LEGEND_CATEGORIES) {
        map.addLayer({
          id: `places-${cat.id}`,
          type: 'circle',
          source: 'places',
          filter: ['==', ['get', 'categoryId'], cat.id],
          paint: {
            'circle-radius': 6,
            'circle-color': cat.color,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#101418',
          },
        });
        // A marker click opens that place's detail (rule 9: every control works).
        map.on('click', `places-${cat.id}`, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          const id = (f?.properties as { id?: string } | undefined)?.id;
          if (!id) return;
          const target = itemsRef.current.find((p) => p.id === id);
          if (target) void openDetail(target);
        });
      }
    } else {
      const src = map.getSource('places') as GeoJSONSource | undefined;
      src?.setData(data);
    }
  }, [
    state,
    visibleCategories,
    center.lat,
    center.lng,
    openDetail,
    styleReady,
  ]);

  // A stale/unknown state is conveyed per-place by the API's verificationLabel
  // (STALE / EXPIRED / INCOMPLETE) and the staleSince field — the API is the
  // authority (SAFETY-POLICY.md 8), so the surface does not invent its own
  // staleness threshold here.
  return (
    <section className="map-panel" aria-label="Emergency map">
      <header className="map-panel__head">
        <div>
          <h2 className="map-panel__title">Emergency map</h2>
          <p className="map-panel__sub">
            Places by category with their verification state. Distance is a
            calculation, never a safety call.
          </p>
        </div>
        <div className="map-panel__tile-notice" aria-live="polite">
          <span className="map-panel__tile-badge">dev-only tiles</span>
          <p className="map-panel__tile-note">{DEV_ONLY_TILE_NOTICE}</p>
          <p className="map-panel__tile-note">{OSM_ATTRIBUTION}</p>
        </div>
      </header>

      <div className="map-panel__grid">
        <div
          className="map-panel__controls"
          role="group"
          aria-label="Map controls"
        >
          {/* Centre selection — manual only, no geolocation. */}
          <fieldset className="map-panel__field">
            <legend>Centre</legend>
            <div className="map-panel__centres">
              {CENTRE_PRESETS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="map-panel__centre"
                  aria-pressed={c.label === center.label}
                  onClick={() =>
                    setCenter({ lat: c.lat, lng: c.lng, label: c.label })
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="map-panel__field">
            <legend>Radius</legend>
            <div className="map-panel__radii" role="group">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.meters}
                  type="button"
                  className="map-panel__radius"
                  aria-pressed={r.meters === radius}
                  onClick={() => setRadius(r.meters)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="map-panel__field">
            <legend>Category filter</legend>
            <div className="map-panel__kind">
              <button
                type="button"
                className="map-panel__kind"
                aria-pressed={kind === 'all'}
                onClick={() => setKind('all')}
              >
                All
              </button>
              {LEGEND_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="map-panel__kind"
                  aria-pressed={kind === c.id}
                  onClick={() => setKind(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Legend with per-category visibility toggles. */}
          <fieldset className="map-panel__field">
            <legend>Legend</legend>
            <ul className="map-panel__legend" aria-label="Map legend">
              {LEGEND_CATEGORIES.map((c) => (
                <li key={c.id} className="map-panel__legend-item">
                  <input
                    id={`legend-${c.id}`}
                    type="checkbox"
                    checked={visibleCategories[c.id] ?? true}
                    onChange={(e) =>
                      setVisibleCategories((prev) => ({
                        ...prev,
                        [c.id]: e.target.checked,
                      }))
                    }
                  />
                  <span
                    className="map-panel__swatch"
                    style={{ backgroundColor: c.color }}
                    aria-hidden="true"
                  />
                  <label htmlFor={`legend-${c.id}`}>{c.label}</label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>

        <div className="map-panel__stage">
          <div
            ref={containerRef}
            className="map-panel__canvas"
            role="img"
            aria-label="Map of emergency services. Use the controls to choose a centre and radius."
          />
          <MapBody
            state={state}
            offline={offline}
            radiusMeters={radius}
            center={center.label ?? ''}
            onRetry={() => void runSearch()}
            onSelect={openDetail}
            visibleCategories={visibleCategories}
          />
        </div>
      </div>

      <PlaceDetailSheet
        place={selected}
        detail={detail}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setSelected(null);
          setDetail(null);
        }}
      />
    </section>
  );
}

/**
 * The data layer of the panel: loading / empty / error / stale / offline and
 * the place list with verification chips. Rendered regardless of whether the
 * map canvas booted, so the surface is usable (and jsdom-testable) without
 * WebGL.
 */
export function MapBody({
  state,
  offline,
  radiusMeters,
  center,
  onRetry,
  onSelect,
  visibleCategories,
}: {
  state: FetchState;
  offline: boolean;
  radiusMeters: number;
  center: string;
  onRetry: () => void;
  onSelect: (p: PlaceGeoRow) => void;
  visibleCategories: Record<string, boolean>;
}) {
  if (offline) {
    return (
      <div className="map-panel__state map-panel__state--offline" role="status">
        <h3>You appear to be offline</h3>
        <p>
          Place data is fetched from the SENTRAVYN API. Reconnect to continue.
        </p>
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="map-panel__state" role="status" aria-live="polite">
        <h3>Searching places…</h3>
        <p>
          Finding places within {formatDistance(radiusMeters)} of{' '}
          {center || 'the centre'}.
        </p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="map-panel__state map-panel__state--error" role="alert">
        <h3>Could not load places</h3>
        <p>{state.message}</p>
        <button type="button" className="map-panel__retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (state.status === 'idle') {
    return (
      <div className="map-panel__state" role="status">
        <h3>Choose a centre and radius</h3>
        <p>Select a centre and a radius to search for nearby places.</p>
      </div>
    );
  }

  const items = state.items.filter(
    (p) => visibleCategories[categoryForKind(p.kind).id] ?? true,
  );
  if (items.length === 0) {
    return (
      <div className="map-panel__state map-panel__state--empty" role="status">
        <h3>No reviewed places in this area yet</h3>
        <p>
          Coverage is not complete. A missing listing does not mean a service
          does not exist — it means it is not yet in SENTRAVYN.
        </p>
        {state.coverageNote && (
          <p className="map-panel__coverage-note">{state.coverageNote}</p>
        )}
      </div>
    );
  }

  return (
    <div className="map-panel__results">
      <p className="map-panel__results-meta">
        {items.length} place{items.length === 1 ? '' : 's'} in range
        {state.moreAvailable ? ' (more available, showing the first 200)' : ''}
      </p>
      <p className="map-panel__results-meta" aria-label="Data timestamp">
        fetched {state.fetchedAt}
      </p>
      <ul className="map-panel__list">
        {items.map((p) => (
          <PlaceRow key={p.id} place={p} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

function PlaceRow({
  place,
  onSelect,
}: {
  place: PlaceGeoRow;
  onSelect: (p: PlaceGeoRow) => void;
}) {
  const cat = categoryForKind(place.kind);
  const showDistance = place.distanceMeters != null;
  return (
    <li className="map-panel__item">
      <button
        type="button"
        className="map-panel__item-btn"
        onClick={() => onSelect(place)}
        title={verificationChip(place.verificationLabel).meaning}
      >
        <span className="map-panel__item-name">{place.name}</span>
        <span className="map-panel__item-cat" style={{ color: cat.color }}>
          {cat.label}
        </span>
        <VerificationLabelChip label={place.verificationLabel} />
        {showDistance && (
          <span className="map-panel__item-dist">
            {formatDistance(place.distanceMeters as number)} —{' '}
            {DISTANCE_DISCLAIMER}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * A verification-state chip: text label required, colour is a supporting
 * signal only (DESIGN.md 3 / SAFETY-POLICY.md 8).
 */
export function VerificationLabelChip({
  label,
  title,
}: {
  label: VerificationLabel;
  title?: string;
}) {
  const chip = verificationChip(label);
  return (
    <span
      className="map-panel__chip"
      style={{ borderColor: chip.color, color: chip.color }}
      title={title ?? chip.meaning}
      data-verification={label}
      data-testid={`chip-${label}`}
    >
      <span
        className="map-panel__chip-dot"
        style={{ backgroundColor: chip.color }}
        aria-hidden="true"
      />
      {chip.label}
    </span>
  );
}

/**
 * The mobile bottom-sheet / detail panel. On small screens it is a bottom
 * sheet; on larger screens it is a side detail card. Carries the full
 * PlaceDetail (shelter profiles + evidence + reasons) when available.
 */
export function PlaceDetailSheet({
  place,
  detail,
  open,
  onClose,
}: {
  place: PlaceGeoRow | null;
  detail: PlaceDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !place) return null;
  const chip = verificationChip(place.verificationLabel);
  return (
    <div
      className="map-panel__sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Place detail"
    >
      <div className="map-panel__sheet-head">
        <div>
          <h3 className="map-panel__sheet-title">{place.name}</h3>
          <div className="map-panel__sheet-chips">
            <VerificationLabelChip
              label={place.verificationLabel}
              title={chip.meaning}
            />
          </div>
        </div>
        <button
          type="button"
          className="map-panel__sheet-close"
          onClick={onClose}
          aria-label="Close"
        >
          Close
        </button>
      </div>

      <dl className="map-panel__sheet-dl">
        <div>
          <dt>Category</dt>
          <dd>{categoryForKind(place.kind).label}</dd>
        </div>
        {place.distanceMeters != null && (
          <div>
            <dt>Distance</dt>
            <dd>
              {formatDistance(place.distanceMeters)} — {DISTANCE_DISCLAIMER}
            </dd>
          </div>
        )}
        {place.staleSince && (
          <div>
            <dt>Flagged stale since</dt>
            <dd>{new Date(place.staleSince).toLocaleDateString()}</dd>
          </div>
        )}
      </dl>

      {(detail?.verificationLabelReasons?.length ?? 0) > 0 && (
        <div className="map-panel__reasons">
          <h4>Why this label</h4>
          <ul>
            {detail!.verificationLabelReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.shelterProfiles.length > 0 && (
        <div className="map-panel__shelters">
          <h4>Shelter profiles</h4>
          <ul>
            {detail.shelterProfiles.map((s) => (
              <li key={s.id}>
                {s.classification ?? 'Shelter'} — verification {s.verification}
                {s.expiresAt
                  ? `, expires ${new Date(s.expiresAt).toLocaleDateString()}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && detail.evidence.length > 0 && (
        <div className="map-panel__evidence">
          <h4>Recorded evidence</h4>
          <ul>
            {detail.evidence.map((e) => (
              <li key={e.id}>
                {e.claim}
                {e.recordedByUserId ? ' (user submission)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="map-panel__disclaimer">
        A nearby place is not automatically a safe shelter. Distance shown is{' '}
        {DISTANCE_DISCLAIMER}.
      </p>
    </div>
  );
}
