// Belge modeli → PDF. Basit ama Türkçe destekli bir sayfa düzeni motoru.
//
// Model:
//   { pageW, pageH, margin:{t,r,b,l}, blocks:[...], header:[p], footer:[p], headerOffset?, footerOffset? }
//   p     = { type:'p', align, indL, indR, indFirst, spaceBefore, spaceAfter, lineSpacing, runs:[run],
//             tabs?:[{pos, align:'left'|'center'|'right'|'decimal', leader:'none'|'dot'|'hyphen'|'underscore'|'equals'}],
//             tabStep?, tabOrigin? }     (sekme konumları sol kenar boşluğuna göre, pt)
//   run   = { text, b, i, u, s, size, font, color:'#rrggbb', bg?, va?:'sup'|'sub' } | { tab:true, size } | { br:true }
//           | { image:{ bytes, w, h } } | { field:'page'|'pages', ... }
//   table = { type:'table', cols:[w..], rows:[{cells:[{blocks:[p], span, fill?, valign?, borders?}]}], border }
//           (borders: 1 üst, 2 sağ, 4 alt, 8 sol)
//   { type:'pageBreak' }
import { lib, fontBytes, embedImageFile, hexColor } from '../pdfcore.js';

export const A4 = { w: 595.28, h: 841.89 };
export const newModel = () => ({ pageW: A4.w, pageH: A4.h, margin: { t: 70.9, r: 70.9, b: 70.9, l: 70.9 }, blocks: [], header: [], footer: [] });

export function fontKind(family = '') {
  const f = String(family).toLowerCase();
  if (!f) return 'serif';
  if (/arial|helvet|calibri|sans|verdana|tahoma|segoe|dialog|carlito|roboto|open|trebuchet|aptos|inter|gothic|franklin/.test(f)) return 'sans';
  return 'serif';
}

/** Paragrafın sekme durakları (açık duraklar + asılı girinti durağı + varsayılan ızgara), sol kenara göre. */
export function tabStopsFor(p, width = 1e4) {
  const explicit = (p.tabs || []).filter((s) => Number.isFinite(s.pos)).slice().sort((a, b) => a.pos - b.pos);
  const out = [...explicit];
  const indL = p.indL || 0, indFirst = p.indFirst || 0;
  if (indFirst < 0 && !explicit.some((s) => s.pos > indL + indFirst + 0.01 && s.pos < indL - 0.01)) out.push({ pos: indL, align: 'left', leader: 'none', implicit: true });
  const step = p.tabStep ?? 35.4;
  if (step > 0) {
    const origin = p.tabOrigin ?? 0;
    const last = explicit.length ? explicit[explicit.length - 1].pos : -Infinity;
    for (let k = 1; k < 400; k++) {
      const pos = origin + k * step;
      if (pos > width + 0.01) break;
      if (pos > last + 0.01) out.push({ pos, align: 'left', leader: 'none', dflt: true });
    }
  }
  out.sort((a, b) => a.pos - b.pos);
  return out.filter((s, i) => i === 0 || s.pos - out[i - 1].pos > 0.5);
}

/** Paragraf yalnızca "Sayfa 3 / 10" gibi alanlardan mı oluşuyor? */
export function fieldsOnly(p) {
  if (!p.runs?.some((r) => r.field)) return false;
  const rest = p.runs.filter((r) => !r.field).map((r) => (r.text || '')).join('');
  return rest.replace(/sayfa|page|sf\.?|of|toplam|no/gi, '').replace(/[\s/\-–—.|:()]/g, '') === '';
}

const TAB = 35.4;
const LEAD = 1.15;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f​‌‍﻿￼]/g, '').replace(/ /g, ' ');
const LEADER_CH = { dot: '.', hyphen: '-', underscore: '_', equals: '=' };

