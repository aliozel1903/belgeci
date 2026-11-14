// PDF → belge modeli (metin tabanlı, sezgisel). Word/UDF'e dönüştürmek için kullanılır.
// Metin içermeyen (taranmış) sayfalar tam sayfa görsel olarak aktarılır.
import { openView, renderPage, canvasBlob, blobBytes } from '../pdfcore.js';
import { newModel } from './layout.js';
import { T } from '../ui.js';

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export async function pdfToModel(bytes, name, progress) {
  const view = await openView(bytes, name);
  const model = newModel();
  const pages = [];
  for (let n = 1; n <= view.numPages; n++) {
    progress?.(T(`Sayfa ${n} / ${view.numPages} okunuyor`, `Reading page ${n} / ${view.numPages}`), (n - 1) / view.numPages);
    const page = await view.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    if (n === 1) { model.pageW = vp.width; model.pageH = vp.height; }
    const tc = await page.getTextContent();
    const fontInfo = {};
    const info = (fontName) => {
      if (fontInfo[fontName]) return fontInfo[fontName];
      let real = '';
      try { real = page.commonObjs.get(fontName)?.name || ''; } catch { /* henüz yüklenmedi */ }
      const fam = tc.styles[fontName]?.fontFamily || '';
      const key = (real + ' ' + fam).toLowerCase();
      const sans = /arial|helvet|calibri|verdana|tahoma|segoe|sans|roboto|carlito|dejavusans|liberationsans/.test(key) && !/sans-serif.*times|serif$/.test(real.toLowerCase());
      return (fontInfo[fontName] = { b: /bold|black|heavy|semibold|demi/i.test(real), i: /italic|oblique/i.test(real), font: sans && !/times|serif(?!.*sans)/.test(real.toLowerCase()) ? 'Arial' : 'Times New Roman' });
    };
    let items = tc.items.filter((it) => 'str' in it && it.str !== '');
    if (items.some((it) => it.str.trim())) { try { await page.getOperatorList(); } catch { /* yazı tipi adları olmadan devam */ } }
    items = items.map((it) => {
      const [a, b, , , e, f] = it.transform;
      const size = Math.hypot(a, b) || it.height || 10;
      const [x, yTop] = vp.convertToViewportPoint(e, f);
      return { str: it.str, x, y: yTop, w: it.width, size, rot: Math.abs(b) > Math.abs(a), ...info(it.fontName) };
    }).filter((it) => !it.rot);

    if (!items.some((it) => it.str.trim())) {
      // Taranmış sayfa → görsel
      const c = await renderPage(view, n, { scale: 150 / 72 });
      const data = await blobBytes(await canvasBlob(c, 'image/jpeg', 0.82));
      pages.push({ image: { bytes: data, w: vp.width, h: vp.height }, w: vp.width, h: vp.height });
      c.width = c.height = 0;
      continue;
    }

    // Satırlara grupla
    items.sort((p, q) => (Math.abs(p.y - q.y) < Math.min(p.size, q.size) * 0.45 ? p.x - q.x : p.y - q.y));
    const lines = [];
    for (const it of items) {
      const ln = lines[lines.length - 1];
      if (ln && Math.abs(ln.y - it.y) < Math.min(ln.size, it.size) * 0.45) ln.items.push(it);
      else lines.push({ y: it.y, size: it.size, items: [it] });
    }
    for (const ln of lines) {
      ln.items.sort((p, q) => p.x - q.x);
      const runs = [];
      let prev = null;
      for (const it of ln.items) {
        let str = it.str;
        if (prev) {
          const gap = it.x - (prev.x + prev.w);
          const sp = it.size * 0.2;
          if (gap > it.size * 2.5) runs.push({ tab: true, size: it.size, gap });
          else if (gap > sp && !/\s$/.test(prev.str) && !/^\s/.test(str)) str = ' ' + str;
        }
        const last = runs[runs.length - 1];
        if (last && !last.tab && last.b === it.b && last.i === it.i && Math.abs(last.size - it.size) < 0.6 && last.font === it.font) last.text += str;
        else runs.push({ text: str, b: it.b, i: it.i, size: Math.round(it.size * 2) / 2, font: it.font });
        prev = it;
      }
      const first = ln.items.find((i) => i.str.trim()) || ln.items[0], lastIt = [...ln.items].reverse().find((i) => i.str.trim()) || ln.items[ln.items.length - 1];
      ln.x0 = first.x; ln.x1 = lastIt.x + lastIt.w; ln.runs = runs;
      ln.size = Math.max(...ln.items.map((i) => i.size));
      ln.empty = !ln.items.some((i) => i.str.trim());
    }
    pages.push({ lines: lines.filter((l) => !l.empty), w: vp.width, h: vp.height });
  }
  view.destroy();

  // Sayfa kenar boşlukları (tüm belge için)
  const all = pages.flatMap((p) => p.lines || []);
  if (all.length) {
    const Lm = Math.min(...all.map((l) => l.x0)), Rm = Math.max(...all.map((l) => l.x1));
    const tops = pages.filter((p) => p.lines?.length).map((p) => p.lines[0].y - p.lines[0].size);
    const bots = pages.filter((p) => p.lines?.length).map((p) => p.h - p.lines[p.lines.length - 1].y);
    model.margin = {
      l: Math.max(18, Math.min(Lm, 140)), r: Math.max(18, Math.min(model.pageW - Rm, 140)),
      t: Math.max(18, Math.min(Math.min(...tops), 120)), b: Math.max(18, Math.min(Math.min(...bots) - 4, 100)),
    };
    const pitch = [];
    for (const p of pages) for (let i = 1; i < (p.lines?.length || 0); i++) pitch.push(p.lines[i].y - p.lines[i - 1].y);
    const normPitch = median(pitch.filter((d) => d > 2)) || 14;
    const L = model.margin.l, Rr = model.pageW - model.margin.r, width = Rr - L;

    pages.forEach((pg, pi) => {
      if (pi > 0) model.blocks.push({ type: 'pageBreak' });
      if (pg.image) { model.blocks.push({ type: 'p', align: 'center', runs: [{ image: fitImage(pg.image, width, model.pageH - model.margin.t - model.margin.b) }] }); return; }
      let cur = null, prev = null;
      const close = () => {
        if (!cur) return;
        const ls = cur.lines;
        const p = { type: 'p', runs: [], spaceBefore: cur.spaceBefore, spaceAfter: 0, lineSpacing: 1, size: ls[0].size };
        const lg = ls[0].x0 - L, rg = Rr - ls[0].x1;
        if (ls.length === 1) {
          if (Math.abs(lg - rg) < Math.max(4, width * 0.02) && lg > width * 0.04) p.align = 'center';
          else if (rg < 4 && lg > width * 0.45) p.align = 'right';
          else { p.align = 'left'; p.indL = lg > 3 ? Math.round(lg) : 0; }
        } else {
          const rest = Math.min(...ls.slice(1).map((l) => l.x0)) - L;
          const centered = ls.every((l) => Math.abs((l.x0 - L) - (Rr - l.x1)) < Math.max(4, width * 0.02)) && ls.some((l) => l.x0 - L > width * 0.04);
          const full = ls.slice(0, -1).every((l) => Rr - l.x1 < Math.max(6, l.size * 0.6));
          p.align = centered ? 'center' : full ? 'justify' : 'left';
          if (!centered) { p.indL = rest > 3 ? Math.round(rest) : 0; const fi = lg - rest; p.indFirst = Math.abs(fi) > 3 ? Math.round(fi) : 0; }
          if (ls.length > 2) { const d = median(ls.slice(1).map((l, i) => l.y - ls[i].y)); p.lineSpacing = Math.min(2.5, Math.max(1, Math.round((d / (ls[0].size * 1.15)) * 20) / 20)); }
        }
        ls.forEach((l, i) => {
          for (const r of l.runs) {
            if (r.tab) { if (p.align === 'left' || p.align === 'justify') p.runs.push({ tab: true, size: r.size }); else p.runs.push({ text: '   ', size: r.size }); continue; }
            const last = p.runs[p.runs.length - 1];
            if (last && last.text != null && last.b === r.b && last.i === r.i && last.size === r.size && last.font === r.font) last.text += r.text;
            else p.runs.push({ ...r });
          }
          if (i < ls.length - 1) {
            const last = p.runs[p.runs.length - 1];
            if (p.align === 'center' || cur.hard) p.runs.push({ br: true, size: l.size });
            else if (last?.text != null && !/\s$/.test(last.text)) last.text += ' ';
          }
        });
        model.blocks.push(p);
        cur = null;
      };
      for (const ln of pg.lines) {
        const gap = prev ? ln.y - prev.y : 0;
        const short = prev && Rr - prev.x1 > Math.max(18, prev.size * 2);
        const indented = cur && cur.lines.length >= 1 && ln.x0 > (cur.lines.length > 1 ? Math.min(...cur.lines.slice(1).map((l) => l.x0)) : prev.x0) + 6 && cur.lines.length > 1;
        const outdent = cur && ln.x0 < cur.lines[cur.lines.length - 1].x0 - 6 && cur.lines.length > 1;
        const tabbed = ln.runs.some((r) => r.tab) || (prev && prev.runs.some((r) => r.tab));
        const brk = !cur || gap > Math.max(normPitch * 1.45, prev.size * 1.7) || gap < 0 || short || indented || outdent || tabbed || Math.abs(ln.size - prev.size) > 1.5;
        if (brk) {
          close();
          const extra = prev ? Math.max(0, Math.min(60, gap - Math.max(normPitch, ln.size * 1.15))) : 0;
          cur = { lines: [ln], spaceBefore: Math.round(extra) };
        } else cur.lines.push(ln);
        prev = ln;
      }
      close();
    });
  } else {
    pages.forEach((pg, pi) => {
      if (pi > 0) model.blocks.push({ type: 'pageBreak' });
      const width = model.pageW - model.margin.l - model.margin.r;
      if (pg.image) model.blocks.push({ type: 'p', align: 'center', runs: [{ image: fitImage(pg.image, width, model.pageH - model.margin.t - model.margin.b) }] });
    });
  }
  return model;
}

function fitImage(im, maxW, maxH) {
  const s = Math.min(1, maxW / im.w, (maxH - 8) / im.h);
  return { bytes: im.bytes, w: im.w * s, h: im.h * s };
}
