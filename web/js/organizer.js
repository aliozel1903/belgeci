// Sayfa Düzenleyici: sil, değiştir, araya ekle, sırala, döndür — birden çok PDF arasında.
import { T, h, icon, dropzone, toast, busy, download, baseName, readFile, errText, pickFiles, modal } from './ui.js';
import * as core from './pdfcore.js';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp';
const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#0090ff', '#d6409f', '#978365'];
const letter = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

export function renderOrganizer(root, preset = []) {
  const S = { sources: [], pages: [], sel: new Set(), undo: [], anchor: null, seq: 0 };
  const thumbCache = new Map();
  let queue = Promise.resolve();
  let sortable = null;

  const stage = h('div.org');
  root.append(stage);

  // ── durum yardımcıları ──
  const snapshot = () => { S.undo.push(S.pages.map((p) => ({ ...p }))); if (S.undo.length > 60) S.undo.shift(); };
  const key = () => 'p' + (++S.seq);
  const srcOf = (p) => S.sources.find((s) => s.id === p.src);
  const selected = () => S.pages.filter((p) => S.sel.has(p.key));

  async function loadSources(fileList) {
    const out = [];
    const b = busy(T('Dosyalar açılıyor…', 'Opening files…'));
    try {
      for (const f of fileList) {
        b.set(f.name);
        const raw = { name: f.name, bytes: await readFile(f) };
        const bytes = await core.asPdfBytes(raw);
        const view = await core.openView(bytes, f.name);
        const src = { id: 's' + (++S.seq), name: f.name, bytes, view, n: view.numPages, color: COLORS[S.sources.length % COLORS.length], label: letter(S.sources.length) };
        S.sources.push(src);
        out.push(src);
      }
    } catch (e) { console.error(e); toast(errText(e), 'error', 7000); }
    b.close();
    return out;
  }
  const pagesOf = (srcs) => srcs.flatMap((s) => Array.from({ length: s.n }, (_, i) => ({ key: key(), src: s.id, idx: i, rot: 0 })));

  async function addAt(fileList, at, replaceKeys = null) {
    if (!fileList.length) return;
    const srcs = await loadSources(fileList);
    if (!srcs.length) return;
    snapshot();
    const fresh = pagesOf(srcs);
    if (replaceKeys?.size) {
      const first = S.pages.findIndex((p) => replaceKeys.has(p.key));
      S.pages = S.pages.filter((p) => !replaceKeys.has(p.key));
      S.pages.splice(first, 0, ...fresh);
      toast(T(`${replaceKeys.size} sayfa, ${fresh.length} yeni sayfayla değiştirildi.`, `${replaceKeys.size} page(s) replaced with ${fresh.length} new page(s).`), 'ok');
    } else {
      S.pages.splice(at ?? S.pages.length, 0, ...fresh);
      if (S.pages.length !== fresh.length) toast(T(`${fresh.length} sayfa eklendi.`, `${fresh.length} page(s) added.`), 'ok');
    }
    // İlk açılışta seçim yapma; sonradan eklenen/değiştirilen sayfaları seçili göster
    S.sel = S.pages.length === fresh.length ? new Set() : new Set(fresh.map((p) => p.key));
    draw();
    if (S.pages.length !== fresh.length) stage.querySelector(`[data-key="${fresh[0].key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function del(keys) {
    if (!keys.size) return;
    snapshot();
    S.pages = S.pages.filter((p) => !keys.has(p.key));
    keys.forEach((k) => S.sel.delete(k));
    draw();
    toast(T(`${keys.size} sayfa silindi.`, `${keys.size} page(s) deleted.`) + ' ' + T('(Geri almak için Ctrl+Z)', '(Ctrl+Z to undo)'), 'info', 2600);
  }
  function rotate(keys, deg) {
    if (!keys.size) return;
    snapshot();
    S.pages.forEach((p) => { if (keys.has(p.key)) p.rot = (p.rot + deg + 360) % 360; });
    draw();
  }
  function undo() {
    const prev = S.undo.pop();
    if (!prev) return;
    S.pages = prev;
    S.sel = new Set([...S.sel].filter((k) => prev.some((p) => p.key === k)));
    draw();
  }
  async function replace(keys) {
    if (!keys.size) return;
    const files = await pickFiles(ACCEPT, true);
    if (files.length) await addAt(files, null, keys);
  }
  function insertMenu(at, anchorEl) {
    document.querySelector('.menu')?.remove();
    const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (!m.contains(e.target)) close(); };
    const m = h('div.menu',
      h('button', { onclick: async () => { close(); await addAt(await pickFiles(ACCEPT, true), at); } }, icon('file'), T('PDF ya da görsel ekle', 'Insert PDF or image')),
      h('button', { onclick: () => {
        close(); snapshot();
        const ref = S.pages[Math.max(0, at - 1)];
        const pg = { key: key(), blank: true, rot: 0, w: ref?.w || 595.28, h: ref?.h || 841.89 };
        S.pages.splice(at, 0, pg); S.sel = new Set([pg.key]); draw();
      } }, icon('blank'), T('Boş sayfa ekle', 'Insert blank page')));
    document.body.append(m);
    const r = anchorEl.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left + r.width / 2 - m.offsetWidth / 2)) + 'px';
    m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', away, true));
  }

  // ── PDF oluştur ──
  async function build(list) {
    const { PDFDocument, degrees } = core.lib();
    const out = await PDFDocument.create();
    const copies = new Map();
    for (const s of S.sources) {
      const idxs = list.filter((p) => p.src === s.id).map((p) => p.idx);
      if (!idxs.length) continue;
      const doc = await core.loadDoc(s.bytes, s.name);
      copies.set(s.id, await out.copyPages(doc, idxs));
    }
    for (const p of list) {
      if (p.blank) { out.addPage([p.w, p.h]); continue; }
      const pg = copies.get(p.src).shift();
      if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
      out.addPage(pg);
    }
    return core.saveDoc(out);
  }
  async function exportPdf(list, name) {
    if (!list.length) return toast(T('Belgede sayfa yok.', 'There are no pages.'), 'warn');
    const b = busy(T('PDF oluşturuluyor…', 'Building PDF…'));
    try { download(await build(list), name.replace(/\.pdf$/i, '') + '.pdf'); b.close(); toast(T('PDF indirildi.', 'PDF downloaded.'), 'ok'); }
    catch (e) { b.close(); console.error(e); toast(errText(e), 'error', 7000); }
  }

  // ── küçük resimler ──
  function thumb(p, img) {
    const ck = p.blank ? null : `${p.src}:${p.idx}:${p.rot}`;
    if (!ck) return;
    const hit = thumbCache.get(ck);
    if (hit) { img.src = hit; return; }
    queue = queue.then(async () => {
      if (!img.isConnected) return;
      try {
        const c = await core.renderPage(srcOf(p).view, p.idx + 1, { width: 360, rotation: p.rot });
        const url = URL.createObjectURL(await core.canvasBlob(c, 'image/jpeg', 0.8));
        c.width = c.height = 0;
        thumbCache.set(ck, url);
        img.src = url;
      } catch (e) { console.warn(e); }
    });
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const p = S.pages.find((x) => x.key === e.target.dataset.key);
      if (p) thumb(p, e.target.querySelector('img'));
    }
  }, { rootMargin: '600px' });

  async function preview(start) {
    let i = start;
    const holder = h('div.preview-holder');
    const title = h('span');
    const show = async () => {
      const p = S.pages[i];
      title.textContent = T(`Sayfa ${i + 1} / ${S.pages.length}`, `Page ${i + 1} / ${S.pages.length}`);
      holder.replaceChildren(h('div.spinner'));
      if (p.blank) { holder.replaceChildren(h('div.blank-big', T('Boş sayfa', 'Blank page'))); return; }
      const c = await core.renderPage(srcOf(p).view, p.idx + 1, { width: Math.min(1400, window.innerWidth * 1.6), rotation: p.rot });
      if (S.pages[i] === p) holder.replaceChildren(c);
    };
    const nav = (d) => { i = Math.max(0, Math.min(S.pages.length - 1, i + d)); show(); };
    const keys = (e) => { if (e.key === 'ArrowRight') nav(1); if (e.key === 'ArrowLeft') nav(-1); };
    document.addEventListener('keydown', keys);
    modal(title, h('div.preview', h('button.icon-btn.nav', { onclick: () => nav(-1), 'aria-label': T('Önceki', 'Previous') }, icon('back')), holder, h('button.icon-btn.nav.next', { onclick: () => nav(1), 'aria-label': T('Sonraki', 'Next') }, icon('back'))), { wide: true, onClose: () => document.removeEventListener('keydown', keys) });
    show();
  }

  // ── çizim ──
  let nameInput = null;
  function draw() {
    sortable?.destroy(); sortable = null;
    if (!S.sources.length) {
      stage.replaceChildren(
        dropzone({ accept: ACCEPT, multiple: true, onFiles: (f) => addAt(f), title: T('PDF dosyalarını seç veya buraya sürükle', 'Choose PDF files or drop them here'), hint: T('PDF · JPG · PNG — birden çok dosya ekleyebilirsin', 'PDF · JPG · PNG — you can add several files') }),
        h('div.steps',
          h('div.step', h('b', '1'), h('div', h('strong', T('PDF\'i aç', 'Open the PDF')), h('p', T('Tüm sayfalar küçük resim olarak görünür.', 'All pages appear as thumbnails.')))),
          h('div.step', h('b', '2'), h('div', h('strong', T('Sayfayı değiştir', 'Replace a page')), h('p', T('İmzasız sayfanın üzerindeki "Değiştir"e bas, taranmış imzalı sayfayı (PDF ya da fotoğraf) seç.', 'Hit "Replace" on the unsigned page and pick the signed scan (PDF or photo).')))),
          h('div.step', h('b', '3'), h('div', h('strong', T('İndir', 'Download')), h('p', T('Yeni PDF hazır; e-postaya ekleyebilirsin.', 'Your new PDF is ready to e-mail.'))))));
      return;
    }
    const sel = S.sel;
    const n = sel.size;
    const selKeys = () => new Set(S.sel);
    const defName = baseName(S.sources[0].name) + '_duzenlendi';
    if (!nameInput) nameInput = h('input.name-input', { type: 'text', value: defName, 'aria-label': T('Çıktı dosya adı', 'Output file name') });

    const tb = h('div.toolbar',
      h('div.tb-group',
        h('button.btn', { onclick: async () => addAt(await pickFiles(ACCEPT, true)) }, icon('plus'), T('Dosya ekle', 'Add files'))),
      h('div.tb-group',
        h('button.btn', { disabled: !n, onclick: () => replace(selKeys()), title: T('Seçili sayfaları başka bir dosyayla değiştir', 'Replace selected pages with another file') }, icon('replace'), T('Değiştir', 'Replace')),
        h('button.btn', { disabled: !n, onclick: () => del(selKeys()) }, icon('trash'), T('Sil', 'Delete')),
        h('button.btn.only-icon', { disabled: !n, onclick: () => rotate(selKeys(), 270), title: T('Sola döndür', 'Rotate left'), 'aria-label': T('Sola döndür', 'Rotate left') }, icon('rotateL')),
        h('button.btn.only-icon', { disabled: !n, onclick: () => rotate(selKeys(), 90), title: T('Sağa döndür', 'Rotate right'), 'aria-label': T('Sağa döndür', 'Rotate right') }, icon('rotate')),
        h('button.btn', { disabled: !n, onclick: () => exportPdf(selected(), baseName(S.sources[0].name) + '_secili'), title: T('Seçili sayfaları ayrı bir PDF olarak indir', 'Download selected pages as a separate PDF') }, icon('extract'), T('Ayrı indir', 'Extract'))),
      h('div.tb-group',
        h('button.btn.only-icon', { disabled: !S.undo.length, onclick: undo, title: T('Geri al (Ctrl+Z)', 'Undo (Ctrl+Z)'), 'aria-label': T('Geri al', 'Undo') }, icon('undo')),
        h('button.btn.ghost', { onclick: () => { S.sel = n === S.pages.length ? new Set() : new Set(S.pages.map((p) => p.key)); draw(); } }, n === S.pages.length && n ? T('Seçimi kaldır', 'Deselect') : T('Tümünü seç', 'Select all'))),
      h('div.tb-spacer'),
      h('div.tb-group.save',
        nameInput, h('span.ext', '.pdf'),
        h('button.btn.primary', { onclick: () => exportPdf(S.pages, nameInput.value || defName) }, icon('download'), T('PDF\'i indir', 'Download PDF'))));

    const used = (s) => S.pages.filter((p) => p.src === s.id).length;
    const chips = h('div.chips',
      S.sources.map((s) => h('span.chip', { title: s.name }, h('i', { style: { background: s.color } }, s.label), h('span.chip-name', s.name), h('span.muted', `${used(s)}/${s.n}`))),
      h('span.status', n ? T(`${n} sayfa seçili`, `${n} selected`) + ' · ' : '', T(`Toplam ${S.pages.length} sayfa`, `${S.pages.length} pages total`)),
      h('label.zoomer', icon('zoom'), h('input', { type: 'range', min: 110, max: 320, value: parseInt(getComputedStyle(stage).getPropertyValue('--tw')) || 170, 'aria-label': T('Küçük resim boyutu', 'Thumbnail size'), oninput: (e) => stage.style.setProperty('--tw', e.target.value + 'px') })));

    const grid = h('div.grid');
    S.pages.forEach((p, i) => {
      const s = p.blank ? null : srcOf(p);
      const img = h('img', { alt: T(`Sayfa ${i + 1}`, `Page ${i + 1}`), draggable: false });
      const el = h('div.thumb' + (sel.has(p.key) ? '.sel' : ''), { 'data-key': p.key, tabIndex: 0 },
        h('div.paper' + (p.blank ? '.blank' : ''), p.blank ? h('span', T('Boş', 'Blank')) : img,
          h('div.acts',
            h('button', { title: T('Büyüt', 'Zoom'), 'aria-label': T('Büyüt', 'Zoom'), onclick: (e) => { e.stopPropagation(); preview(S.pages.indexOf(p)); } }, icon('zoom')),
            h('button', { title: T('Döndür', 'Rotate'), 'aria-label': T('Döndür', 'Rotate'), onclick: (e) => { e.stopPropagation(); rotate(new Set([p.key]), 90); } }, icon('rotate')),
            h('button', { title: T('Bu sayfayı başka dosyayla değiştir', 'Replace this page with a file'), 'aria-label': T('Değiştir', 'Replace'), onclick: (e) => { e.stopPropagation(); replace(new Set([p.key])); } }, icon('replace')),
            h('button.danger', { title: T('Sil', 'Delete'), 'aria-label': T('Sil', 'Delete'), onclick: (e) => { e.stopPropagation(); del(new Set([p.key])); } }, icon('trash'))),
          h('span.tick', icon('check'))),
        h('div.cap', h('b', String(i + 1)), s ? h('span.tag', { style: { background: s.color }, title: `${s.name} — ${T('sayfa', 'page')} ${p.idx + 1}` }, `${s.label}${p.idx + 1}`) : null),
        h('button.ins', { title: T('Bu sayfadan sonra ekle', 'Insert after this page'), 'aria-label': T('Bu sayfadan sonra ekle', 'Insert after this page'), onclick: (e) => { e.stopPropagation(); insertMenu(S.pages.indexOf(p) + 1, e.currentTarget); } }, icon('plus')));
      el.addEventListener('click', (e) => {
        const idx = S.pages.indexOf(p);
        if (e.shiftKey && S.anchor != null) {
          const [a, b] = [Math.min(S.anchor, idx), Math.max(S.anchor, idx)];
          for (let k = a; k <= b; k++) S.sel.add(S.pages[k].key);
        } else { if (S.sel.has(p.key)) S.sel.delete(p.key); else S.sel.add(p.key); S.anchor = idx; }
        draw();
      });
      el.addEventListener('dblclick', () => preview(S.pages.indexOf(p)));
      grid.append(el);
      if (!p.blank) { const ck = `${p.src}:${p.idx}:${p.rot}`; if (thumbCache.has(ck)) img.src = thumbCache.get(ck); else io.observe(el); }
    });
    grid.append(h('button.thumb.add', { onclick: async () => addAt(await pickFiles(ACCEPT, true)) }, h('div.paper', icon('plus', 'big'), h('span', T('Sona dosya ekle', 'Add files at the end')))));

    const scroll = window.scrollY;
    stage.replaceChildren(tb, chips, grid, h('p.tip', T('İpucu: Sayfaları sürükleyerek sırala · Shift+tık ile aralık seç · Delete ile sil · Sayfanın sağındaki + ile araya ekle', 'Tip: drag pages to reorder · Shift+click selects a range · Delete removes · use + beside a page to insert')));
    window.scrollTo(0, scroll);
    if (window.Sortable) {
      sortable = window.Sortable.create(grid, {
        animation: 160, draggable: '.thumb:not(.add)', filter: '.acts, .ins', preventOnFilter: false, delay: 120, delayOnTouchOnly: true, ghostClass: 'ghost',
        onEnd: (e) => {
          const from = e.oldDraggableIndex, to = Math.min(e.newDraggableIndex, S.pages.length - 1);
          if (from === to) return draw();
          snapshot();
          const [m] = S.pages.splice(from, 1);
          S.pages.splice(to, 0, m);
          draw();
        },
      });
    }
  }

  const onKey = (e) => {
    if (!stage.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('.modal')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.size) { e.preventDefault(); del(new Set(S.sel)); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && S.pages.length) { e.preventDefault(); S.sel = new Set(S.pages.map((p) => p.key)); draw(); }
    else if (e.key === 'Escape' && S.sel.size) { S.sel = new Set(); draw(); }
  };
  document.addEventListener('keydown', onKey);
  // Sayfanın herhangi bir yerine dosya bırakma
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  stage.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length && S.sources.length) { e.preventDefault(); addAt([...e.dataTransfer.files].filter((f) => /\.(pdf|jpe?g|png|webp|gif|bmp)$/i.test(f.name))); } });

  draw();
  if (preset.length) addAt(preset);
  return { addAt, state: S, build };
}
