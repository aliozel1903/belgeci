// Belge modeli → PDF. Basit ama Türkçe destekli bir sayfa düzeni motoru.
//
// Model:
//   { pageW, pageH, margin:{t,r,b,l}, blocks:[...], header:[p], footer:[p] }
//   p     = { type:'p', align, indL, indR, indFirst, spaceBefore, spaceAfter, lineSpacing, runs:[run] }
//   run   = { text, b, i, u, s, size, font, color:'#rrggbb' } | { tab:true, size } | { br:true }
//           | { image:{ bytes, w, h } }          (w,h pt)
//   table = { type:'table', cols:[w..], rows:[{cells:[{blocks:[p], span}]}], border }
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

const TAB = 35.4;
const LEAD = 1.15;
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f​‌‍﻿￼]/g, '').replace(/ /g, ' ');

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
  const SUBST = { '₺': 'TL', '✓': 'x', '✔': 'x', '☐': '[ ]', '☑': '[x]', '☒': '[x]', '●': '•', '■': '•', '▪': '•', '◦': 'o', '‑': '-', '−': '-' };
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
  const bottom = PH - M.b;
  let page = pdf.addPage([PW, PH]);
  let y = M.t; // üstten ölçülen imleç

  const newPage = () => { page = pdf.addPage([PW, PH]); y = M.t; };

  // 2) Paragrafı satırlara böl
  function compose(p, width) {
    const indL = p.indL || 0, indR = p.indR || 0, indFirst = p.indFirst || 0;
    const tokens = [];
    let lastSize = 12;
    for (const r of p.runs) {
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
      const parts = safe(clean(r.text ?? ''), font).split(/(\n|\t| +)/);
      for (const part of parts) {
        if (!part) continue;
        if (part === '\n') tokens.push({ type: 'br', size });
        else if (part === '\t') tokens.push({ type: 'tab', size, font, run: r });
        else tokens.push({ type: part[0] === ' ' ? 'space' : 'word', text: part, size, font, run: r, w: font.widthOfTextAtSize(part, size) });
      }
    }
    const lines = [];
    let line = null;
    const avail = (first) => width - indL - indR - (first ? indFirst : 0);
    const start = () => { line = { items: [], w: 0, first: lines.length === 0, size: 0, imgH: 0, hard: false, tab: false }; };
    const push = () => { lines.push(line); line = null; };
    start();
    for (const tk of tokens) {
      if (tk.type === 'br') { line.hard = true; if (!line.size) line.size = tk.size; push(); start(); continue; }
      const max = avail(line.first);
      if (tk.type === 'tab') {
        const off = (line.first ? indFirst : 0);
        let x = line.w + off; // paragraf sol kenarına göre
        let nx = x < 0 ? 0 : (Math.floor(x / TAB + 1e-6) + 1) * TAB;
        if (nx - off > max) { push(); start(); nx = TAB; line.items.push({ ...tk, x: 0, w: nx }); line.w = nx; }
        else { line.items.push({ ...tk, x: line.w, w: nx - x }); line.w = nx - off; }
        line.tab = true; line.size = Math.max(line.size, tk.size);
        continue;
      }
      if (tk.type === 'image') {
        if (line.w + tk.w > max + 0.01 && line.items.length) { push(); start(); }
        line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.imgH = Math.max(line.imgH, tk.h);
        continue;
      }
      if (tk.type === 'space') {
        if (!line.items.length && !line.first) continue; // satır başı boşluğu at
        line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.size = Math.max(line.size, tk.size);
        continue;
      }
      // kelime
      if (line.w + tk.w > max + 0.01) {
        if (line.items.some((i) => i.type !== 'space')) { push(); start(); }
        // tek başına sığmayan kelimeyi harf harf böl
        let rest = tk.text;
        while (tk.font.widthOfTextAtSize(rest, tk.size) > avail(line.first) && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && tk.font.widthOfTextAtSize(rest.slice(0, n), tk.size) > avail(line.first)) n--;
          const piece = rest.slice(0, n);
          line.items.push({ ...tk, text: piece, x: line.w, w: tk.font.widthOfTextAtSize(piece, tk.size) });
          line.size = Math.max(line.size, tk.size);
          push(); start();
          rest = rest.slice(n);
        }
        const w = tk.font.widthOfTextAtSize(rest, tk.size);
        line.items.push({ ...tk, text: rest, x: line.w, w }); line.w += w; line.size = Math.max(line.size, tk.size);
        continue;
      }
      line.items.push({ ...tk, x: line.w }); line.w += tk.w; line.size = Math.max(line.size, tk.size);
    }
    push();
    const ls = Math.min(3, Math.max(0.8, p.lineSpacing || 1));
    lines.forEach((ln, i) => {
      if (!ln.size) ln.size = tokens.length ? (tokens[0].size || 12) : (p.runs[0]?.size || p.size || 12);
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
      pg.drawText(seg.text, { x: seg.x, y: by, size: seg.size, font: seg.font, color });
      const t = Math.max(0.5, seg.size / 18);
      if (r.u) pg.drawLine({ start: { x: seg.x, y: by - seg.size * 0.12 }, end: { x: seg.x + seg.w, y: by - seg.size * 0.12 }, thickness: t, color });
      if (r.s) pg.drawLine({ start: { x: seg.x, y: by + seg.size * 0.28 }, end: { x: seg.x + seg.w, y: by + seg.size * 0.28 }, thickness: t, color });
      seg = null;
    };
    for (const it of ln.items) {
      const ix = ox + it.x + shift;
      if (it.type === 'image') { flush(); pg.drawImage(it.emb, { x: ix, y: PH - (top + ln.h) + 1, width: it.w, height: it.h }); continue; }
      if (it.type === 'tab') { flush(); continue; }
      if (it.type === 'space' && extra) {
        if (seg && seg.run === it.run && (it.run.u || it.run.s)) { seg.text += it.text; seg.w += it.w + extra; flush(); } else flush();
        shift += extra; continue;
      }
      if (seg && seg.run === it.run && seg.size === it.size) { seg.text += it.text; seg.w += it.w; }
      else { flush(); seg = { text: it.text, x: ix, w: it.w, size: it.size, font: it.font, run: it.run }; }
    }
    flush();
  }

  function drawPara(p, x, width, flow) {
    const lines = compose(p, width);
    if (flow) y += p.spaceBefore || 0;
    for (const ln of lines) {
      if (flow && y + ln.h > bottom + 0.5 && y > M.t + 0.5) newPage();
      drawLine(ln, p, x, y, page);
      y += ln.h;
    }
    if (flow) y += p.spaceAfter || 0;
  }

  const PAD = 4;
  function drawTable(tb) {
    const total = tb.cols.reduce((a, b) => a + b, 0) || 1;
    const k = contentW / Math.max(total, 1);
    const cols = tb.cols.map((w) => (total > contentW || tb.fit ? w * k : w));
    const tableW = cols.reduce((a, b) => a + b, 0);
    const x0 = M.l + (tb.align === 'center' ? (contentW - tableW) / 2 : 0);
    const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: PH - y1 }, end: { x: x2, y: PH - y2 }, thickness: 0.6, color: rgb(0, 0, 0) });
    for (const row of tb.rows) {
      // hücreleri ölç
      let ci = 0;
      const cells = row.cells.map((c) => {
        const span = Math.max(1, c.span || 1);
        const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0) || cols[cols.length - 1] || 50;
        const x = x0 + cols.slice(0, ci).reduce((a, b) => a + b, 0);
        ci += span;
        const paras = (c.blocks || []).filter((b) => b.type === 'p').map((p) => ({ p, lines: compose(p, w - PAD * 2) }));
        const hgt = paras.reduce((a, q) => a + (q.p.spaceBefore || 0) + q.lines.reduce((s, l) => s + l.h, 0) + (q.p.spaceAfter || 0), 0) + PAD * 2;
        return { x, w, paras, hgt };
      });
      const rowH = Math.max(14, ...cells.map((c) => c.hgt));
      if (y + rowH > bottom + 0.5 && y > M.t + 0.5) newPage();
      for (const c of cells) {
        let cy = y + PAD;
        for (const q of c.paras) {
          cy += q.p.spaceBefore || 0;
          for (const ln of q.lines) {
            if (cy + ln.h > PH - 4) break; // sayfadan taşan içerik kırpılır
            drawLine(ln, q.p, c.x + PAD, cy, page); cy += ln.h;
          }
          cy += q.p.spaceAfter || 0;
        }
        if (tb.border) {
          const yb = Math.min(y + rowH, PH - 4);
          line(c.x, y, c.x + c.w, y); line(c.x, yb, c.x + c.w, yb); line(c.x, y, c.x, yb); line(c.x + c.w, y, c.x + c.w, yb);
        }
      }
      y += rowH;
      if (y > bottom) newPage();
    }
    y += 4;
  }

  // 4) Akış
  const blocks = model.blocks || [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (i % 200 === 0) { progress?.(null, i / blocks.length); await new Promise((r) => setTimeout(r)); }
    if (b.type === 'pageBreak') { if (i < blocks.length - 1) newPage(); }
    else if (b.type === 'table') drawTable(b);
    else if (b.type === 'p') drawPara(b, M.l, contentW, true);
  }

  // 5) Üstbilgi / altbilgi
  if (model.header?.length || model.footer?.length) {
    for (const pg of pdf.getPages()) {
      page = pg;
      if (model.header?.length) { y = Math.min(24, M.t / 3); for (const p of model.header) if (p.type === 'p') drawPara(p, M.l, contentW, false); }
      if (model.footer?.length) {
        const hgt = model.footer.reduce((a, p) => a + (p.type === 'p' ? compose(p, contentW).reduce((s, l) => s + l.h, 0) : 0), 0);
        y = PH - Math.min(24, M.b / 3) - hgt;
        for (const p of model.footer) if (p.type === 'p') drawPara(p, M.l, contentW, false);
      }
    }
  }
  return pdf.save({ useObjectStreams: true });
}

/** Modelden düz metin */
export function modelToText(model) {
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.type === 'p') out.push(b.runs.map((r) => (r.tab ? '\t' : r.br ? '\n' : r.image ? '' : r.text || '')).join(''));
      else if (b.type === 'table') b.rows.forEach((r) => out.push(r.cells.map((c) => c.blocks.filter((x) => x.type === 'p').map((p) => p.runs.map((x) => x.text || '').join('')).join(' ')).join('\t')));
      else if (b.type === 'pageBreak') out.push('\f');
    }
  };
  walk(model.blocks);
  return out.join('\n');
}