export async function modelToPdf(model, progress) {
  const { PDFDocument, rgb } = lib();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);

  // 1) Kullanılan yazı tiplerini ve görselleri önceden göm
  const fonts = {};
  const need = new Set(['serif-']);
  const images = new Map();
  const allParas = [];
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (b.type === 'p') allParas.push(b);
      else if (b.type === 'table') b.rows.forEach((r) => r.cells.forEach((c) => walk(c.blocks)));
    }
  };
  walk(model.blocks); walk(model.header); walk(model.footer);
  const fkey = (r) => `${fontKind(r.font)}-${r.b ? 'b' : ''}${r.i ? 'i' : ''}`;
  for (const p of allParas) for (const r of p.runs) { if (r.image) images.set(r.image, null); else need.add(fkey(r)); }
  for (const key of need) {
    const [kind, st] = key.split('-');
    const style = st === 'bi' ? 'BoldItalic' : st === 'b' ? 'Bold' : st === 'i' ? 'Italic' : 'Regular';
    fonts[key] = await pdf.embedFont(await fontBytes(`Liberation${kind === 'serif' ? 'Serif' : 'Sans'}-${style}.ttf`), { subset: true });
  }
  for (const im of images.keys()) {
    try { images.set(im, await embedImageFile(pdf, im.bytes)); } catch { images.set(im, null); }
  }

  // Yazı tipinde bulunmayan karakterleri okunur bir karşılıkla değiştir
  const SUBST = { '₺': 'TL', '✓': 'x', '✔': 'x', '☐': '[ ]', '☑': '[x]', '☒': '[x]', '●': '•', '■': '•', '▪': '•', '◦': 'o', '‣': '•', '›': '>', '‑': '-', '−': '-' };
  const charsets = new Map();
  function safe(text, font) {
    let set = charsets.get(font);
    if (!set) { set = new Set(font.getCharacterSet()); charsets.set(font, set); }
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 10 || cp === 9 || set.has(cp)) out += ch;
      else if (cp >= 0xf000 && cp <= 0xf0ff) out += '•'; // Symbol/Wingdings madde imleri
      else out += SUBST[ch] ?? '?';
    }
    return out;
  }

  const PW = model.pageW || A4.w, PH = model.pageH || A4.h;
  const M = model.margin || { t: 70, r: 70, b: 70, l: 70 };
  const contentW = PW - M.l - M.r;
  let topY = M.t, bottom = PH - M.b;
  let page = null;
  let y = topY; // üstten ölçülen imleç

  const newPage = () => { page = pdf.addPage([PW, PH]); y = topY; };

  // 2) Paragrafı satırlara böl. ctx: { page, pages } (sayfa numarası alanları için)
  function compose(p, width, ctx) {
    const indL = p.indL || 0, indR = p.indR || 0, indFirst = p.indFirst || 0;
    const stops = tabStopsFor(p, width - indR);
    const tokens = [];
    let lastSize = 12;
    for (const r0 of p.runs) {
      let r = r0;
      if (r.field) r = { ...r, text: ctx ? String(ctx[r.field] ?? '') : '' };
      const size = r.size || 12;
      if (r.image) {
        const emb = images.get(r.image);
        if (!emb) continue;
        let w = r.image.w || emb.width * 0.75, hh = r.image.h || emb.height * 0.75;
        const s = Math.min(1, (width - indL - indR) / w, (PH - M.t - M.b - 4) / hh);
        tokens.push({ type: 'image', emb, w: w * s, h: hh * s, size: lastSize });
        continue;
      }
      lastSize = size;
      if (r.br) { tokens.push({ type: 'br', size }); continue; }
      const font = fonts[fkey(r)];
      if (r.tab) { tokens.push({ type: 'tab', size, font, run: r }); continue; }
      const es = r.va ? size * 0.66 : size;
      const rise = r.va === 'sup' ? size * 0.34 : r.va === 'sub' ? -size * 0.12 : 0;
      const parts = safe(clean(r.text ?? ''), font).split(/(\n|\t| +)/);
      for (const part of parts) {
        if (!part) continue;
        if (part === '\n') tokens.push({ type: 'br', size });
        else if (part === '\t') tokens.push({ type: 'tab', size, font, run: r });
        else tokens.push({ type: part[0] === ' ' ? 'space' : 'word', text: part, size: es, ls: size, rise, font, run: r, w: font.widthOfTextAtSize(part, es) });
      }
    }
    const lines = [];
    let line = null, pend = null;
    const avail = (first) => width - indL - indR - (first ? indFirst : 0);
    const start = () => { line = { items: [], w: 0, first: lines.length === 0, size: 0, imgH: 0, hard: false, tab: false }; pend = null; };
    // Sağa/ortaya hizalı sekmeden sonraki metni durağa göre yerleştir
    const gapFor = (seg) => (pend.align === 'center' ? pend.target - seg / 2 : pend.target - seg);
    const effW = (add) => {
      if (!pend) return line.w + add;
      const seg = line.w - (pend.item.x + pend.item.w) + add;
      return pend.item.x + Math.max(0, gapFor(seg)) + seg;
    };
    const resolve = () => {
      if (!pend) return;
      const seg = line.w - (pend.item.x + pend.item.w);
      const gap = Math.max(0, gapFor(seg));
      const d = gap - pend.item.w;
      pend.item.w = gap;
      for (let k = pend.idx + 1; k < line.items.length; k++) line.items[k].x += d;
      line.w += d;
      pend = null;
    };
    const push = () => { resolve(); lines.push(line); line = null; };
    start();
    for (const tk of tokens) {
      const lsz = tk.ls || tk.size;
      if (tk.type === 'br') { line.hard = true; if (!line.size) line.size = tk.size; push(); start(); continue; }
      const max = avail(line.first);
      if (tk.type === 'tab') {
        resolve();
        const place = () => {
          const off = line.first ? indFirst : 0;
          const cur = indL + off + line.w; // sol kenara göre
          const st = stops.find((s) => s.pos > cur + 0.01);
          let nx = st ? st.pos : cur + 5;
          if (!st && (p.tabStep ?? TAB) > 0) { const step = p.tabStep ?? TAB, o = p.tabOrigin ?? 0; nx = o + (Math.floor((cur - o) / step + 1e-6) + 1) * step; }
          return { cur, nx, st };
        };
        let { cur, nx, st } = place();
        if (nx > width - indR + 0.01 && line.items.length) { push(); start(); ({ cur, nx, st } = place()); }
        if (nx > width - indR + 0.01) nx = cur;
        const item = { ...tk, x: line.w, w: Math.max(0, nx - cur), leader: st?.leader || 'none' };
        line.items.push(item); line.w += item.w;
        line.tab = true; line.size = Math.max(line.size, tk.size);
        if (st && (st.align === 'right' || st.align === 'center' || st.align === 'decimal')) pend = { item, idx: line.items.length - 1, target: item.w, align: st.align === 'center' ? 'center' : 'right' };
        continue;
      }
      if (tk.type === 'image') {
        if (effW(tk.w) > max + 0.01 && line.items.length) { push(); start(); }
        line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.imgH = Math.max(line.imgH, tk.h);
        continue;
      }
      if (tk.type === 'space') {
        if (!line.items.length && !line.first) continue; // satır başı boşluğu at
        line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.size = Math.max(line.size, lsz);
        continue;
      }
      // kelime
      if (effW(tk.w) > max + 0.01) {
        if (line.items.some((i) => i.type !== 'space')) { push(); start(); }
        // tek başına sığmayan kelimeyi harf harf böl
        let rest = tk.text;
        while (tk.font.widthOfTextAtSize(rest, tk.size) > avail(line.first) && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && tk.font.widthOfTextAtSize(rest.slice(0, n), tk.size) > avail(line.first)) n--;
          const piece = rest.slice(0, n);
          line.items.push({ ...tk, text: piece, x: line.w, w: tk.font.widthOfTextAtSize(piece, tk.size) });
          line.size = Math.max(line.size, lsz);
          push(); start();
          rest = rest.slice(n);
        }
        const w = tk.font.widthOfTextAtSize(rest, tk.size);
        line.items.push({ ...tk, text: rest, x: line.w, w }); line.w += w; line.size = Math.max(line.size, lsz);
        continue;
      }
      line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.size = Math.max(line.size, lsz);
    }
    push();
    const ls = Math.min(3, Math.max(0.8, p.lineSpacing || 1));
    lines.forEach((ln, i) => {
      if (!ln.size) ln.size = tokens.length ? (tokens[0].ls || tokens[0].size || 12) : (p.runs[0]?.size || p.size || 12);
      // sondaki boşlukları genişlikten düş
      while (ln.items.length && ln.items[ln.items.length - 1].type === 'space') ln.w -= ln.items.pop().w;
      const textH = ln.size * LEAD * ls;
      ln.h = Math.max(textH, ln.imgH ? ln.imgH + 2 : 0);
      ln.base = ln.h - (ln.imgH > textH ? 2 : (textH - ln.size * LEAD) / 2 + ln.size * LEAD - ln.size * 0.89);
      ln.last = i === lines.length - 1;
      ln.max = avail(ln.first);
      ln.x0 = indL + (ln.first ? indFirst : 0);
    });
    return lines;
  }
  const paraHeight = (p, width, ctx) => (p.spaceBefore || 0) + compose(p, width, ctx).reduce((s, l) => s + l.h, 0) + (p.spaceAfter || 0);

  // 3) Satır çiz
  function drawLine(ln, p, x, top, pg) {
    let ox = x + ln.x0;
    const free = ln.max - ln.w;
    let extra = 0;
    if (p.align === 'center') ox += free / 2;
    else if (p.align === 'right') ox += free;
    else if (p.align === 'justify' && !ln.last && !ln.hard && !ln.tab && free > 0) {
      const spaces = ln.items.filter((i) => i.type === 'space').length;
      if (spaces && free < ln.max * 0.4) extra = free / spaces;
    }
    const by = PH - (top + ln.base);
    let shift = 0, seg = null;
    const flush = () => {
      if (!seg) return;
      const r = seg.run, color = r.color ? hexColor(r.color) : rgb(0, 0, 0);
      const sy = by + (seg.rise || 0);
      if (r.bg) pg.drawRectangle({ x: seg.x, y: sy - seg.size * 0.24, width: seg.w, height: seg.size * 1.16, color: hexColor(r.bg) });
      pg.drawText(seg.text, { x: seg.x, y: sy, size: seg.size, font: seg.font, color });
      const t = Math.max(0.5, seg.size / 18);
      if (r.u) pg.drawLine({ start: { x: seg.x, y: sy - seg.size * 0.12 }, end: { x: seg.x + seg.w, y: sy - seg.size * 0.12 }, thickness: t, color });
      if (r.s) pg.drawLine({ start: { x: seg.x, y: sy + seg.size * 0.28 }, end: { x: seg.x + seg.w, y: sy + seg.size * 0.28 }, thickness: t, color });
      seg = null;
    };
    for (const it of ln.items) {
      const ix = ox + it.x + shift;
      if (it.type === 'image') { flush(); pg.drawImage(it.emb, { x: ix, y: PH - (top + ln.h) + 1, width: it.w, height: it.h }); continue; }
      if (it.type === 'tab') {
        flush();
        const ch = LEADER_CH[it.leader];
        if (ch && it.w > it.size) {
          const cw = it.font.widthOfTextAtSize(ch, it.size);
          const n = Math.floor((it.w - it.size * 0.3) / cw);
          if (n > 0) pg.drawText(ch.repeat(n), { x: ix + it.w - n * cw - it.size * 0.15, y: by, size: it.size, font: it.font, color: rgb(0, 0, 0) });
        } else if (it.run?.u && it.w > 0) {
          pg.drawLine({ start: { x: ix, y: by - it.size * 0.12 }, end: { x: ix + it.w, y: by - it.size * 0.12 }, thickness: Math.max(0.5, it.size / 18), color: rgb(0, 0, 0) });
        }
        continue;
      }
      if (it.type === 'space' && extra) {
        if (seg && seg.run === it.run && (it.run.u || it.run.s)) { seg.text += it.text; seg.w += it.w + extra; flush(); } else flush();
        shift += extra; continue;
      }
      if (seg && seg.run === it.run && seg.size === it.size) { seg.text += it.text; seg.w += it.w; }
      else { flush(); seg = { text: it.text, x: ix, w: it.w, size: it.size, font: it.font, run: it.run, rise: it.rise }; }
    }
    flush();
  }

  function drawPara(p, x, width, flow, ctx) {
    const lines = compose(p, width, ctx);
    if (flow) y += p.spaceBefore || 0;
    for (const ln of lines) {
      if (flow && y + ln.h > bottom + 0.5 && y > topY + 0.5) newPage();
      drawLine(ln, p, x, y, page);
      y += ln.h;
    }
    if (flow) y += p.spaceAfter || 0;
  }

  const PAD = 4;
  function tableRows(tb, ctx) {
    const total = tb.cols.reduce((a, b) => a + b, 0) || 1;
    const k = contentW / Math.max(total, 1);
    const cols = tb.cols.map((w) => (total > contentW || tb.fit ? w * k : w));
    const tableW = cols.reduce((a, b) => a + b, 0);
    const x0 = M.l + (tb.align === 'center' ? (contentW - tableW) / 2 : 0);
    return tb.rows.map((row) => {
      let ci = 0;
      const cells = row.cells.map((c) => {
        const span = Math.max(1, c.span || 1);
        const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0) || cols[cols.length - 1] || 50;
        const x = x0 + cols.slice(0, ci).reduce((a, b) => a + b, 0);
        ci += span;
        const paras = (c.blocks || []).filter((b) => b.type === 'p').map((p) => ({ p, lines: compose(p, w - PAD * 2, ctx) }));
        const hgt = paras.reduce((a, q) => a + (q.p.spaceBefore || 0) + q.lines.reduce((s2, l) => s2 + l.h, 0) + (q.p.spaceAfter || 0), 0) + PAD * 2;
        return { c, x, w, paras, hgt };
      });
      return { cells, h: Math.max(14, ...cells.map((c) => c.hgt)) };
    });
  }
  function drawTable(tb, flow = true, ctx) {
    const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: PH - y1 }, end: { x: x2, y: PH - y2 }, thickness: 0.6, color: rgb(0, 0, 0) });
    for (const { cells, h: rowH } of tableRows(tb, ctx)) {
      if (flow && y + rowH > bottom + 0.5 && y > topY + 0.5) newPage();
      for (const cl of cells) {
        const yb = Math.min(y + rowH, PH - 4);
        if (cl.c.fill) page.drawRectangle({ x: cl.x, y: PH - yb, width: cl.w, height: yb - y, color: hexColor(cl.c.fill) });
        let cy = y + PAD + (cl.c.valign === 'middle' ? (rowH - cl.hgt) / 2 : cl.c.valign === 'bottom' ? rowH - cl.hgt : 0);
        for (const q of cl.paras) {
          cy += q.p.spaceBefore || 0;
          for (const ln of q.lines) {
            if (cy + ln.h > PH - 4) break; // sayfadan taşan içerik kırpılır
            drawLine(ln, q.p, cl.x + PAD, cy, page); cy += ln.h;
          }
          cy += q.p.spaceAfter || 0;
        }
        const bits = cl.c.borders ?? (tb.border ? 15 : 0);
        if (bits & 1) line(cl.x, y, cl.x + cl.w, y);
        if (bits & 4) line(cl.x, yb, cl.x + cl.w, yb);
        if (bits & 8) line(cl.x, y, cl.x, yb);
        if (bits & 2) line(cl.x + cl.w, y, cl.x + cl.w, yb);
      }
      y += rowH;
      if (flow && y > bottom) newPage();
    }
    y += 4;
  }

  // 4) Üstbilgi / altbilgi için yer ayır (gövde onlarla çakışmasın)
  const header = (model.header || []).filter((b) => b.type === 'p' || b.type === 'table');
  const footer = (model.footer || []).filter((b) => b.type === 'p' || b.type === 'table');
  const blockH = (b, ctx) => (b.type === 'table' ? tableRows(b, ctx).reduce((a, r) => a + r.h, 0) + 4 : paraHeight(b, contentW, ctx));
  const drawBlock = (b, ctx) => {
    if (b.type === 'table') { drawTable(b, false, ctx); return; }
    y += b.spaceBefore || 0; drawPara(b, M.l, contentW, false, ctx); y += b.spaceAfter || 0;
  };
  const clampOff = (v, d) => Math.max(10, Math.min(Number.isFinite(v) ? v : d, 72));
  const headerTop = clampOff(model.headerOffset, Math.min(24, M.t / 3));
  const footerBottom = PH - clampOff(model.footerOffset, Math.min(24, M.b / 3));
  const sample = { page: 88, pages: 88 };
  const hH = header.reduce((a, b) => a + blockH(b, sample), 0);
  const fH = footer.reduce((a, b) => a + blockH(b, sample), 0);
  if (hH) topY = Math.max(M.t, headerTop + hH + 4);
  if (fH) bottom = Math.min(PH - M.b, footerBottom - fH - 4);
  if (bottom - topY < 100) { topY = M.t; bottom = PH - M.b; }

  // 5) Akış
  newPage();
  const blocks = model.blocks || [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (i % 200 === 0) { progress?.(null, i / blocks.length); await new Promise((r) => setTimeout(r)); }
    if (b.type === 'pageBreak') { if (i < blocks.length - 1) newPage(); }
    else if (b.type === 'table') drawTable(b);
    else if (b.type === 'p') drawPara(b, M.l, contentW, true);
  }

  // 6) Üstbilgi / altbilgiyi her sayfaya çiz
  if (header.length || footer.length) {
    const pages = pdf.getPages();
    pages.forEach((pg, i) => {
      page = pg;
      const ctx = { page: i + 1, pages: pages.length };
      if (header.length) { y = headerTop; for (const b of header) drawBlock(b, ctx); }
      if (footer.length) { y = footerBottom - footer.reduce((a, b) => a + blockH(b, ctx), 0); for (const b of footer) drawBlock(b, ctx); }
    });
  }
  return pdf.save({ useObjectStreams: true });
}

/** Modelden düz metin */
export function modelToText(model) {
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.type === 'p') out.push(b.runs.map((r) => (r.tab ? '\t' : r.br ? '\n' : r.image || r.field ? '' : r.text || '')).join(''));
      else if (b.type === 'table') b.rows.forEach((r) => out.push(r.cells.map((c) => c.blocks.filter((x) => x.type === 'p').map((p) => p.runs.map((x) => x.text || '').join('')).join(' ')).join('\t')));
      else if (b.type === 'pageBreak') out.push('\f');
    }
  };
  walk(model.blocks);
  return out.join('\n');
}
