// The Northeast 115 tracker: progress, a topographic map and a sortable, filterable table of the peaks
// (_data/ne115.yml, read by src/lib/ne115.ts). The table and totals are rendered with the page, so they
// read fine without JavaScript. Once it runs, the filters and sorting work, and the map loads (Leaflet is
// only fetched when this is on screen). The map shows exactly the peaks the table shows.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, CircleMarker, LayerGroup } from 'leaflet';
import type { Peak } from '../lib/ne115';
import 'leaflet/dist/leaflet.css';
import './NE115Tracker.css';

type Status = Peak['status'];
type SortKey = 'name' | 'state' | 'list' | 'park' | 'elevation' | 'miles' | 'gain' | 'trail' | 'status';

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Peak' },
  { key: 'state', label: 'State' },
  { key: 'list', label: 'List' },
  { key: 'park', label: 'Park / forest' },
  { key: 'elevation', label: 'Elevation (ft)', numeric: true },
  { key: 'miles', label: 'Length (mi)', numeric: true },
  { key: 'gain', label: 'Gain (ft)', numeric: true },
  { key: 'trail', label: 'Trail' },
  { key: 'status', label: 'Status' },
];

const STATES: Record<Peak['state'], string> = { NH: 'New Hampshire', NY: 'New York', ME: 'Maine', VT: 'Vermont' };

const INTEGER = new Intl.NumberFormat('en-US');
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const statusText = (peak: Peak) =>
  peak.status === 'hiked' ? (peak.date ? `Hiked ${formatDate(peak.date)}` : 'Hiked') : 'To hike';

function compare(a: Peak, b: Peak, key: SortKey): number {
  const x = a[key];
  const y = b[key];
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), 'en');
}

interface Filters {
  search: string;
  status: '' | Status;
  state: '' | Peak['state'];
  list: string;
  park: string;
  trail: '' | Peak['trail'];
}

const NO_FILTERS: Filters = { search: '', status: '', state: '', list: '', park: '', trail: '' };

