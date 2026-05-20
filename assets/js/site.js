// Iowa Letters · Digital Edition Prototype
// Front-end logic for item index, item detail rendering, and search/filter.

const DATA_URL = '/data/items.json';

async function loadItems() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Failed to load items: ${res.status}`);
  const collection = await res.json();
  return collection.items;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderItemCard(item) {
  const subjects = (item['dcterms:subject'] || []).slice(0, 3).join(' · ');
  return `
    <article class="item-card">
      <img src="${escapeHtml(item.thumb)}" alt="" loading="lazy" />
      <div>
        <h2 class="card-title"><a href="/item.html?id=${item['o:id']}">${escapeHtml(item['dcterms:title'])}</a></h2>
        <p class="meta">
          <span><strong>Date:</strong> ${escapeHtml(item['dcterms:date'])}</span>
          <span><strong>Author:</strong> ${escapeHtml(item['dcterms:creator'])}</span>
          <span><strong>Regiment:</strong> ${escapeHtml(item.regiment)}</span>
        </p>
        <p class="meta"><span>${escapeHtml(subjects)}</span></p>
        <p class="excerpt">&ldquo;${escapeHtml((item.transcription || '').slice(0, 150))}&hellip;&rdquo;</p>
      </div>
    </article>
  `;
}

function applyFilters(items, q, year, regiment) {
  const needle = (q || '').trim().toLowerCase();
  return items.filter(item => {
    if (year && !((item['dcterms:date'] || '').startsWith(year))) return false;
    if (regiment && item.regiment !== regiment) return false;
    if (!needle) return true;
    const hay = [
      item['dcterms:title'],
      item['dcterms:creator'],
      item['dcterms:date'],
      item.regiment,
      item.transcription,
      item.addressee,
      (item['dcterms:subject'] || []).join(' '),
      item['dcterms:spatial']
    ].join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

function initIndexPage() {
  const listEl = document.getElementById('item-list');
  const countEl = document.getElementById('item-count');
  const qEl = document.getElementById('q');
  const yearEl = document.getElementById('year');
  const regimentEl = document.getElementById('regiment');
  if (!listEl) return;

  let items = [];

  function render() {
    const filtered = applyFilters(items, qEl?.value, yearEl?.value, regimentEl?.value);
    countEl.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'} shown of ${items.length} total`;
    listEl.innerHTML = filtered.length
      ? filtered.map(renderItemCard).join('')
      : '<p class="muted">No items match those filters. Try clearing them.</p>';
  }

  // Try Omeka first (source of truth post-authoring), fall back to the
  // static items.json seed if Omeka is unreachable. Mirrors the pattern
  // used by initItemPage so the items list reflects every letter currently
  // in the system, including community-authored ones.
  (async function loadList() {
    try {
      const r = await fetch(`${OMEKA_API_BASE}/items?per_page=100`, {
        cache: 'no-cache',
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      if (!r.ok) throw new Error(`Omeka returned HTTP ${r.status}`);
      const omekaItems = await r.json();
      items = omekaItems.map(omekaItemToDisplay);
      render();
    } catch (omekaErr) {
      try {
        items = await loadItems();
        render();
        listEl.insertAdjacentHTML('afterbegin',
          `<p class="muted" style="margin-bottom: 1rem;">Showing the cached seed ` +
          `because the live Omeka backend was unreachable ` +
          `(<code>${escapeHtml(omekaErr.message)}</code>). Newly authored ` +
          `letters may be missing from this list.</p>`);
      } catch (seedErr) {
        listEl.innerHTML = `<p class="muted">Could not load items: ${escapeHtml(seedErr.message)}</p>`;
        return;
      }
    }
    [qEl, yearEl, regimentEl].forEach(el => el && el.addEventListener('input', render));
  })();
}

function renderItemDetail(item) {
  const subjects = (item['dcterms:subject'] || []).join('; ');

  const metadataRows = [
    ['Title', 'dcterms:title', item['dcterms:title']],
    ['Author / Creator', 'dcterms:creator', item['dcterms:creator']],
    ['Date written', 'dcterms:date', item['dcterms:date']],
    ['Type', 'dcterms:type', item['dcterms:type']],
    ['Physical format', 'dcterms:format', item['dcterms:format']],
    ['Language', 'dcterms:language', item['dcterms:language']],
    ['Subject', 'dcterms:subject', subjects],
    ['Place written', 'dcterms:spatial', item['dcterms:spatial']],
    ['Time period', 'dcterms:temporal', item['dcterms:temporal']],
    ['Rights', 'dcterms:rights', item['dcterms:rights']],
    ['Source', 'dcterms:source', item['dcterms:source']],
    ['Regiment', '(local property)', item.regiment],
    ['Company', '(local property)', item.company],
    ['Addressee', '(local property)', item.addressee]
  ];

  return `
    <p class="item-back-links">
      <a href="/items.html">&larr; Back to all letters</a>
      <span aria-hidden="true"> · </span>
      <a href="/map.html?focus=${encodeURIComponent(item['o:id'])}">Open on the map &rarr;</a>
    </p>
    <h1>${escapeHtml(item['dcterms:title'])}</h1>
    <p class="lede">A letter from ${escapeHtml(item['dcterms:creator'])}, ${escapeHtml(item.regiment)}, written ${escapeHtml(item['dcterms:date'])} from ${escapeHtml(item['dcterms:spatial'])}.</p>

    <div class="item-detail-grid">
      <div>
        <div class="viewer-frame">
          <img src="${escapeHtml(item.thumb)}" alt="Illustrative image accompanying the letter. In production, this region would host an interactive IIIF image viewer for the manuscript scan." />
          <div class="caption">Illustrative image. In production the viewer would consume a IIIF Presentation API manifest from the Special Collections digitization workflow.</div>
        </div>
        <div class="iiif-link">
          IIIF manifest: <a href="${escapeHtml(item.iiif_manifest)}" target="_blank" rel="noopener">view manifest</a>
        </div>
      </div>
      <div>
        <h2>Descriptive metadata</h2>
        <p class="text-small muted">Modeled on the Dublin Core Terms (DCMI) vocabulary. Local properties extend the model where DCMI does not have an exact match.</p>
        <table class="metadata-table" aria-label="Descriptive metadata for ${escapeHtml(item['dcterms:title'])}">
          <tbody>
            ${metadataRows.filter(r => r[2]).map(([label, uri, val]) => `
              <tr>
                <th scope="row">${escapeHtml(label)}<span class="property-uri">${escapeHtml(uri)}</span></th>
                <td>${escapeHtml(val)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <h2>Transcription</h2>
    <div class="transcription">${escapeHtml(item.transcription)}</div>

    <div class="callout">
      <h3>About this entry</h3>
      <p>This is an illustrative prototype entry, created to demonstrate metadata modeling, accessibility, and presentation patterns for a faculty digital edition project. Transcriptions and identifying details in this build are fictional. In production, each letter would be transcribed against the digitized manuscript by trained Special Collections staff and reviewed by the project's faculty Principal Investigator before publication.</p>
    </div>
  `;
}

// Flatten an Omeka S item record into the same shape the static items.json
// uses, so renderItemDetail can render it without branching. Omeka stores
// each Dublin Core property as an array of value objects; we unwrap the
// first @value for display purposes.
function omekaItemToDisplay(omeka) {
  const v = (key) => {
    const arr = omeka[key];
    return Array.isArray(arr) && arr.length ? arr[0]['@value'] : null;
  };
  const subjects = (omeka['dcterms:subject'] || []).map((x) => x['@value']).filter(Boolean);
  return {
    'o:id': omeka['o:id'],
    'dcterms:title': v('dcterms:title'),
    'dcterms:creator': v('dcterms:creator'),
    'dcterms:date': v('dcterms:date'),
    'dcterms:type': v('dcterms:type'),
    'dcterms:format': v('dcterms:format'),
    'dcterms:language': v('dcterms:language'),
    'dcterms:subject': subjects,
    'dcterms:spatial': v('dcterms:spatial'),
    'dcterms:temporal': v('dcterms:temporal'),
    'dcterms:rights': v('dcterms:rights'),
    'dcterms:source': v('dcterms:source'),
    transcription: v('dcterms:description'),
    regiment: omeka.regiment || null,
    company: omeka.company || null,
    addressee: omeka.addressee || null,
    thumb: '/assets/img/manuscript-placeholder.svg',
    iiif_manifest: 'https://iiif.io/api/cookbook/recipe/0001-mvm-image/manifest.json',
  };
}

const OMEKA_API_BASE = 'https://iowa.dev.01.ngrok.dev/api';

async function loadItemFromOmeka(id) {
  const r = await fetch(`${OMEKA_API_BASE}/items/${id}`, {
    cache: 'no-cache',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!r.ok) throw new Error(`Omeka returned HTTP ${r.status}`);
  const omeka = await r.json();
  return omekaItemToDisplay(omeka);
}

function initItemPage() {
  const detailEl = document.getElementById('item-detail');
  if (!detailEl) return;
  const params = new URLSearchParams(location.search);
  const id = parseInt(params.get('id'), 10);
  if (!id) {
    detailEl.innerHTML = '<p>No item ID provided. <a href="/items.html">Browse all letters.</a></p>';
    return;
  }

  // Omeka is the source of truth. Try it first; fall back to the static seed
  // (items.json) only if Omeka is unreachable or the id isn't there. The
  // static seed uses items.json ids 1-6 which don't line up with Omeka's
  // auto-assigned 2-7, so the title-match fallback is also tried before
  // giving up.
  (async function loadById() {
    try {
      const item = await loadItemFromOmeka(id);
      document.title = `${item['dcterms:title']} · Iowa Letters`;
      detailEl.innerHTML = renderItemDetail(item);
      return;
    } catch (omekaErr) {
      // Fall through to the static seed
      try {
        const items = await loadItems();
        let item = items.find(i => i['o:id'] === id);
        if (item) {
          document.title = `${item['dcterms:title']} · Iowa Letters`;
          detailEl.innerHTML = renderItemDetail(item);
          return;
        }
        detailEl.innerHTML = `
          <p><a href="/items.html">&larr; Back to all letters</a></p>
          <h1>Item not found</h1>
          <p>Letter <code>${escapeHtml(id)}</code> could not be resolved against either the live Omeka backend or the static seed.</p>
          <ul>
            <li>If you just submitted this letter via <a href="/add-letter.html">/add-letter.html</a>, the live Omeka backend may be temporarily unreachable — try again in a few seconds.</li>
            <li>Open the <a href="/map.html">map view</a> to see all currently visible letters.</li>
            <li>Omeka error: <code>${escapeHtml(omekaErr.message)}</code>.</li>
          </ul>
        `;
      } catch (seedErr) {
        detailEl.innerHTML = `<p class="muted">Could not load item from Omeka (${escapeHtml(omekaErr.message)}) or from the static seed (${escapeHtml(seedErr.message)}).</p>`;
      }
    }
  })();
}

function ensureShotViewer() {
  let dialog = document.getElementById('shotViewer');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'shot-viewer';
  dialog.id = 'shotViewer';
  dialog.setAttribute('aria-labelledby', 'shotViewerTitle');
  dialog.innerHTML = `
    <div class="shot-viewer-head">
      <h2 id="shotViewerTitle" class="shot-viewer-title">Image detail</h2>
      <button type="button" class="shot-viewer-close" aria-label="Close image viewer">Close &times;</button>
    </div>
    <div class="shot-viewer-body">
      <img id="shotViewerImg" alt="" />
      <p id="shotViewerCaption" class="shot-viewer-caption"></p>
    </div>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function initShotViewer() {
  const triggers = document.querySelectorAll('.screenshot-trigger');
  if (!triggers.length) return;
  const dialog = ensureShotViewer();
  const img = dialog.querySelector('#shotViewerImg');
  const captionEl = dialog.querySelector('#shotViewerCaption');
  const closeBtn = dialog.querySelector('.shot-viewer-close');

  triggers.forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceImg = btn.querySelector('img');
      if (!sourceImg) return;
      // Allow a higher-res variant via data-full-src
      img.src = btn.dataset.fullSrc || sourceImg.src;
      img.alt = sourceImg.alt || '';
      const captionFromData = btn.dataset.caption;
      if (captionFromData) {
        captionEl.textContent = captionFromData;
      } else {
        const fig = btn.closest('figure');
        const cap = fig ? fig.querySelector('figcaption') : null;
        captionEl.textContent = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : '';
      }
      dialog.showModal();
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function initBackToTop() {
  // Auto-inject the button on every page so individual pages don't need markup.
  let btn = document.getElementById('backToTop');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'backToTop';
    btn.className = 'back-to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top of page');
    btn.innerHTML = '<span aria-hidden="true">&uarr;</span><span class="sr-only">Top</span>';
    document.body.appendChild(btn);
  }
  const check = () => btn.classList.toggle('visible', window.scrollY > 400);
  window.addEventListener('scroll', check, { passive: true });
  check();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initBuildTag() {
  const v = window.SITE_VERSION;
  if (!v) return;
  document.querySelectorAll('[data-build-tag]').forEach((el) => {
    el.textContent = v.display;
    el.title = `Built ${v.builtAt} from ${v.sha}${v.branch ? ' on ' + v.branch : ''}`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initBuildTag();
  initIndexPage();
  initItemPage();
  initShotViewer();
  initBackToTop();
});
