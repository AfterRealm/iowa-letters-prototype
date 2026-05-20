// Iowa Letters — Map view
//
// MapLibre GL JS reads letters.geojson and renders each letter as a Point
// styled by soldier (Hartwell = orange circle, Burroughs = blue square via
// the "letter-icons" sprite). Home counties render as a separate diamond
// layer. Connecting lines from each letter to its home county are an
// optional toggleable layer.
//
// Timeline scrubber filters by date. Sidebar list and map markers are
// bidirectional: clicking either side opens the popup and pans.
//
// In a later phase the page can switch from the static GeoJSON to a poll
// loop reading Omeka's REST API. That hook is the loadFeatures() function;
// swap its body for a fetch + transform.
(function () {
  'use strict';

  // Bail loudly if MapLibre didn't load — show a graceful fallback message.
  if (typeof maplibregl === 'undefined') {
    const status = document.getElementById('map-status');
    if (status) {
      status.dataset.visible = 'true';
      status.innerHTML = '<span class="status-title">Map library could not load</span>The MapLibre GL JS bundle did not load — check your network connection and reload the page.';
    }
    return;
  }

  // ─── Configuration ────────────────────────────────────────────────────────
  const GEOJSON_URL = '/data/letters.geojson';
  const GAZETTEER_URL = '/data/gazetteer.json';
  // Omeka REST root for the live poll. Items are public, no auth required
  // for read. Same hostname the authoring form writes to.
  const OMEKA_API = 'https://iowa.dev.01.ngrok.dev/api';
  const POLL_INTERVAL_MS = 12000;
  const INITIAL_VIEW = {
    center: [-87.0, 36.5], // mid-South, roughly centered on the war theater
    zoom: 4.2,
  };
  // OSM raster basemap — no token, library-grade open data. MapLibre style.
  const STYLE = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
    ],
  };

  // ─── State ────────────────────────────────────────────────────────────────
  const state = {
    map: null,
    features: [],          // current FeatureCollection.features
    selectedId: null,
    popup: null,
    minDate: null,         // ISO yyyy-mm-dd of earliest letter
    maxDate: null,
    currentDate: null,     // upper bound for the timeline filter
    showHomeLines: false,
    showHomeCounties: true,
    gazetteer: null,       // { byName: Map<string, place> }
    knownIds: new Set(),   // letter ids already on the map
    homeIndex: new Map(),  // id -> { home_canonical, home_id, home_lat, home_lon }
    pollTimer: null,
    pollFails: 0,
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function soldierKey(creator) {
    if (!creator) return 'other';
    if (/hartwell/i.test(creator)) return 'hartwell';
    if (/burroughs/i.test(creator)) return 'burroughs';
    return 'other';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[+m] || ''} ${+d}, ${y}`.trim();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPopupHTML(props) {
    return `
      <article aria-labelledby="popup-title-${props.id}">
        <h3 id="popup-title-${props.id}" class="popup-title">${escapeHtml(props.title)}</h3>
        <p class="popup-meta">
          ${escapeHtml(props.creator || '')} · ${fmtDate(props.date)}<br>
          ${escapeHtml(props.regiment || '')}${props.company ? ' · ' + escapeHtml(props.company) : ''}<br>
          To: ${escapeHtml(props.addressee || '')}
        </p>
        ${props.transcription ? `<p class="popup-transcription">&ldquo;${escapeHtml(props.transcription)}&rdquo;</p>` : ''}
        <a class="popup-link" href="/item.html?id=${encodeURIComponent(props.id)}">Open full item record &rarr;</a>
      </article>
    `;
  }

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('letter-list');
    if (!list) return;
    const sorted = [...state.features].sort((a, b) =>
      (a.properties.date || '').localeCompare(b.properties.date || '')
    );
    list.innerHTML = '';
    for (const feat of sorted) {
      const p = feat.properties;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.id = String(p.id);
      btn.setAttribute('aria-current', String(state.selectedId === p.id));
      btn.innerHTML = `
        <span class="lt-marker ${soldierKey(p.creator)}" aria-hidden="true"></span>
        <span class="lt-meta">
          <span class="lt-date">${fmtDate(p.date)}</span>
          <span class="lt-title">${escapeHtml(p.title)}</span>
          <span class="lt-place">From ${escapeHtml(p.place_canonical || '')}</span>
        </span>
      `;
      btn.addEventListener('click', () => selectFeature(p.id, { fly: true }));
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function updateSidebarCurrent() {
    document.querySelectorAll('#letter-list button').forEach((btn) => {
      btn.setAttribute('aria-current', String(Number(btn.dataset.id) === state.selectedId));
    });
  }

  // ─── Map layers ───────────────────────────────────────────────────────────
  function buildHomeFeatures() {
    // Distinct home anchors keyed by home_id.
    const seen = new Map();
    for (const feat of state.features) {
      const p = feat.properties;
      if (!p.home_id || p.home_lat == null || p.home_lon == null) continue;
      if (seen.has(p.home_id)) continue;
      seen.set(p.home_id, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.home_lon, p.home_lat] },
        properties: { home_id: p.home_id, home_canonical: p.home_canonical },
      });
    }
    return { type: 'FeatureCollection', features: [...seen.values()] };
  }

  function buildHomeLineFeatures() {
    const lines = [];
    for (const feat of state.features) {
      const p = feat.properties;
      if (p.home_lat == null || p.home_lon == null) continue;
      lines.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [feat.geometry.coordinates, [p.home_lon, p.home_lat]],
        },
        properties: { id: p.id, soldier: soldierKey(p.creator) },
      });
    }
    return { type: 'FeatureCollection', features: lines };
  }

  function dateInRange(iso) {
    if (!state.currentDate) return true;
    if (!iso) return true;
    return iso <= state.currentDate;
  }

  function filteredFeatures() {
    return state.features.filter((f) => dateInRange(f.properties.date));
  }

  function applyMapData() {
    const filtered = filteredFeatures();
    const fc = { type: 'FeatureCollection', features: filtered };
    if (state.map.getSource('letters')) state.map.getSource('letters').setData(fc);
    if (state.map.getSource('home-anchors')) state.map.getSource('home-anchors').setData(buildHomeFeatures());
    if (state.map.getSource('home-lines')) {
      const lineFc = {
        type: 'FeatureCollection',
        features: buildHomeLineFeatures().features.filter((f) =>
          filtered.some((ff) => ff.properties.id === f.properties.id)
        ),
      };
      state.map.getSource('home-lines').setData(lineFc);
    }
  }

  function addLayers() {
    state.map.addSource('letters', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    state.map.addSource('home-anchors', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    state.map.addSource('home-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    // Home → letter connecting lines (optional layer, off by default).
    state.map.addLayer({
      id: 'home-line-layer',
      type: 'line',
      source: 'home-lines',
      layout: { 'line-cap': 'round', visibility: state.showHomeLines ? 'visible' : 'none' },
      paint: {
        'line-color': [
          'match', ['get', 'soldier'],
          'hartwell', '#b85c38',
          'burroughs', '#2c5e7f',
          '#6da855',
        ],
        'line-width': 1.5,
        'line-opacity': 0.55,
        'line-dasharray': [2, 2],
      },
    });

    // Home county anchors — green diamonds.
    state.map.addLayer({
      id: 'home-anchor-layer',
      type: 'circle',
      source: 'home-anchors',
      layout: { visibility: state.showHomeCounties ? 'visible' : 'none' },
      paint: {
        'circle-radius': 7,
        'circle-color': '#6da855',
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 2,
      },
    });

    // Letter origins — Hartwell circles
    state.map.addLayer({
      id: 'letter-hartwell',
      type: 'circle',
      source: 'letters',
      filter: ['==', ['get', 'creator'], 'Jonathan Hartwell'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'id'], ['literal', null]], 8, 9],
        'circle-color': '#b85c38',
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 2,
      },
    });

    // Letter origins — Burroughs. Distinct visual signature via a thicker
    // "bullseye" double-ring stroke (color + ring pattern = redundant
    // encoding so the distinction holds under monochrome / colorblind view).
    state.map.addLayer({
      id: 'letter-burroughs-outer',
      type: 'circle',
      source: 'letters',
      filter: ['==', ['get', 'creator'], 'Elias Burroughs'],
      paint: {
        'circle-radius': 11,
        'circle-color': '#2c5e7f',
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 2,
      },
    });
    state.map.addLayer({
      id: 'letter-burroughs',
      type: 'circle',
      source: 'letters',
      filter: ['==', ['get', 'creator'], 'Elias Burroughs'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#f4ecd5',
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 1,
      },
    });

    // Catch-all for any other creators (e.g. authored letters added live).
    state.map.addLayer({
      id: 'letter-other',
      type: 'circle',
      source: 'letters',
      filter: ['all',
        ['!=', ['get', 'creator'], 'Jonathan Hartwell'],
        ['!=', ['get', 'creator'], 'Elias Burroughs'],
      ],
      paint: {
        'circle-radius': 8,
        'circle-color': '#7a6a4a',
        'circle-stroke-color': '#1a1410',
        'circle-stroke-width': 2,
      },
    });

    // Hover affordance
    for (const id of ['letter-hartwell', 'letter-burroughs-outer', 'letter-burroughs', 'letter-other']) {
      state.map.on('mouseenter', id, () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', id, () => { state.map.getCanvas().style.cursor = ''; });
      state.map.on('click', id, (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        selectFeature(f.properties.id, { fly: false });
      });
    }
  }

  // ─── Selection ────────────────────────────────────────────────────────────
  function selectFeature(id, opts = {}) {
    const feat = state.features.find((f) => f.properties.id === id);
    if (!feat) return;
    state.selectedId = id;
    updateSidebarCurrent();

    if (state.popup) state.popup.remove();
    state.popup = new maplibregl.Popup({ offset: 14, closeButton: true, closeOnClick: false })
      .setLngLat(feat.geometry.coordinates)
      .setHTML(buildPopupHTML(feat.properties))
      .addTo(state.map);

    if (opts.fly !== false) {
      state.map.flyTo({ center: feat.geometry.coordinates, zoom: Math.max(state.map.getZoom(), 5.5), speed: 0.9 });
    }
  }

  // ─── Timeline ─────────────────────────────────────────────────────────────
  function setupTimeline() {
    const slider = document.getElementById('timeline-slider');
    const readout = document.getElementById('timeline-readout');
    if (!slider || !readout) return;

    // Compute domain from the data.
    const dates = state.features
      .map((f) => f.properties.date)
      .filter(Boolean)
      .sort();
    if (!dates.length) return;
    state.minDate = dates[0];
    state.maxDate = dates[dates.length - 1];
    state.currentDate = state.maxDate;

    // Slider domain in days from minDate
    const minTs = new Date(state.minDate).getTime();
    const maxTs = new Date(state.maxDate).getTime();
    const days = Math.max(1, Math.round((maxTs - minTs) / 86400000));
    slider.min = '0';
    slider.max = String(days);
    slider.value = String(days);

    function updateFromSlider() {
      const v = Number(slider.value);
      const ts = minTs + v * 86400000;
      const iso = new Date(ts).toISOString().slice(0, 10);
      state.currentDate = iso;
      readout.textContent = `Through ${fmtDate(iso)}`;
      applyMapData();
    }
    slider.addEventListener('input', updateFromSlider);
    updateFromSlider();
  }

  // ─── Toggles ──────────────────────────────────────────────────────────────
  function setupToggles() {
    const lines = document.getElementById('toggle-home-lines');
    if (lines) {
      lines.checked = state.showHomeLines;
      lines.addEventListener('change', (e) => {
        state.showHomeLines = e.target.checked;
        if (state.map.getLayer('home-line-layer')) {
          state.map.setLayoutProperty('home-line-layer', 'visibility', state.showHomeLines ? 'visible' : 'none');
        }
      });
    }
    const homes = document.getElementById('toggle-home-counties');
    if (homes) {
      homes.checked = state.showHomeCounties;
      homes.addEventListener('change', (e) => {
        state.showHomeCounties = e.target.checked;
        if (state.map.getLayer('home-anchor-layer')) {
          state.map.setLayoutProperty('home-anchor-layer', 'visibility', state.showHomeCounties ? 'visible' : 'none');
        }
      });
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────────────
  async function loadFeatures() {
    const r = await fetch(GEOJSON_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not load ${GEOJSON_URL}: HTTP ${r.status}`);
    const fc = await r.json();
    if (!fc || !Array.isArray(fc.features)) throw new Error('GeoJSON shape invalid: no features array.');
    return fc.features;
  }

  async function loadGazetteer() {
    const r = await fetch(GAZETTEER_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Gazetteer load failed: HTTP ${r.status}`);
    const g = await r.json();
    const byName = new Map();
    for (const p of g.places || []) {
      byName.set(p.canonical.toLowerCase(), p);
      for (const a of p.aliases || []) byName.set(a.toLowerCase(), p);
    }
    return { byName, raw: g };
  }

  function lookupPlace(name) {
    if (!state.gazetteer || !name) return null;
    const key = name.trim().toLowerCase();
    if (state.gazetteer.byName.has(key)) return state.gazetteer.byName.get(key);
    const cleaned = key.replace(/^near\s+/, '');
    if (state.gazetteer.byName.has(cleaned)) return state.gazetteer.byName.get(cleaned);
    const head = cleaned.split(',', 1)[0].trim();
    if (state.gazetteer.byName.has(head)) return state.gazetteer.byName.get(head);
    return null;
  }

  function parseHomeFromAddressee(addr) {
    if (!addr) return null;
    const parts = addr.split(',').map((s) => s.trim());
    for (let i = 0; i < parts.length; i++) {
      if (/county/i.test(parts[i])) {
        const candidate = [parts[i], ...parts.slice(i + 1)].join(', ');
        const hit = lookupPlace(candidate);
        if (hit) return hit;
      }
    }
    return null;
  }

  // Transform an Omeka item record into a Feature matching letters.geojson shape.
  // The home-anchor data for the seed letters (ids 2-7) lives in the static
  // GeoJSON and is keyed by id in state.homeIndex; Omeka does not currently
  // store an addressee field, so we look the home up from the index rather
  // than parsing it back out of Omeka. (Future enhancement: add an Omeka
  // property for addressee and read it here.)
  function omekaItemToFeature(item) {
    const v = (key) => {
      const arr = item[key];
      return Array.isArray(arr) && arr.length ? arr[0]['@value'] : null;
    };
    const place = lookupPlace(v('dcterms:spatial'));
    if (!place) return null;
    const id = item['o:id'];
    const homeFromIndex = state.homeIndex.get(id);
    // Fallback: parse the addressee out of dcterms:description for new
    // letters authored via the public form, since add-letter posts addressee
    // text into the description bundle. Best-effort.
    let home = homeFromIndex || null;
    if (!home) {
      const addr = item.addressee || null;
      home = parseHomeFromAddressee(addr);
    }
    return {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
      properties: {
        id,
        title: v('dcterms:title'),
        creator: v('dcterms:creator'),
        date: v('dcterms:date'),
        regiment: item.regiment || null,
        company: item.company || null,
        addressee: item.addressee || null,
        place_canonical: place.canonical,
        place_id: place.id,
        theater: place.theater,
        home_canonical: home ? (home.canonical || home.home_canonical) : null,
        home_id: home ? (home.id || home.home_id) : null,
        home_lat: home ? (home.lat != null ? home.lat : home.home_lat) : null,
        home_lon: home ? (home.lon != null ? home.lon : home.home_lon) : null,
        transcription: v('dcterms:description'),
      },
    };
  }

  async function pollOmeka() {
    try {
      const r = await fetch(`${OMEKA_API}/items?per_page=100`, {
        cache: 'no-cache',
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      if (!r.ok) throw new Error(`Omeka returned HTTP ${r.status}`);
      const items = await r.json();
      const fresh = [];
      for (const item of items) {
        const feat = omekaItemToFeature(item);
        if (!feat) continue;
        fresh.push(feat);
      }
      mergeFeatures(fresh);
      state.pollFails = 0;
      hidePollStatus();
    } catch (e) {
      state.pollFails += 1;
      // Only surface a poll-failure banner after 3 consecutive misses, so a
      // single hiccup doesn't startle the visitor.
      if (state.pollFails >= 3) {
        showPollStatus(
          `Live updates paused (cannot reach Omeka). The map shows the last good snapshot. Latest error: ${e.message}`
        );
      }
    }
  }

  function mergeFeatures(fresh) {
    const incomingIds = new Set(fresh.map((f) => f.properties.id));
    const newFeatures = fresh.filter((f) => !state.knownIds.has(f.properties.id));

    // Replace state.features with the fresh union (Omeka is the source of
    // truth once polling starts). Preserves any client-only additions if
    // we ever introduce them, but for now this is a straight swap.
    state.features = fresh;
    for (const id of incomingIds) state.knownIds.add(id);

    applyMapData();
    renderSidebar();

    if (newFeatures.length) {
      // Animate the most recent new feature (highest id wins if multiple).
      const newest = newFeatures.reduce((a, b) =>
        (a.properties.id > b.properties.id ? a : b)
      );
      flashNewFeature(newest);
    }
  }

  function flashNewFeature(feat) {
    const [lon, lat] = feat.geometry.coordinates;
    state.map.flyTo({ center: [lon, lat], zoom: Math.max(state.map.getZoom(), 6), speed: 0.8 });

    // Add a transient pulse layer for ~2.5s
    const PULSE_SRC = 'pulse-src';
    const PULSE_LAYER = 'pulse-layer';
    const fc = { type: 'FeatureCollection', features: [feat] };
    if (state.map.getSource(PULSE_SRC)) {
      state.map.getSource(PULSE_SRC).setData(fc);
    } else {
      state.map.addSource(PULSE_SRC, { type: 'geojson', data: fc });
      state.map.addLayer({
        id: PULSE_LAYER,
        type: 'circle',
        source: PULSE_SRC,
        paint: {
          'circle-radius': 6,
          'circle-color': '#e5b94a',
          'circle-opacity': 0.55,
          'circle-stroke-color': '#e5b94a',
          'circle-stroke-width': 0,
          'circle-stroke-opacity': 0.55,
        },
      });
    }

    // Animate the radius from 6 to 36 then fade out.
    const start = performance.now();
    const DURATION = 2400;
    function tick(now) {
      const t = Math.min(1, (now - start) / DURATION);
      if (state.map.getLayer(PULSE_LAYER)) {
        state.map.setPaintProperty(PULSE_LAYER, 'circle-radius', 6 + t * 30);
        state.map.setPaintProperty(PULSE_LAYER, 'circle-opacity', 0.55 * (1 - t));
        state.map.setPaintProperty(PULSE_LAYER, 'circle-stroke-width', 2 + t * 4);
        state.map.setPaintProperty(PULSE_LAYER, 'circle-stroke-opacity', 0.55 * (1 - t));
      }
      if (t < 1) requestAnimationFrame(tick);
      else {
        // Clean up so subsequent pulses can be created fresh.
        if (state.map.getLayer(PULSE_LAYER)) state.map.removeLayer(PULSE_LAYER);
        if (state.map.getSource(PULSE_SRC)) state.map.removeSource(PULSE_SRC);
      }
    }
    requestAnimationFrame(tick);

    // Auto-open the popup so the visitor immediately sees what was added.
    setTimeout(() => selectFeature(feat.properties.id, { fly: false }), 700);
  }

  function showPollStatus(msg) {
    const status = document.getElementById('map-status');
    if (!status) return;
    status.dataset.visible = 'true';
    status.innerHTML = `<span class="status-title">Live updates paused</span>${escapeHtml(msg)}`;
  }
  function hidePollStatus() {
    const status = document.getElementById('map-status');
    if (status && status.dataset.visible === 'true') {
      status.dataset.visible = 'false';
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    try {
      // Load the static seed and the gazetteer in parallel. The seed lets
      // the map render immediately even if Omeka is offline; the gazetteer
      // is needed to transform Omeka items into features during the poll.
      const [features, gaz] = await Promise.all([loadFeatures(), loadGazetteer()]);
      state.features = features;
      state.gazetteer = gaz;
      // Build the id -> home-anchor index from the seed so later polls that
      // return Omeka items (which don't carry addressee/home data) can still
      // resolve the home county for each known letter.
      for (const f of features) {
        state.knownIds.add(f.properties.id);
        const p = f.properties;
        if (p.home_lat != null && p.home_lon != null) {
          state.homeIndex.set(p.id, {
            home_canonical: p.home_canonical,
            home_id: p.home_id,
            home_lat: p.home_lat,
            home_lon: p.home_lon,
          });
        }
      }
    } catch (e) {
      const status = document.getElementById('map-status');
      if (status) {
        status.dataset.visible = 'true';
        status.innerHTML = `<span class="status-title">Could not load letter data</span>${escapeHtml(e.message)}`;
      }
      return;
    }

    state.map = new maplibregl.Map({
      container: 'map',
      style: STYLE,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      attributionControl: { compact: true },
    });

    state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), 'top-right');
    state.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    state.map.on('load', () => {
      addLayers();
      applyMapData();
      renderSidebar();
      setupTimeline();
      setupToggles();

      // Begin live polling. First poll happens almost immediately so newly
      // authored letters land within a few seconds of submission.
      setTimeout(pollOmeka, 2000);
      state.pollTimer = setInterval(pollOmeka, POLL_INTERVAL_MS);

      // If the URL has ?focus=ID, select that feature once the poll has
      // brought it in (give it up to ~30s).
      const focusId = new URLSearchParams(window.location.search).get('focus');
      if (focusId) {
        const wantId = Number(focusId);
        const start = performance.now();
        const tryFocus = () => {
          if (state.features.some((f) => f.properties.id === wantId)) {
            selectFeature(wantId, { fly: true });
            return;
          }
          if (performance.now() - start < 30000) setTimeout(tryFocus, 1500);
        };
        tryFocus();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
