// Iowa Letters — public authoring UI.
//
// Loads behind a passphrase gate. Once unlocked, presents a Dublin Core form
// with gazetteer-backed place autocomplete. Submissions POST to a server-
// side Netlify Function (/.netlify/functions/post-letter) which validates
// the passphrase against an env var and forwards the payload to Omeka with
// credentials the browser never sees.
//
// Security posture (v0.3.0 — credentials live server-side):
//   - Browser knows nothing about the Omeka REST API key. The Function holds
//     it via Netlify env vars; the deployed JS contains zero secrets.
//   - The passphrase gate is enforced on BOTH sides: client-side to UX-gate
//     the form, server-side as the actual auth boundary in the Function.
//   - In production this would sit behind institutional SSO, with the
//     Function replaced by an authenticated route.
(function () {
  'use strict';

  const FN_URL = '/.netlify/functions/post-letter';
  const GAZ_URL = '/data/gazetteer.json';

  const KEY = window.OMEKA_AUTHOR_KEY || {};
  if (!KEY.PROPS || !KEY.RESOURCE_TEMPLATE_ID) {
    showFatal('The authoring configuration file (author-key.js) did not load. The form is offline.');
    return;
  }

  const state = {
    gazetteer: [],
    placeIndex: new Map(),
  };

  // ─── DOM ──────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function showFatal(msg) {
    const wrap = $('author-fatal');
    if (wrap) {
      wrap.hidden = false;
      wrap.innerText = msg;
    }
    // Also hide the gate screen so the user isn't left clicking a button that
    // can't do anything (the init() bail leaves the gate handlers unwired).
    const gate = $('gate-screen');
    if (gate) gate.hidden = true;
  }

  function setStatus(msg, state = null) {
    const el = $('submit-status');
    if (!el) return;
    el.textContent = msg;
    if (state) el.dataset.state = state;
    else delete el.dataset.state;
  }

  // ─── Gate ─────────────────────────────────────────────────────────────────
  // The client-side gate is purely UX. The real auth check happens on the
  // server inside the Function (the passphrase travels in every submission
  // and is validated against an env var there). If a savvy visitor bypasses
  // the client gate they still cannot POST without the correct passphrase.
  let unlockedPassphrase = null;

  function setupGate() {
    const gate = $('gate-screen');
    const form = $('author-form');
    const input = $('gate-passphrase');
    const btn = $('gate-submit');
    const err = $('gate-error');

    function tryUnlock() {
      const v = input.value.trim();
      if (!v) {
        err.textContent = 'Enter the passphrase from the cover letter.';
        err.hidden = false;
        input.focus();
        return;
      }
      // No client-side string-compare: just stash it and let the server
      // accept or reject on submission. Keeps the gate honest.
      unlockedPassphrase = v;
      gate.hidden = true;
      form.hidden = false;
      const firstField = form.querySelector('input, textarea, select');
      if (firstField) firstField.focus();
    }

    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryUnlock();
      }
    });
  }

  // ─── Gazetteer ────────────────────────────────────────────────────────────
  async function loadGazetteer() {
    const r = await fetch(GAZ_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not load gazetteer (HTTP ${r.status})`);
    const g = await r.json();
    state.gazetteer = g.places || [];
    state.placeIndex = new Map();
    for (const p of state.gazetteer) {
      state.placeIndex.set(p.canonical, p);
      for (const a of p.aliases || []) state.placeIndex.set(a, p);
    }

    // Sort the picklist alphabetically by state, then by the location name
    // within state. The gazetteer file keeps its narrative theater ordering;
    // the dropdown gets a usability-first sort.
    function sortKey(place) {
      const parts = (place.canonical || '').split(',').map((s) => s.trim());
      const state = parts[1] || 'ZZZ';
      const name = parts[0] || '';
      return `${state.toLowerCase()}|${name.toLowerCase()}`;
    }
    const sorted = [...state.gazetteer].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b))
    );

    const list = $('place-options');
    if (list) {
      list.innerHTML = '';
      for (const p of sorted) {
        const opt = document.createElement('option');
        opt.value = p.canonical;
        const theaterLabel = (g.theaters && g.theaters[p.theater] && g.theaters[p.theater].label) || p.theater;
        opt.label = theaterLabel;
        list.appendChild(opt);
      }
    }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  function buildPayload(form) {
    const v = (name) => (form.elements[name].value || '').trim();
    const props = KEY.PROPS;

    function literal(propId, value) {
      return { type: 'literal', property_id: propId, '@value': value };
    }

    const payload = {
      'o:is_public': true,
      'o:resource_template': { 'o:id': KEY.RESOURCE_TEMPLATE_ID },
      'o:item_set': [{ 'o:id': KEY.ITEM_SET_ID }],
      'dcterms:title': [literal(props.title, v('title'))],
      'dcterms:creator': [literal(props.creator, v('creator'))],
      'dcterms:date': v('date') ? [literal(props.date, v('date'))] : undefined,
      'dcterms:type': [literal(props.type, 'Correspondence')],
      'dcterms:language': [literal(props.language, 'en')],
      'dcterms:spatial': v('place') ? [literal(props.spatial, v('place'))] : undefined,
      'dcterms:description': v('transcription') ? [literal(props.description, v('transcription'))] : undefined,
      'dcterms:rights': [literal(props.rights, 'Public domain in the United States. Reader-contributed entry, prototype demonstration.')],
      'dcterms:source': [literal(props.source, 'Reader-contributed entry, Iowa Letters prototype map authoring form.')],
    };
    // Drop undefined keys
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    return payload;
  }

  function validate(form) {
    const errors = [];
    const required = [
      ['title', 'Title of the letter'],
      ['creator', "Author / soldier's name"],
      ['place', 'Place written from'],
    ];
    for (const [name, label] of required) {
      const v = (form.elements[name].value || '').trim();
      if (!v) errors.push(`${label} is required.`);
    }
    return errors;
  }

  // Soft warning: place isn't in the gazetteer. Letter still saves; it just
  // won't appear on the map until someone adds the place to the authority
  // file. Returns a string warning or null.
  function gazetteerWarning(form) {
    const place = (form.elements.place.value || '').trim();
    if (place && !state.placeIndex.has(place)) {
      return `Heads up: "${place}" is not in the gazetteer authority file. The letter will be saved to Omeka, but it will not appear on the map until that place is added. Pick from the autocomplete list if you want the letter to render.`;
    }
    return null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    setStatus('');

    const errors = validate(form);
    if (errors.length) {
      setStatus(errors.join(' '), 'error');
      return;
    }
    const gazWarn = gazetteerWarning(form);

    setStatus('Submitting to Omeka…');
    const payload = buildPayload(form);
    payload.passphrase = unlockedPassphrase;

    try {
      const r = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setStatus('That passphrase did not match. Check the cover letter for the right one.', 'error');
        // Re-show the gate so the user can re-enter
        $('gate-screen').hidden = false;
        $('author-form').hidden = true;
        unlockedPassphrase = null;
        return;
      }
      if (!r.ok) {
        const msg = body && (body.error || body.errors)
          ? (body.error || JSON.stringify(body.errors))
          : `HTTP ${r.status}`;
        setStatus(`Omeka rejected the letter: ${msg}`, 'error');
        return;
      }
      const id = body['o:id'];
      const okMsg = gazWarn
        ? `Letter saved as Omeka item #${id}. ${gazWarn}`
        : `Letter added (Omeka item #${id}). The map will pick it up on its next poll.`;
      setStatus(okMsg, gazWarn ? 'warn' : 'ok');

      // Surface the success block + reset the form
      const successEl = $('author-success');
      const mapLink = $('author-success-link');
      if (successEl && mapLink) {
        mapLink.href = `/map.html?focus=${encodeURIComponent(id)}`;
        successEl.hidden = false;
      }
      form.reset();
    } catch (err) {
      setStatus(
        `Could not reach Omeka. The system of record may be offline (the local Docker stack is exposed via ngrok and is only reachable while the host machine is on). Details: ${err.message}`,
        'error'
      );
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    setupGate();
    try {
      await loadGazetteer();
    } catch (e) {
      showFatal(`Gazetteer failed to load: ${e.message}`);
      return;
    }
    const form = $('author-form');
    if (form) form.addEventListener('submit', onSubmit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
