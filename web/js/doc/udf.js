// UYAP Doküman Editörü (.udf) okuma / yazma.
// UDF, içinde content.xml bulunan bir ZIP dosyasıdır. Metin tek bir CDATA bloğunda durur,
// biçimlendirme öğeleri bu metne startOffset/length ile başvurur.
import { newModel, A4 } from './layout.js';
import { T } from '../ui.js';

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const ALIGN = ['left', 'center', 'right', 'justify'];

function colorFromInt(v) {
  if (v == null || v === '') return null;
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  if (n < 0) n += 4294967296;
  const hex = '#' + (n & 0xffffff).toString(16).padStart(6, '0');
  return hex === '#000000' ? null : hex;
}
const colorToInt = (hex) => (parseInt(hex.slice(1), 16) | 0xff000000) | 0;

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function imageDims(bytes) {
  try { const bmp = await createImageBitmap(new Blob([bytes])); return { w: bmp.width, h: bmp.height }; } catch { return null; }
}

export async function parseUdf(bytes) {
  let xml;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await window.JSZip.loadAsync(bytes);
    const f = zip.file('content.xml') || zip.file(/content\.xml$/i)[0];
    if (!f) throw new Error(T('UDF içinde content.xml bulunamadı.', 'content.xml not found inside the UDF.'));
    xml = await f.async('string');
  } else xml = new TextDecoder('utf-8').decode(bytes);
  xml = xml.replace(/^﻿/, '');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror') || !dom.querySelector('template')) throw new Error(T('UDF dosyası okunamadı (bozuk XML).', 'Could not read UDF (invalid XML).'));
  const root = dom.querySelector('template');
  const text = [...root.children].find((c) => c.tagName === 'content')?.textContent ?? '';
  const model = newModel();

  const pf = root.querySelector('properties > pageFormat');
  if (pf) {
    model.margin = { l: num(pf.getAttribute('leftMargin'), 70.9), r: num(pf.getAttribute('rightMargin'), 70.9), t: num(pf.getAttribute('topMargin'), 70.9), b: num(pf.getAttribute('bottomMargin'), 70.9) };
    if (pf.getAttribute('paperOrientation') === '2') { model.pageW = A4.h; model.pageH = A4.w; }
  }

  // Stiller
  const styles = {};
  root.querySelectorAll('styles > style').forEach((s) => { styles[s.getAttribute('name')] = s; });
  const elements = root.querySelector('elements');
  const baseStyle = styles[elements?.getAttribute('resolver')] || styles['hvl-default'] || null;
  const base = { font: baseStyle?.getAttribute('family') || 'Times New Roman', size: num(baseStyle?.getAttribute('size'), 12) };

  const styleOf = (el) => {
    const st = styles[el.getAttribute('resolver')] || styles[el.getAttribute('style')] || null;
    const g = (k) => el.getAttribute(k) ?? st?.getAttribute(k);
    return {
      font: g('family') || base.font, size: num(g('size'), base.size),
      b: g('bold') === 'true', i: g('italic') === 'true', u: g('underline') === 'true', s: g('strikethrough') === 'true',
      color: colorFromInt(g('foreground')),
    };
  };

  const counters = {};
  async function para(el, kids) {
    const a = (k) => el?.getAttribute(k);
    const p = {
      type: 'p', align: ALIGN[parseInt(a('Alignment') || '0', 10)] || 'left',
      indL: num(a('LeftIndent')), indR: num(a('RightIndent')), indFirst: num(a('FirstLineIndent')),
      spaceBefore: num(a('SpaceAbove')), spaceAfter: num(a('SpaceBelow')),
      lineSpacing: 1 + Math.min(2, Math.max(0, num(a('LineSpacing')))), runs: [], size: base.size,
    };
    for (const c of kids || el.children) {
      const st = styleOf(c);
      const off = parseInt(c.getAttribute('startOffset') ?? '-1', 10), len = parseInt(c.getAttribute('length') ?? '0', 10);
      const tag = c.tagName;
      if (tag === 'content' || tag === 'field') {
        let s = off >= 0 ? text.substr(off, len) : (c.getAttribute('fieldName') || '');
        if (s) p.runs.push({ ...st, text: s });
        p.size = st.size;
      } else if (tag === 'space') p.runs.push({ ...st, text: ' ' });
      else if (tag === 'tab') p.runs.push({ tab: true, size: st.size, font: st.font });
      else if (tag === 'image') {
        try {
          const data = b64ToBytes(c.getAttribute('imageData') || '');
          const d = await imageDims(data);
          if (d) {
            const w = num(c.getAttribute('width')), hh = num(c.getAttribute('height'));
            p.runs.push({ image: { bytes: data, w: w || d.w * 0.75, h: hh || d.h * 0.75 } });
          }
        } catch { /* bozuk görsel */ }
      }
    }
    // Paragraf sonundaki satır sonu, paragraf ayracıdır
    const last = p.runs[p.runs.length - 1];
    if (last?.text) { last.text = last.text.replace(/\n$/, ''); if (!last.text) p.runs.pop(); }
    if (el && (a('Bulleted') === 'true' || a('Numbered') === 'true')) {
      const st = p.runs.find((r) => r.text) || base;
      let label = '•';
      if (a('Numbered') === 'true') { const id = a('ListId') || '0'; counters[id] = (counters[id] || 0) + 1; label = counters[id] + '.'; }
      p.runs.unshift({ text: label, font: st.font, size: st.size || base.size }, { tab: true, size: st.size || base.size });
      if (!p.indL) { p.indL = 36; p.indFirst = -18; }
    }
    return p;
  }

  async function blocksOf(parent) {
    const out = [];
    let loose = [];
    const flush = async () => { if (loose.length) { out.push(await para(null, loose)); loose = []; } };
    for (const el of parent.children) {
      const tag = el.tagName;
      if (tag === 'paragraph') { await flush(); out.push(await para(el)); }
      else if (tag === 'page-break') { await flush(); out.push({ type: 'pageBreak' }); }
      else if (tag === 'table') {
        await flush();
        const spans = (el.getAttribute('columnSpans') || '').split(',').map((s) => num(s)).filter((n) => n > 0);
        const rows = [];
        for (const r of el.children) {
          if (r.tagName !== 'row') continue;
          const cells = [];
          for (const c of r.children) if (c.tagName === 'cell') cells.push({ blocks: (await blocksOf(c)).filter((b) => b.type === 'p'), span: 1 });
          if (cells.length) rows.push({ cells });
        }
        const n = Math.max(parseInt(el.getAttribute('columnCount') || '0', 10), ...rows.map((r) => r.cells.length), 1);
        const cols = spans.length === n ? spans : Array(n).fill(100);
        if (rows.length) out.push({ type: 'table', cols, rows, border: (el.getAttribute('border') || 'borderCell') !== 'borderNone', fit: true });
      } else if (['content', 'field', 'space', 'tab', 'image'].includes(tag)) loose.push(el);
    }
    await flush();
    return out;
  }

  if (elements) {
    for (const el of [...elements.children]) {
      if (el.tagName === 'header') model.header = (await blocksOf(el)).filter((b) => b.type === 'p');
      else if (el.tagName === 'footer') model.footer = (await blocksOf(el)).filter((b) => b.type === 'p');
    }
    const body = elements.cloneNode(true);
    [...body.children].forEach((c) => { if (c.tagName === 'header' || c.tagName === 'footer') c.remove(); });
    model.blocks = await blocksOf(body);
  }
  if (!model.blocks.length && text.trim()) {
    model.blocks = text.split('\n').map((line) => ({ type: 'p', align: 'left', runs: [{ text: line, font: base.font, size: base.size }], size: base.size }));
  }
  return model;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => (Math.round((n || 0) * 100) / 100).toFixed(1).replace(/\.0$/, '.0');

