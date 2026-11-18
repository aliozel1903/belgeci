// Metin Düzelt: sayfadaki bir satıra tıkla, yazıyı değiştir. Eski metnin üstü zemin rengiyle örtülür,
// yeni metin aynı yere, benzer boyut ve yazı tipiyle yazılır. İstenirse düzeltilen sayfalar görüntüye
// çevrilerek eski metin dosyadan tamamen silinir.
import { T, h, icon, dropzone, toast, busy, download, baseName, readFile, errText } from './ui.js';
import * as core from './pdfcore.js';

// Liberation yazı tiplerinin ölçüleri (em cinsinden)
const ASC = { sans: 0.905, serif: 0.891 };
const DESC = { sans: 0.212, serif: 0.216 };
const LINE = 1.2;
const CSS_FONT = { sans: "'BelgeciSans', Arial, sans-serif", serif: "'BelgeciSerif', 'Times New Roman', serif" };

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function renderEditText(root, preset = []) {
  const S = { file: null, view: null, pages: [], items: [], seq: 0, mode: 'text', flatten: false };
  const stage = h('div.et');
  root.append(stage);
  let bar = null, pagesEl = null, io = null;

  async function open(f) {
    try {
      const bytes = await readFile(f);
      const view = await core.openView(bytes, f.name, 'modify');
      S.view?.destroy();
      Object.assign(S, { file: { name: f.name, bytes }, view, items: [], pages: [] });
      draw();
    } catch (e) { console.error(e); toast(errText(e), 'error', 7000); }
  }

  // ── sayfadaki metin satırları (pt, görünen sayfanın sol-üst köşesine göre) ──
  async function linesOf(pg) {
    if (pg.lines) return pg.lines;
    const page = await S.view.getPage(pg.n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    try { await page.getOperatorList(); } catch { /* yazı tipi adları olmadan devam */ }
    const items = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str) continue;
      const tx = core.pdfjs.Util.transform(vp.transform, it.transform);
      if (Math.abs(tx[1]) > Math.abs(tx[0]) * 0.2) continue; // yatay olmayan metin
      const fh = Math.hypot(tx[2], tx[3]);
      if (!fh) continue;
      let real = '';
      try { real = page.commonObjs.get(it.fontName)?.name || ''; } catch { /* yazı tipi henüz yüklenmedi */ }
      const fam = (tc.styles[it.fontName]?.fontFamily || '') + ' ' + real;
      const serif = /times|serif|roman|georgia|garamond|cambria|book/i.test(fam) && !/sans/i.test(fam);
      items.push({ str: it.str, x: tx[4], base: tx[5], w: it.width * vp.scale, fh, kind: serif ? 'serif' : 'sans', bold: /bold|black|heavy|semibold/i.test(real) });
    }
    // Aynı satırdaki bitişik parçaları birleştir
    items.sort((a, b) => (Math.abs(a.base - b.base) < Math.min(a.fh, b.fh) * 0.3 ? a.x - b.x : a.base - b.base));
    const lines = [];
    for (const it of items) {
      const ln = lines[lines.length - 1];
      const gap = ln ? it.x - (ln.x + ln.w) : 0;
      if (ln && Math.abs(ln.base - it.base) < Math.min(ln.fh, it.fh) * 0.3 && gap < it.fh * 1.2 && gap > -it.fh && Math.abs(ln.fh - it.fh) < ln.fh * 0.3) {
        if (gap > it.fh * 0.15 && !/\s$/.test(ln.str) && !/^\s/.test(it.str)) ln.str += ' ';
        ln.str += it.str;
        ln.w = Math.max(ln.w, it.x + it.w - ln.x);
        ln.bold = ln.bold && it.bold;
      } else lines.push({ ...it });
    }
    for (const ln of lines) {
      ln.str = ln.str.replace(/\s+$/, '');
      ln.top = ln.base - ln.fh * ASC[ln.kind];
      ln.h = ln.fh * (ASC[ln.kind] + DESC[ln.kind]);
    }
    pg.lines = lines.filter((l) => l.str.trim());
    page.cleanup();
    return pg.lines;
  }

  // ── renkleri ekrandaki görüntüden tahmin et ──
  function sampleColors(pg, x, y, w, hh) {
    const c = pg.canvas;
    const out = { bg: '#ffffff', color: '#000000' };
    if (!c) return out;
    const k = c.width / pg.vw;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const clampX = (v) => Math.max(0, Math.min(c.width - 1, Math.round(v)));
    const clampY = (v) => Math.max(0, Math.min(c.height - 1, Math.round(v)));
    // kenar boyunca zemin rengi
    const counts = new Map();
    const pad = 2;
    for (let i = 0; i <= 24; i++) {
      for (const [px, py] of [[x + (w * i) / 24, y - pad], [x + (w * i) / 24, y + hh + pad], [x - pad, y + (hh * i) / 24], [x + w + pad, y + (hh * i) / 24]]) {
        const d = ctx.getImageData(clampX(px * k), clampY(py * k), 1, 1).data;
        const key = [d[0], d[1], d[2]].map((v) => Math.round(v / 8) * 8).join(',');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    out.bg = toHex(...bg.map((v) => Math.min(255, v)));
    // iç bölgedeki en koyu piksel = yazı rengi
    const data = ctx.getImageData(clampX(x * k), clampY(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(hh * k))).data;
    let best = null, bl = 1e9;
    for (let i = 0; i < data.length; i += 4) { const l = luminance(data[i], data[i + 1], data[i + 2]); if (l < bl) { bl = l; best = [data[i], data[i + 1], data[i + 2]]; } }
    if (best && luminance(...bg) - bl > 60) out.color = bl < 60 ? '#000000' : toHex(...best);
    return out;
  }

  // ── düzeltme öğesi ──
  function addItem(pg, it, focus = true) {
    it.id = ++S.seq; it.page = pg.n;
    S.items.push(it);
    mount(pg, it, focus);
    drawBar();
  }
  function removeItem(it) {
    S.items = S.items.filter((x) => x !== it);
    it.el?.remove();
    drawBar();
  }

  function mount(pg, it, focus) {
    const k = () => pg.el.clientWidth / pg.vw;
    const txt = h('span.et-txt', { contentEditable: 'true', spellcheck: false });
    txt.innerText = it.text;
    const el = h('div.et-item' + (it.area ? '.area' : ''), { 'data-id': it.id }, txt);
    const btn = (label, title, fn, cls = '') => h('button' + cls, { title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); fn(); sync(); txt.focus(); } }, label);
    const tools = h('div.et-tools',
      btn(it.kind === 'serif' ? 'Serif' : 'Sans', T('Yazı tipini değiştir', 'Switch font'), () => { it.kind = it.kind === 'serif' ? 'sans' : 'serif'; it.styled = true; tools.firstChild.textContent = it.kind === 'serif' ? 'Serif' : 'Sans'; }),
      btn('B', T('Kalın', 'Bold'), () => { it.bold = !it.bold; it.styled = true; }, '.b'),
      btn('A−', T('Küçült', 'Smaller'), () => { it.size = Math.max(4, Math.round((it.size - 0.5) * 2) / 2); it.styled = true; }),
      btn('A+', T('Büyüt', 'Larger'), () => { it.size = Math.min(96, Math.round((it.size + 0.5) * 2) / 2); it.styled = true; }),
      h('span.et-size'),
      btn(icon('x'), T('Düzeltmeyi kaldır', 'Remove edit'), () => removeItem(it), '.x'));
    el.append(tools);
    function sync() {
      const s = k();
      Object.assign(el.style, { left: it.x * s + 'px', top: it.y * s + 'px', minWidth: it.w * s + 'px', height: it.h * s + 'px', background: it.bg });
      const asc = ASC[it.kind];
      // Yazının taban çizgisini asıl metnin taban çizgisine oturt
      const halfLead = (LINE - asc - DESC[it.kind]) / 2;
      Object.assign(txt.style, {
        fontFamily: CSS_FONT[it.kind], fontWeight: it.bold ? '700' : '400', fontSize: it.size * s + 'px', lineHeight: String(LINE),
        top: (it.baseline - (halfLead + asc) * it.size) * s + 'px', color: it.color, background: it.bg,
      });
      tools.querySelector('.b').classList.toggle('on', !!it.bold);
      tools.querySelector('.et-size').textContent = it.size + ' pt';
    }
    it.el = el; el._sync = sync;
    txt.addEventListener('input', () => { it.text = txt.innerText.replace(/\n$/, ''); drawBar(); });
    txt.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    txt.addEventListener('keydown', (e) => { if (e.key === 'Escape') txt.blur(); });
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    pg.el.append(el);
    sync();
    if (focus) {
      txt.focus();
      const r = document.createRange(); r.selectNodeContents(txt); r.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  }

  async function clickText(pg, x, y) {
    const lines = await linesOf(pg);
    const hit = lines.find((l) => x >= l.x - 2 && x <= l.x + l.w + 2 && y >= l.top - 2 && y <= l.top + l.h + 2);
    if (!hit) {
      toast(T('Burada seçilebilir metin yok. Taranmış bir sayfaysa "Alan seç" ile kutu çizip yazabilirsin.', 'No selectable text here. For scanned pages use "Select area" to draw a box and type.'), 'warn', 5000);
      return;
    }
    const existing = S.items.find((it) => it.page === pg.n && Math.abs(it.x - hit.x) < 1 && Math.abs(it.y - (hit.top - 1)) < 1);
    if (existing) { existing.el.querySelector('.et-txt').focus(); return; }
    const box = { x: hit.x - 1, y: hit.top - 1, w: hit.w + 2, h: hit.h + 2 };
    const col = sampleColors(pg, box.x, box.y, box.w, box.h);
    addItem(pg, { ...box, text: hit.str, orig: hit.str, size: Math.round(hit.fh * 2) / 2, kind: hit.kind, bold: hit.bold, baseline: hit.base - box.y, ...col });
  }

  function dragArea(pg, e) {
    const r = pg.el.getBoundingClientRect();
    const k = r.width / pg.vw;
    const sx = (e.clientX - r.left) / k, sy = (e.clientY - r.top) / k;
    const ghost = h('div.et-rubber');
    pg.el.append(ghost);
    let box = { x: sx, y: sy, w: 0, h: 0 };
    const move = (ev) => {
      const cx = (ev.clientX - r.left) / k, cy = (ev.clientY - r.top) / k;
      box = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
      Object.assign(ghost.style, { left: box.x * k + 'px', top: box.y * k + 'px', width: box.w * k + 'px', height: box.h * k + 'px' });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      ghost.remove();
      if (box.w < 6 || box.h < 6) return;
      const size = Math.max(6, Math.min(24, Math.round(box.h * 0.6)));
      const col = sampleColors(pg, box.x, box.y, box.w, box.h);
      addItem(pg, { ...box, text: '', orig: '', area: true, size, kind: 'sans', bold: false, baseline: Math.min(box.h - 2, size * ASC.sans + (box.h - size * 1.12) / 2), bg: col.bg, color: '#000000' });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── PDF'e uygula ──
  const changed = (it) => it.area || it.styled || it.text !== it.orig;
  async function save() {
    const list = S.items.filter(changed);
    if (!list.length) return toast(T('Henüz bir değişiklik yapmadın.', 'You have not changed anything yet.'), 'warn');
    const b = busy(T('PDF hazırlanıyor…', 'Preparing PDF…'));
    try {
      const { degrees, PDFDocument } = core.lib();
      const doc = await core.loadDoc(S.file.bytes, S.file.name);
      const fonts = {};
      const fontOf = async (kind, bold) => (fonts[kind + bold] ||= await core.embedFont(doc, kind, bold));
      for (const it of list) {
        const page = doc.getPage(it.page - 1);
        const { vh } = core.visualSize(page);
        const font = await fontOf(it.kind, !!it.bold);
        const bg = core.hexColor(it.bg), color = core.hexColor(it.color);
        const lines = it.text.split('\n');
        const rects = [{ x: it.x, y: it.y, w: it.w, h: it.h }];
        lines.forEach((ln, i) => {
          const base = it.y + it.baseline + i * it.size * LINE;
          let tw = 0;
          try { tw = font.widthOfTextAtSize(ln, it.size); } catch { tw = ln.length * it.size * 0.5; }
          if (tw) rects.push({ x: it.x, y: base - it.size * ASC[it.kind] - 0.5, w: tw + 1.5, h: it.size * (ASC[it.kind] + DESC[it.kind]) + 1 });
        });
        for (const r of rects) {
          const p = core.visualToPdf(page, r.x, vh - r.y - r.h);
          page.drawRectangle({ x: p.x, y: p.y, width: r.w, height: r.h, color: bg, rotate: degrees(p.angle), borderWidth: 0 });
        }
        lines.forEach((ln, i) => {
          if (!ln) return;
          core.drawVisualText(page, ln, font, { vx: it.x + (it.area ? 2 : 1), vy: vh - (it.y + it.baseline + i * it.size * LINE), size: it.size, color });
        });
      }
      let out = await core.saveDoc(doc);
      if (S.flatten) {
        // Düzeltilen sayfaları görüntüye çevir: eski metin dosyadan tamamen kalkar
        b.set(T('Eski metin siliniyor…', 'Removing old text…'));
        const edited = new Set(list.map((it) => it.page));
        const view = await core.openView(out, S.file.name);
        const src = await PDFDocument.load(out);
        const fin = await PDFDocument.create();
        const copies = await fin.copyPages(src, src.getPageIndices());
        for (let i = 0; i < copies.length; i++) {
          if (!edited.has(i + 1)) { fin.addPage(copies[i]); continue; }
          const pg = await view.getPage(i + 1);
          const vp = pg.getViewport({ scale: 1 });
          const c = await core.renderPage(view, i + 1, { scale: 200 / 72, maxPixels: 30e6 });
          const img = await fin.embedJpg(await core.blobBytes(await core.canvasBlob(c, 'image/jpeg', 0.92)));
          fin.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          c.width = c.height = 0;
        }
        view.destroy();
        out = await core.saveDoc(fin);
      }
      download(out, baseName(S.file.name) + '_duzeltildi.pdf');
      b.close();
      toast(T('PDF indirildi.', 'PDF downloaded.'), 'ok');
    } catch (e) { b.close(); console.error(e); toast(errText(e), 'error', 7000); }
  }

  // ── çizim ──
  function drawBar() {
    if (!bar) return;
    const n = S.items.filter(changed).length;
    const mode = (m, label, ic) => h('button.btn' + (S.mode === m ? '.on' : ''), { onclick: () => { S.mode = m; drawBar(); } }, icon(ic), label);
    bar.replaceChildren(
      h('div.tb-group', mode('text', T('Metne tıkla', 'Click text'), 'text'), mode('area', T('Alan seç', 'Select area'), 'blank')),
      h('label.check', h('input', { type: 'checkbox', checked: S.flatten, onchange: (e) => { S.flatten = e.target.checked; } }),
        h('span', { title: T('Düzeltilen sayfalar görüntüye çevrilir; o sayfalardaki metin artık seçilemez.', 'Edited pages are flattened to images; their text is no longer selectable.') }, T('Eski metni dosyadan tamamen sil', 'Fully remove old text'))),
      h('span.status', n ? T(`${n} düzeltme`, `${n} edit(s)`) : (S.mode === 'text' ? T('Değiştirmek istediğin satıra tıkla', 'Click the line you want to change') : T('Kutu çizmek için sürükle', 'Drag to draw a box'))),
      h('div.tb-spacer'),
      h('button.btn.ghost', { onclick: () => { S.file = null; S.view?.destroy(); S.view = null; draw(); } }, T('Başka dosya', 'Another file')),
      h('button.btn.primary', { disabled: !n, onclick: save }, icon('download'), T('Uygula ve indir', 'Apply & download')));
    pagesEl?.classList.toggle('area', S.mode === 'area');
  }

  function draw() {
    io?.disconnect();
    if (!S.file) {
      bar = pagesEl = null;
      stage.replaceChildren(
        dropzone({ accept: '.pdf', onFiles: ([f]) => open(f), hint: 'PDF' }),
        h('div.steps',
          h('div.step', h('b', '1'), h('div', h('strong', T('Satıra tıkla', 'Click a line')), h('p', T('Değiştirmek istediğin yazının üstüne tıkla; satır düzenlenebilir hale gelir.', 'Click the text you want to change; the line becomes editable.')))),
          h('div.step', h('b', '2'), h('div', h('strong', T('Yaz', 'Type')), h('p', T('Yazıyı değiştir. Boyut, kalınlık ve yazı tipi otomatik eşleşir; gerekirse ayarla.', 'Change the text. Size, weight and font are matched automatically; adjust if needed.')))),
          h('div.step', h('b', '3'), h('div', h('strong', T('İndir', 'Download')), h('p', T('Eski yazının üstü kapatılır, yenisi aynı yere yazılır.', 'The old text is covered and the new text is written in its place.'))))),
        h('p.note', T('Not: Eski metin varsayılan olarak beyaz kutunun altında dosyada kalır ve kopyalanarak görülebilir. Tamamen silinmesini istiyorsan "Eski metni dosyadan tamamen sil" seçeneğini işaretle.', 'Note: by default the old text stays in the file under the cover and can be revealed by copying. Tick "Fully remove old text" to erase it completely.')));
      return;
    }
    bar = h('div.toolbar');
    pagesEl = h('div.et-pages');
    stage.replaceChildren(bar, pagesEl);
    drawBar();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const pg = e.target._pg;
        if (!e.isIntersecting || pg.rendering) continue;
        pg.rendering = true;
        core.renderPage(S.view, pg.n, { width: Math.min(2000, pg.el.clientWidth * Math.min(2, window.devicePixelRatio || 1)) }).then((c) => { pg.canvas = c; pg.el.prepend(c); });
      }
    }, { rootMargin: '800px' });
    (async () => {
      for (let n = 1; n <= S.view.numPages; n++) {
        const page = await S.view.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const el = h('div.et-page', { style: { aspectRatio: `${vp.width} / ${vp.height}`, maxWidth: Math.round(vp.width * 1.6) + 'px' } }, h('span.pg-no', String(n)));
        const pg = { n, el, vw: vp.width, vh: vp.height };
        el._pg = pg;
        S.pages.push(pg);
        el.addEventListener('click', (e) => {
          if (S.mode !== 'text') return;
          const r = el.getBoundingClientRect();
          clickText(pg, ((e.clientX - r.left) / r.width) * pg.vw, ((e.clientY - r.top) / r.height) * pg.vh).catch((err) => toast(errText(err), 'error'));
        });
        el.addEventListener('pointerdown', (e) => { if (S.mode === 'area' && e.button === 0) { e.preventDefault(); dragArea(pg, e); } });
        pagesEl.append(el);
        io.observe(el);
      }
    })();
  }

  const onResize = () => { if (!stage.isConnected) return window.removeEventListener('resize', onResize); S.items.forEach((it) => it.el?._sync?.()); };
  window.addEventListener('resize', onResize);

  draw();
  if (preset[0]) open(preset[0]);
  return { open, state: S, save, clickText, linesOf };
}
