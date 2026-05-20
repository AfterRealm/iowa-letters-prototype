// Iowa Letters — public authoring UI.
//
// Loads behind a passphrase gate (IowaLetters). Once unlocked, presents a
// Dublin Core-aligned form with gazetteer-backed place autocomplete and
// POSTs the new letter to Omeka S via REST as the iowa-letters-author user.
//
// Security posture (intentionally a soft gate; production = institutional SSO):
//   - The passphrase is checked client-side. Anyone with the page source can
//     trivially bypass it. That's fine — the IowaLetters string exists to
//     keep casual visitors out, not to be a real auth boundary.
//   - The Omeka API key embedded here belongs to a role-bounded Author user.
//     The worst that can happen if the key leaks is unwanted new-item POSTs
//     (no DELETE, no admin reach, no global settings). The key rotates by
//     re-running omeka-lab/setup-author-user.mjs.
(function () {
  'use strict';

  const PASSPHRASE = 'IowaLetters';
  const GAZ_URL = '/data/gazetteer.json';

  const KEY = window.OMEKA_AUTHOR_KEY || {};
  if (!KEY.KEY_ID || !KEY.KEY_CRED) {
    showFatal('The Omeka author credentials file did not load. The authoring form is offline.');
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
  function setupGate() {
    const gate = $('gate-screen');
    const form = $('author-form');
    const input = $('gate-passphrase');
    const btn = $('gate-submit');
    const err = $('gate-error');

    function tryUnlock() {
      const v = input.value.trim();
      if (v === PASSPHRASE) {
        gate.hidden = true;
        form.hidden = false;
        // Move focus into the form for keyboard users
        const firstField = form.querySelector('input, textarea, select');
        if (firstField) firstField.focus();
      } else {
        err.textContent = 'That passphrase does not match. Check the cover letter for the right one.';
        err.hidden = false;
        input.focus();
      }
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

    const list = $('place-options');
    if (list) {
      list.innerHTML = '';
      for (const p of state.gazetteer) {
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
    const place = (form.elements.place.value || '').trim();
    if (place && !state.placeIndex.has(place)) {
      errors.push(`"${place}" is not in the gazetteer. Pick from the suggestions, or choose the closest match.`);
    }
    return errors;
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

    setStatus('Submitting to Omeka…');
    const payload = buildPayload(form);

    try {
      const url = `${KEY.API_BASE}/items?key_identity=${encodeURIComponent(KEY.KEY_ID)}&key_credential=${encodeURIComponent(KEY.KEY_CRED)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = body && body.errors ? JSON.stringify(body.errors) : `HTTP ${r.status}`;
        setStatus(`Omeka rejected the letter: ${msg}`, 'error');
        return;
      }
      const id = body['o:id'];
      setStatus(`Letter added (Omeka item #${id}). The map will pick it up on its next poll.`, 'ok');

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
