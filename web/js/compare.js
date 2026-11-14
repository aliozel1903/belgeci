// Karşılaştır: iki PDF yan yana, sayfa sayfa eşleştirilmiş; metin ve piksel farkı vurgulama.
import { T, h, icon, dropzone, toast, readFile, errText } from './ui.js';
import * as core from './pdfcore.js';

export function renderCompare(root, preset = []) {
  const S = { a: null, b: null, offA: 0, offB: 0, diff: true, zoom: 1 };
  const stage = h('div.cmp');
  root.append(stage);
  let io = null;

  async function load(side, file) {
    try {
      const bytes = await readFile(file);
      const view = await core.openView(bytes, file.name);
      S[side] = { name: file.name, view, n: view.numPages, text: {} };
      draw();
    } catch (e) { console.error(e); toast(errText(e), 'error', 7000); }
  }
  async function pageText(doc, n) {
    if (doc.text[n] == null) {
      const page = await doc.view.getPage(n);
      const tc = await page.getTextContent();
      doc.text[n] = tc.items.map((i) => i.str || '').join(' ').replace(/\s+/g, ' ').trim();
    }
    return doc.text[n];
  }

  function slot(side) {
    const d = S[side];
    if (d) return null;
    return h('div.cmp-slot', h('h3', side === 'a' ? T('1. belge', 'Document 1') : T('2. belge', 'Document 2')),
      dropzone({ accept: '.pdf', onFiles: ([f]) => load(side, f), compact: false, title: T('PDF seç veya sürükle', 'Choose or drop a PDF') }));
  }

  function draw() {
    io?.disconnect();
    if (!S.a || !S.b) {
      stage.replaceChildren(h('div.cmp-pick',
        slot('a') || h('div.cmp-slot.ready', h('h3', T('1. belge', 'Document 1')), h('div.loaded', icon('pdf'), h('span', S.a.name), h('span.muted', T(`${S.a.n} sayfa`, `${S.a.n} pages`)))),
        slot('b') || h('div.cmp-slot.ready', h('h3', T('2. belge', 'Document 2')), h('div.loaded', icon('pdf'), h('span', S.b.name), h('span.muted', T(`${S.b.n} sayfa`, `${S.b.n} pages`))))));
      return;
    }
    const rows = Math.max(S.a.n + S.offA, S.b.n + S.offB);
    const summary = h('span.status', T('Sayfalar karşılaştırılıyor…', 'Comparing pages…'));
    const stepper = (side) => {
      const k = side === 'a' ? 'offA' : 'offB';
      return h('span.stepper', { title: T('Bu belgeyi aşağı kaydırarak sayfaları hizala (araya sayfa eklenmişse kullan)', 'Shift this document down to align pages (useful when a page was inserted)') },
        h('button', { onclick: () => { S[k] = Math.max(0, S[k] - 1); draw(); }, 'aria-label': '-' }, '−'),
        h('span', T(`Kaydır: ${S[k]}`, `Shift: ${S[k]}`)),
        h('button', { onclick: () => { S[k] += 1; draw(); }, 'aria-label': '+' }, '+'));
    };
    const tb = h('div.toolbar',
      h('div.tb-group', h('label.check', h('input', { type: 'checkbox', checked: S.diff, onchange: (e) => { S.diff = e.target.checked; draw(); } }), h('span', T('Farkları vurgula', 'Highlight differences')))),
      h('div.tb-group', h('label.zoomer', icon('zoom'), h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: S.zoom, 'aria-label': 'Zoom', onchange: (e) => { S.zoom = +e.target.value; draw(); } }))),
      summary,
      h('div.tb-spacer'),
      h('button.btn.ghost', { onclick: () => { [S.a, S.b] = [S.b, S.a]; [S.offA, S.offB] = [S.offB, S.offA]; draw(); } }, T('Yer değiştir', 'Swap')),
      h('button.btn.ghost', { onclick: () => { S.a = S.b = null; S.offA = S.offB = 0; draw(); } }, T('Yeni karşılaştırma', 'New comparison')));
    const head = h('div.cmp-row.head',
      h('div.cmp-cell', h('strong', S.a.name), stepper('a')),
      h('div.cmp-cell', h('strong', S.b.name), stepper('b')));
    const list = h('div.cmp-list', { style: { '--z': S.zoom } });
    let same = 0, diff = 0, done = 0;
    const badges = [];
    for (let r = 0; r < rows; r++) {
      const pa = r - S.offA + 1, pb = r - S.offB + 1;
      const okA = pa >= 1 && pa <= S.a.n, okB = pb >= 1 && pb <= S.b.n;
      const badge = h('span.badge', '…');
      badges.push(badge);
      const cell = (ok, n) => h('div.cmp-cell', ok ? [h('div.cmp-page', { 'data-n': n }), h('div.cap', T(`Sayfa ${n}`, `Page ${n}`))] : h('div.cmp-none', T('— sayfa yok —', '— no page —')));
      const row = h('div.cmp-row', { 'data-r': r }, cell(okA, pa), h('div.cmp-mid', badge), cell(okB, pb));
      row._info = { pa, pb, okA, okB, badge };
      list.append(row);
      (async () => {
        let st = 'only';
        if (okA && okB) st = (await pageText(S.a, pa)) === (await pageText(S.b, pb)) ? 'same' : 'diff';
        if (st === 'same') same++; else diff++;
        badge.className = 'badge ' + st;
        badge.textContent = st === 'same' ? T('Metin aynı', 'Same text') : st === 'diff' ? T('Farklı', 'Different') : T('Tek tarafta', 'One side only');
        if (++done === rows) summary.textContent = T(`${same} sayfa aynı · ${diff} sayfa farklı`, `${same} pages same · ${diff} different`);
      })().catch(() => {});
    }
    stage.replaceChildren(tb, head, list);

    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        renderRow(e.target).catch((err) => console.warn(err));
      }
    }, { rootMargin: '500px' });
    list.querySelectorAll('.cmp-row').forEach((r) => io.observe(r));
  }

  async function renderRow(row) {
    const { pa, pb, okA, okB } = row._info;
    const holders = row.querySelectorAll('.cmp-page');
    const width = Math.max(240, (stage.clientWidth - 110) / 2) * S.zoom * Math.min(2, window.devicePixelRatio || 1);
    const ca = okA ? await core.renderPage(S.a.view, pa, { width }) : null;
    const cb = okB ? await core.renderPage(S.b.view, pb, { width }) : null;
    let hi = 0;
    if (ca) holders[hi++].append(ca);
    if (cb) holders[hi].append(cb);
    if (S.diff && ca && cb) {
      // B üzerinde, A'dan farklı pikselleri kırmızıyla işaretle
      const w = Math.min(ca.width, cb.width), hgt = Math.min(ca.height, cb.height);
      const da = ca.getContext('2d').getImageData(0, 0, w, hgt).data;
      const db = cb.getContext('2d').getImageData(0, 0, w, hgt);
      const ov = document.createElement('canvas');
      ov.width = cb.width; ov.height = cb.height; ov.className = 'cmp-ov';
      const out = new ImageData(w, hgt);
      let count = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db.data[i]) + Math.abs(da[i + 1] - db.data[i + 1]) + Math.abs(da[i + 2] - db.data[i + 2]);
        if (d > 90) { out.data[i] = 229; out.data[i + 1] = 72; out.data[i + 2] = 77; out.data[i + 3] = 150; count++; }
      }
      if (count > 20) {
        ov.getContext('2d').putImageData(out, 0, 0);
        holders[hi].append(ov);
        const b = row._info.badge;
        if (b.classList.contains('same')) { b.className = 'badge diff'; b.textContent = T('Görsel fark', 'Visual difference'); }
      }
    }
  }

  draw();
  if (preset[0]) load('a', preset[0]).then(() => preset[1] && load('b', preset[1]));
  return { load, state: S };
}