function matches(peak: Peak, f: Filters): boolean {
  if (f.status && peak.status !== f.status) return false;
  if (f.state && peak.state !== f.state) return false;
  if (f.list && peak.list !== f.list) return false;
  if (f.park && peak.park !== f.park) return false;
  if (f.trail && peak.trail !== f.trail) return false;
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const haystack = `${peak.name} ${peak.range} ${peak.park} ${peak.route} ${STATES[peak.state]}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

function popupHtml(peak: Peak): string {
  return (
    `<div class="ne-popup"><strong>${escapeHtml(peak.name)}</strong>` +
    `<span>${INTEGER.format(peak.elevation)} ft · ${escapeHtml(STATES[peak.state])}</span>` +
    `<span>${escapeHtml(peak.park)}</span>` +
    `<span>${escapeHtml(peak.route)}: about ${peak.miles} mi, ${INTEGER.format(peak.gain)} ft of climbing</span>` +
    (peak.also ? `<span class="ne-popup-also">${escapeHtml(peak.also)}</span>` : '') +
    `<em>${escapeHtml(statusText(peak))}</em></div>`
  );
}

const markerStyle = (peak: Peak, selected: boolean) => ({
  radius: selected ? 9 : 6,
  weight: selected ? 3 : 2,
  color: peak.status === 'hiked' ? '#fff' : '#983c2e',
  fillColor: peak.status === 'hiked' ? '#6e332d' : '#fff',
  fillOpacity: 1,
});

export default function NE115Tracker({ peaks }: { peaks: Peak[] }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'elevation', descending: true });
  const [selected, setSelected] = useState<string | null>(null);

  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const selectedFromMap = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const total = peaks.length;
  const hiked = peaks.filter((p) => p.status === 'hiked').length;

  const lists = useMemo(() => {
    const names = [...new Set(peaks.map((p) => p.list))];
    return names.map((name) => {
      const inList = peaks.filter((p) => p.list === name);
      return { name, total: inList.length, hiked: inList.filter((p) => p.status === 'hiked').length };
    });
  }, [peaks]);
  const parks = useMemo(() => [...new Set(peaks.map((p) => p.park))].sort((a, b) => a.localeCompare(b, 'en')), [peaks]);

  const rows = useMemo(() => {
    const direction = sort.descending ? -1 : 1;
    return peaks
      .filter((p) => matches(p, filters))
      .sort((a, b) => compare(a, b, sort.key) * direction || a.name.localeCompare(b.name, 'en'));
  }, [peaks, filters, sort]);

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  // Build the map once the component is on screen
  useEffect(() => {
    const element = mapElement.current;
    if (!element) return;
    let cancelled = false;
    let instance: LeafletMap | undefined;
    (async () => {
      const L = await import('leaflet');
      if (cancelled) return;
      instance = L.map(element, { scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 5 });
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      }).addTo(instance);
      const group = L.layerGroup().addTo(instance);
      for (const peak of peaks) {
        const marker = L.circleMarker([peak.lat, peak.lon], markerStyle(peak, false)).bindPopup(popupHtml(peak));
        marker.on('click', () => {
          selectedFromMap.current = true;
          setSelected(peak.name);
        });
        // Opening another peak's popup closes this one; only deselect if it is still the selected peak
        marker.on('popupclose', () => setSelected((current) => (current === peak.name ? null : current)));
        markers.current.set(peak.name, marker);
      }
      map.current = instance;
      layer.current = group;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      layer.current = null;
      markers.current.clear();
      setMapReady(false);
    };
  }, [peaks]);

  // The map shows the peaks in the table, framed to fit
  useEffect(() => {
    const group = layer.current;
    const instance = map.current;
    if (!mapReady || !group || !instance) return;
    group.clearLayers();
    const points: [number, number][] = [];
    for (const peak of rows) {
      const marker = markers.current.get(peak.name);
      if (!marker) continue;
      marker.setStyle(markerStyle(peak, peak.name === selected));
      group.addLayer(marker);
      points.push([peak.lat, peak.lon]);
    }
    if (points.length) instance.fitBounds(points, { padding: [30, 30], maxZoom: 12, animate: false });
    // Only the filters should reframe the map, not the selection or the sort order
  }, [mapReady, filters, peaks]);

  // Keep the layer in step with sorting (same peaks), and show which one is selected
  useEffect(() => {
    for (const peak of peaks) markers.current.get(peak.name)?.setStyle(markerStyle(peak, peak.name === selected));
    const instance = map.current;
    if (!mapReady || !instance || !selected) return;
    const peak = peaks.find((p) => p.name === selected);
    const marker = markers.current.get(selected);
    if (!peak || !marker) return;
    marker.bringToFront();
    if (selectedFromMap.current) {
      selectedFromMap.current = false;
      document.getElementById(rowId(selected))?.scrollIntoView({ block: 'nearest' });
      return;
    }
    instance.setView([peak.lat, peak.lon], Math.max(instance.getZoom(), 11), { animate: true });
    marker.openPopup();
  }, [selected, mapReady, peaks]);

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, descending: !s.descending } : { key, descending: key === 'elevation' || key === 'gain' || key === 'miles' }));

  const select = (peak: Peak) => {
    selectedFromMap.current = false;
    setSelected(peak.name);
    mapElement.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return (
    <figure className="diagram ne">
      <figcaption>
        <strong>Northeast 115 tracker</strong>
        <span>
          {hiked} of {total} peaks hiked. Filter or sort the table, or tap a peak on the map.
        </span>
      </figcaption>

      <div className="ne-progress" role="img" aria-label={`${hiked} of ${total} peaks hiked`}>
        <div className="ne-progress-bar">
          <div className="ne-progress-fill" style={{ width: `${(hiked / total) * 100}%` }} />
        </div>
        <ul className="ne-lists">
          {lists.map((l) => (
            <li key={l.name}>
              <strong>{l.hiked}</strong>/{l.total} <span>{l.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ne-map-frame">
        <div ref={mapElement} className="ne-map" role="region" aria-label="Map of the peaks in the table" />
        <ul className="ne-legend" aria-label="Map key">
          <li>
            <span className="ne-dot ne-dot-hiked" /> Hiked
          </li>
          <li>
            <span className="ne-dot" /> To hike
          </li>
        </ul>
      </div>

      <form className="ne-filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter the peaks">
        <label className="ne-search">
          <span>Search</span>
          <input
            type="search"
            value={filters.search}
            placeholder="Peak, range, trail…"
            onChange={(e) => setFilter('search', e.target.value)}
          />
        </label>
        <label>
          <span>Status</span>
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value as Filters['status'])}>
            <option value="">All</option>
            <option value="hiked">Hiked</option>
            <option value="to-hike">To hike</option>
          </select>
        </label>
        <label>
          <span>State</span>
          <select value={filters.state} onChange={(e) => setFilter('state', e.target.value as Filters['state'])}>
            <option value="">All</option>
            {Object.entries(STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>List</span>
          <select value={filters.list} onChange={(e) => setFilter('list', e.target.value)}>
            <option value="">All</option>
            {lists.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Park / forest</span>
          <select value={filters.park} onChange={(e) => setFilter('park', e.target.value)}>
            <option value="">All</option>
            {parks.map((park) => (
              <option key={park} value={park}>
                {park}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Trail</span>
          <select value={filters.trail} onChange={(e) => setFilter('trail', e.target.value as Filters['trail'])}>
            <option value="">All</option>
            <option value="marked">Marked trail</option>
            <option value="unmarked">Herd path or bushwhack</option>
          </select>
        </label>
        <button type="button" className="ne-reset" disabled={!filtered} onClick={() => setFilters(NO_FILTERS)}>
          Reset
        </button>
      </form>

      <p className="ne-count" role="status">
        Showing {rows.length} of {total} peaks
      </p>

      <p className="ne-hint">Scroll the table sideways for more columns.</p>

      <div className="ne-table-wrap" tabIndex={0} role="region" aria-label="Peaks table">
        <table className="ne-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'ne-num' : undefined}
                    aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                  >
                    <button type="button" onClick={() => sortBy(column.key)}>
                      {column.label}
                      <span aria-hidden="true" className="ne-arrow">
                        {active ? (sort.descending ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((peak) => (
              <tr
                key={peak.name}
                id={rowId(peak.name)}
                className={`${peak.status === 'hiked' ? 'ne-hiked' : ''}${peak.name === selected ? ' ne-selected' : ''}`}
              >
                <th scope="row">
                  <button type="button" className="ne-peak" onClick={() => select(peak)} title="Show on the map">
                    {peak.name}
                  </button>
                  <small>{peak.range}</small>
                  <small className="ne-route">{peak.route}</small>
                </th>
                <td>{peak.state}</td>
                <td>{peak.list}</td>
                <td className="ne-park">{peak.park}</td>
                <td className="ne-num">{INTEGER.format(peak.elevation)}</td>
                <td className="ne-num">{peak.miles}</td>
                <td className="ne-num">{INTEGER.format(peak.gain)}</td>
                <td>{peak.trail === 'marked' ? 'Marked' : 'Herd path'}</td>
                <td>
                  <span className={`ne-status ne-status-${peak.status}`}>{peak.status === 'hiked' ? 'Hiked' : 'To hike'}</span>
                  {peak.date && <small>{formatDate(peak.date)}</small>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="ne-empty">
                  No peaks match those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="diagram-note">
        Lengths are round trip and gain is feet of climbing for one standard route; both are approximate, and routes
        that share a ridge are listed in full for each peak, so don't add them up.
      </p>
    </figure>
  );
}

const rowId = (name: string) => `ne115-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
