/**
 * Jest stub for `maplibre-gl` (unit tests only — never bundled into the app).
 *
 * maplibre-gl 6.x ships an ESM-only entry, which the CJS jest resolver cannot
 * load. MapPanel guards real map construction behind a WebGL check that is
 * false under jsdom, so the DOM data layer (states + verification chips) is
 * testable without the real canvas bundle. This stub satisfies module
 * resolution; the MapPanel test additionally registers an inline jest.mock
 * factory that overrides these classes for its own assertions.
 */

class Map {
  on() {
    return this;
  }
  off() {
    return this;
  }
  addSource() {}
  addLayer() {}
  getSource() {
    return null;
  }
  jumpTo() {}
  remove() {}
}

class GeoJSONSource {
  setData() {}
}

export { Map, GeoJSONSource };

/* Type-only exports so type imports from the real package resolve under jest. */
export type StyleSpecification = Record<string, unknown>;
export type MapLayerMouseEvent = Record<string, unknown>;