export async function modelToUdf(model) {
  let buf = '';
  const styleAttrs = (r) => {
    let s = `family="${esc(udfFamily(r.font))}" size="${Math.round(r.size || 12)}"`;
    if (r.b) s += ' bold="true"';
    if (r.i) s += ' italic="true"';
    if (r.u) s += ' underline="true"';
    if (r.s) s += ' strikethrough="true"';
    if (r.color) s += ` foreground="${colorToInt(r.color)}"`;
    return s;
  };
  const paraXml = (p) => {
    const parts = [];
    let lastStyle = { font: 'Times New Roman', size: p.size || 12 };
    for (const r of p.runs) {
      if (r.image) {
        parts.push(`<image family="Times New Roman" size="12" imageData="${bytesToB64(r.image.bytes)}" startOffset="${buf.length}" length="1" width="${Math.round(r.image.w)}" height="${Math.round(r.image.h)}" />`);
        buf += '￼';
      } else if (r.tab) {
        parts.push(`<tab ${styleAttrs({ ...lastStyle, ...r })} startOffset="${buf.length}" length="1" />`);
        buf += '\t';
      } else if (r.br) {
        parts.push(`<content ${styleAttrs(lastStyle)} startOffset="${buf.length}" length="1" />`);
        buf += '\n';
      } else if (r.text) {
        const t = r.text.replace(/\r/g, '');
        lastStyle = r;
        // Sekmeleri ayrı öğe olarak yaz
        for (const piece of t.split(/(\t)/)) {
          if (!piece) continue;
          if (piece === '\t') parts.push(`<tab ${styleAttrs(r)} startOffset="${buf.length}" length="1" />`);
          else parts.push(`<content ${styleAttrs(r)} startOffset="${buf.length}" length="${piece.length}" />`);
          buf += piece;
        }
      }
    }
    parts.push(`<content ${styleAttrs(lastStyle)} startOffset="${buf.length}" length="1" />`);
    buf += '\n';
    let a = `Alignment="${Math.max(0, ALIGN.indexOf(p.align || 'left'))}" LeftIndent="${f1(p.indL)}" RightIndent="${f1(p.indR)}"`;
    if (p.indFirst) a += ` FirstLineIndent="${f1(p.indFirst)}"`;
    if (p.spaceBefore) a += ` SpaceAbove="${f1(p.spaceBefore)}"`;
    if (p.spaceAfter) a += ` SpaceBelow="${f1(p.spaceAfter)}"`;
    if ((p.lineSpacing || 1) > 1.2) a += ` LineSpacing="${f1(p.lineSpacing - 1)}"`;
    return `<paragraph ${a}>${parts.join('')}</paragraph>`;
  };
  const blocksXml = (blocks) => blocks.map((b) => {
    if (b.type === 'p') return paraXml(b);
    if (b.type === 'pageBreak') return '<page-break />';
    if (b.type === 'table') {
      const total = b.cols.reduce((x, y) => x + y, 0) || 1;
      const n = b.cols.length;
      const spans = b.cols.map((w) => Math.max(1, Math.round((w / total) * 450))).join(',');
      const rows = b.rows.map((r, ri) => {
        const cells = [];
        for (const c of r.cells) {
          const ps = c.blocks.filter((x) => x.type === 'p');
          cells.push(`<cell>${(ps.length ? ps : [{ type: 'p', runs: [] }]).map(paraXml).join('')}</cell>`);
          for (let k = 1; k < (c.span || 1); k++) cells.push(`<cell>${paraXml({ type: 'p', runs: [] })}</cell>`);
        }
        while (cells.length < n) cells.push(`<cell>${paraXml({ type: 'p', runs: [] })}</cell>`);
        return `<row rowName="row${ri + 1}" rowType="dataRow">${cells.join('')}</row>`;
      }).join('');
      return `<table tableName="Sabit" columnCount="${n}" columnSpans="${spans}" border="${b.border ? 'borderCell' : 'borderNone'}">${rows}</table>`;
    }
    return '';
  }).join('\n');

  let els = '';
  if (model.header?.length) els += `<header>${blocksXml(model.header)}</header>\n`;
  els += blocksXml(model.blocks.length ? model.blocks : [{ type: 'p', runs: [] }]);
  if (model.footer?.length) els += `\n<footer>${blocksXml(model.footer)}</footer>`;
  const M = model.margin, land = model.pageW > model.pageH;
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<template format_id="1.8">
<content><![CDATA[${buf.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content>
<properties><pageFormat mediaSizeName="1" leftMargin="${M.l}" rightMargin="${M.r}" topMargin="${M.t}" bottomMargin="${M.b}" paperOrientation="${land ? 2 : 1}" headerFOffset="20.0" footerFOffset="20.0" /></properties>
<elements resolver="hvl-default">
${els}
</elements>
<styles><style name="default" description="Geçerli" family="Dialog" size="12" bold="false" italic="false" foreground="-13421773" FONT_ATTRIBUTE_KEY="javax.swing.plaf.FontUIResource[family=Dialog,name=Dialog,style=plain,size=12]" /><style name="hvl-default" family="Times New Roman" size="12" description="Gövde" /></styles>
</template>`;
  const zip = new window.JSZip();
  zip.file('content.xml', xml, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function udfFamily(f) {
  if (!f) return 'Times New Roman';
  if (/liberation ?serif|^serif$/i.test(f)) return 'Times New Roman';
  if (/liberation ?sans|^sans/i.test(f)) return 'Arial';
  return f;
}
