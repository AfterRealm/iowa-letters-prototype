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

  loadItems().then(loaded => {
    items = loaded;
    render();
    [qEl, yearEl, regimentEl].forEach(el => el && el.addEventListener('input', render));
  }).catch(err => {
    listEl.innerHTML = `<p class="muted">Could not load items: ${escapeHtml(err.message)}</p>`;
  });
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
    <p><a href="/items.html">&larr; Back to all letters</a></p>
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

function initItemPage() {
  const detailEl = document.getElementById('item-detail');
  if (!detailEl) return;
  const params = new URLSearchParams(location.search);
  const id = parseInt(params.get('id'), 10);
  if (!id) {
    detailEl.innerHTML = '<p>No item ID provided. <a href="/items.html">Browse all letters.</a></p>';
    return;
  }
  loadItems().then(items => {
    const item = items.find(i => i['o:id'] === id);
    if (!item) {
      detailEl.innerHTML = `<p>Item ${escapeHtml(id)} not found. <a href="/items.html">Browse all letters.</a></p>`;
      return;
    }
    document.title = `${item['dcterms:title']} · Iowa Letters`;
    detailEl.innerHTML = renderItemDetail(item);
  }).catch(err => {
    detailEl.innerHTML = `<p class="muted">Could not load item: ${escapeHtml(err.message)}</p>`;
  });
}

function initShotViewer() {
  const dialog = document.getElementById('shotViewer');
  if (!dialog) return;
  const img = document.getElementById('shotViewerImg');
  const captionEl = document.getElementById('shotViewerCaption');
  const closeBtn = dialog.querySelector('.shot-viewer-close');

  document.querySelectorAll('.screenshot-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceImg = btn.querySelector('img');
      if (!sourceImg) return;
      img.src = sourceImg.src;
      img.alt = sourceImg.alt;
      const fig = btn.closest('figure');
      const cap = fig ? fig.querySelector('figcaption') : null;
      captionEl.textContent = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : '';
      dialog.showModal();
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', () => dialog.close());

  // Click outside the image area closes
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initIndexPage();
  initItemPage();
  initShotViewer();
});
