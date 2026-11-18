// Word (.docx) okuma / yazma — ortak belge modeline çevirir.
import { newModel, tabStopsFor } from './layout.js';
import { T } from '../ui.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) : undefined);
const wa = (el, name) => (el ? el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name) : null);
const on = (el) => { if (!el) return undefined; const v = wa(el, 'val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); };
const tw = (v) => (v == null || v === '' ? undefined : parseFloat(v) / 20);

const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000' };
const TAB_ALIGN = { left: 'left', start: 'left', num: 'left', bar: 'left', center: 'center', right: 'right', end: 'right', decimal: 'decimal' };
const TAB_LEAD = { dot: 'dot', middleDot: 'dot', hyphen: 'hyphen', underscore: 'underscore', heavy: 'underscore' };

function readRPr(rPr, into = {}) {
  if (!rPr) return into;
  const set = (k, v) => { if (v !== undefined) into[k] = v; };
  set('b', on(kid(rPr, 'b'))); set('i', on(kid(rPr, 'i'))); set('s', on(kid(rPr, 'strike')));
  const u = kid(rPr, 'u'); if (u) into.u = wa(u, 'val') !== 'none';
  const sz = kid(rPr, 'sz'); if (sz) into.size = parseFloat(wa(sz, 'val')) / 2;
  const rf = kid(rPr, 'rFonts'); if (rf) { const f = wa(rf, 'ascii') || wa(rf, 'hAnsi') || wa(rf, 'cs'); if (f) into.font = f; else if (wa(rf, 'asciiTheme')) into.font = /major/i.test(wa(rf, 'asciiTheme')) ? into.themeMajor || 'Calibri' : into.themeMinor || 'Calibri'; }
  const col = kid(rPr, 'color'); if (col) { const v = wa(col, 'val'); into.color = v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v) && v !== '000000' ? '#' + v.toLowerCase() : null; }
  if (on(kid(rPr, 'vanish'))) into.hidden = true;
  const va = kid(rPr, 'vertAlign'); if (va) { const v = wa(va, 'val'); into.va = v === 'superscript' ? 'sup' : v === 'subscript' ? 'sub' : undefined; }
  const hl = kid(rPr, 'highlight'); if (hl) into.bg = HIGHLIGHT[wa(hl, 'val')] || null;
  const shd = kid(rPr, 'shd'); if (shd && !hl) { const f = wa(shd, 'fill'); into.bg = f && /^[0-9a-f]{6}$/i.test(f) && !/^f{6}$/i.test(f) ? '#' + f.toLowerCase() : null; }
  return into;
}
function readPPr(pPr, into = {}) {
  if (!pPr) return into;
  const jc = kid(pPr, 'jc');
  if (jc) into.align = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[wa(jc, 'val')] || 'left';
  const ind = kid(pPr, 'ind');
  if (ind) {
    const l = tw(wa(ind, 'left') ?? wa(ind, 'start')), r = tw(wa(ind, 'right') ?? wa(ind, 'end')), fl = tw(wa(ind, 'firstLine')), hg = tw(wa(ind, 'hanging'));
    if (l !== undefined) into.indL = l; if (r !== undefined) into.indR = r;
    if (hg !== undefined) into.indFirst = -hg; else if (fl !== undefined) into.indFirst = fl;
  }
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const b = tw(wa(sp, 'before')), a = tw(wa(sp, 'after')), line = wa(sp, 'line');
    if (b !== undefined) into.spaceBefore = b; if (a !== undefined) into.spaceAfter = a;
    if (line) { const rule = wa(sp, 'lineRule') || 'auto'; if (rule === 'auto') into.lineSpacing = parseFloat(line) / 240; else into.linePt = parseFloat(line) / 20; }
  }
  if (on(kid(pPr, 'pageBreakBefore'))) into.pageBreakBefore = true;
  const tabsEl = kid(pPr, 'tabs');
  if (tabsEl) {
    let list = [...(into.tabs || [])];
    for (const t of kids(tabsEl, 'tab')) {
      const pos = tw(wa(t, 'pos')); if (pos === undefined) continue;
      list = list.filter((x) => Math.abs(x.pos - pos) > 0.5);
      const v = wa(t, 'val');
      if (v !== 'clear') list.push({ pos, align: TAB_ALIGN[v] || 'left', leader: TAB_LEAD[wa(t, 'leader')] || 'none' });
    }
    into.tabs = list.sort((a, b) => a.pos - b.pos);
  }
  const numPr = kid(pPr, 'numPr');
  if (numPr) into.num = { id: wa(kid(numPr, 'numId'), 'val'), lvl: parseInt(wa(kid(numPr, 'ilvl'), 'val') || '0', 10) };
  return into;
}

const roman = (n) => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
const letter = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
function fmtNum(n, fmt) {
  switch (fmt) {
    case 'lowerLetter': return letter(n);
    case 'upperLetter': return letter(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    default: return String(n);
  }
}

export async function parseDocx(bytes) {
  let zip;
  try { zip = await window.JSZip.loadAsync(bytes); } catch { throw new Error(T('Dosya geçerli bir .docx değil. (Eski .doc dosyaları için yerel motor + LibreOffice gerekir.)', 'Not a valid .docx file. (Old .doc files need the local engine + LibreOffice.)')); }
  const xml = async (path) => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const docXml = await xml('word/document.xml');
  if (!docXml) throw new Error(T('Dosya geçerli bir .docx değil.', 'Not a valid .docx file.'));
  const stylesXml = await xml('word/styles.xml');
  const numXml = await xml('word/numbering.xml');
  const relsXml = await xml('word/_rels/document.xml.rels');
  const themeXml = await xml('word/theme/theme1.xml');

  const relMap = (dom) => { const m = {}; dom?.querySelectorAll('Relationship').forEach((r) => { m[r.getAttribute('Id')] = r.getAttribute('Target'); }); return m; };
  const docRels = relMap(relsXml);
  let rels = docRels;
  const settingsXml = await xml('word/settings.xml');
  const dts = settingsXml ? tw(wa(settingsXml.getElementsByTagNameNS(W, 'defaultTabStop')[0], 'val')) : undefined;
  const tabStep = dts > 0 ? dts : 35.4;

  const theme = {};
  if (themeXml) {
    const g = (n) => themeXml.getElementsByTagNameNS('*', n)[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface');
    theme.themeMajor = g('majorFont'); theme.themeMinor = g('minorFont');
  }

  // Stiller
  const styles = {};
  let defR = { ...theme, size: 10, font: 'Times New Roman' }, defP = {}, defParaStyle = null;
  if (stylesXml) {
    const root = stylesXml.documentElement;
    const dd = kid(root, 'docDefaults');
    readRPr(kid(kid(dd, 'rPrDefault'), 'rPr'), defR);
    readPPr(kid(kid(dd, 'pPrDefault'), 'pPr'), defP);
    for (const s of kids(root, 'style')) {
      const id = wa(s, 'styleId');
      styles[id] = { el: s, type: wa(s, 'type'), based: wa(kid(s, 'basedOn'), 'val'), pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr') };
      if (wa(s, 'type') === 'paragraph' && ['1', 'true'].includes(wa(s, 'default'))) defParaStyle = id;
    }
  }
  const chain = (id) => { const out = []; const seen = new Set(); while (id && styles[id] && !seen.has(id)) { seen.add(id); out.unshift(styles[id]); id = styles[id].based; } return out; };

  // Numaralandırma
  const nums = {}, abstracts = {}, counters = {};
  if (numXml) {
    const root = numXml.documentElement;
    for (const a of kids(root, 'abstractNum')) {
      const lv = {};
      for (const l of kids(a, 'lvl')) lv[wa(l, 'ilvl')] = { fmt: wa(kid(l, 'numFmt'), 'val') || 'decimal', text: wa(kid(l, 'lvlText'), 'val') || '', start: parseInt(wa(kid(l, 'start'), 'val') || '1', 10), pPr: kid(l, 'pPr') };
      abstracts[wa(a, 'abstractNumId')] = lv;
    }
    for (const n of kids(root, 'num')) nums[wa(n, 'numId')] = wa(kid(n, 'abstractNumId'), 'val');
  }
  function listLabel(num) {
    const lv = abstracts[nums[num.id]];
    const def = lv?.[num.lvl];
    if (!def) return null;
    const c = (counters[num.id] ||= {});
    c[num.lvl] = (c[num.lvl] ?? def.start - 1) + 1;
    for (const k of Object.keys(c)) if (+k > num.lvl) delete c[k];
    if (def.fmt === 'bullet') return { label: '•', def };
    if (def.fmt === 'none') return { label: '', def };
    const label = def.text.replace(/%(\d)/g, (_, d) => { const l = +d - 1; return fmtNum(c[l] ?? (lv[l]?.start ?? 1), lv[l]?.fmt); });
    return { label, def };
  }

  async function imageRun(node) {
    const blip = node.getElementsByTagNameNS('*', 'blip')[0];
    const imgdata = node.getElementsByTagNameNS('*', 'imagedata')[0];
    const rid = blip ? (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed')) : imgdata ? (imgdata.getAttributeNS(R, 'id') || imgdata.getAttribute('r:id')) : null;
    const target = rid && rels[rid];
    if (!target) return null;
    const f = zip.file(target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, ''));
    if (!f) return null;
    const data = await f.async('uint8array');
    let w, hh;
    const ext = node.getElementsByTagNameNS('*', 'extent')[0];
    if (ext) { w = parseFloat(ext.getAttribute('cx')) / 12700; hh = parseFloat(ext.getAttribute('cy')) / 12700; }
    try { const bmp = await createImageBitmap(new Blob([data])); if (!w) { w = bmp.width * 0.75; hh = bmp.height * 0.75; } } catch { return null; }
    return { image: { bytes: data, w, h: hh } };
  }

  async function paragraph(pEl, out) {
    const pPrEl = kid(pEl, 'pPr');
    const styleId = wa(kid(pPrEl, 'pStyle'), 'val') || defParaStyle;
    const ch = chain(styleId);
    const pp = { ...defP };
    const pr = { ...defR };
    for (const s of ch) { readPPr(s.pPr, pp); readRPr(s.rPr, pr); }
    const direct = readPPr(pPrEl, { tabs: pp.tabs });
    if (!direct.tabs?.length) delete direct.tabs;
    let label = null;
    const num = direct.num || pp.num;
    if (num && num.id !== '0') {
      const li = listLabel(num);
      if (li) { label = li.label; const lp = readPPr(li.def.pPr, {}); if (direct.indL === undefined && lp.indL !== undefined) { pp.indL = lp.indL; pp.indFirst = lp.indFirst ?? 0; } }
    }
    Object.assign(pp, direct);
    const markR = readRPr(kid(pPrEl, 'rPr'), { ...pr });
    let p = null;
    const start = () => {
      p = { type: 'p', align: pp.align || 'left', indL: pp.indL || 0, indR: pp.indR || 0, indFirst: pp.indFirst || 0, spaceBefore: pp.spaceBefore || 0, spaceAfter: pp.spaceAfter ?? 0, lineSpacing: pp.lineSpacing || 1, runs: [], size: markR.size || pr.size, tabStep };
      if (pp.tabs?.length) p.tabs = pp.tabs;
      if (pp.linePt) p.lineSpacing = Math.max(0.8, pp.linePt / ((markR.size || pr.size) * 1.15));
      out.push(p);
    };
    if (pp.pageBreakBefore && out.length) out.push({ type: 'pageBreak' });
    start();
    if (label != null && label !== '') p.runs.push({ text: label, font: pr.font, size: pr.size, b: pr.b }, { tab: true, size: pr.size });

    const style = (st) => { const o = { font: st.font, size: st.size, b: !!st.b, i: !!st.i, u: !!st.u, s: !!st.s, color: st.color || null }; if (st.va) o.va = st.va; if (st.bg) o.bg = st.bg; return o; };
    const PAGEF = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i;
    const fieldOf = (instr) => { const m = PAGEF.exec(instr || ''); return m ? (m[1].toUpperCase() === 'PAGE' ? 'page' : 'pages') : null; };
    let fld = null; // karmaşık alan durumu (PAGE / NUMPAGES)
    async function run(rEl) {
      const st = { ...pr };
      const rPrEl = kid(rEl, 'rPr');
      const rs = wa(kid(rPrEl, 'rStyle'), 'val');
      if (rs) for (const s of chain(rs)) readRPr(s.rPr, st);
      readRPr(rPrEl, st);
      if (st.hidden) return;
      for (const c of rEl.children) {
        switch (c.localName) {
          case 'fldChar': {
            const t = wa(c, 'fldCharType');
            if (t === 'begin') fld = { instr: '', res: false };
            else if (t === 'separate' && fld) { fld.res = true; const f = fieldOf(fld.instr); if (f) { fld.skip = true; fld.pend = f; } }
            else if (t === 'end') { const f = fld && (fld.pend || (!fld.res && fieldOf(fld.instr))); if (f) p.runs.push({ ...style(st), field: f, text: '' }); fld = null; }
            break;
          }
          case 'instrText': if (fld) fld.instr += c.textContent; break;
          case 't':
            if (fld?.skip) { if (fld.pend) { p.runs.push({ ...style(st), field: fld.pend, text: '' }); fld.pend = null; } break; }
            p.runs.push({ ...style(st), text: c.textContent }); break;
          case 'tab': p.runs.push({ tab: true, size: st.size, font: st.font }); break;
          case 'noBreakHyphen': p.runs.push({ ...style(st), text: '-' }); break;
          case 'cr': p.runs.push({ br: true, size: st.size }); break;
          case 'br':
            if (wa(c, 'type') === 'page') { out.push({ type: 'pageBreak' }); start(); }
            else if (wa(c, 'type') !== 'column') p.runs.push({ br: true, size: st.size });
            break;
          case 'drawing': case 'pict': case 'object': { const im = await imageRun(c); if (im) p.runs.push(im); break; }
          case 'AlternateContent': { const im = await imageRun(c); if (im) p.runs.push(im); break; }
        }
      }
    }
    async function inline(parent) {
      for (const c of parent.children) {
        const n = c.localName;
        if (n === 'r') await run(c);
        else if (n === 'fldSimple' && fieldOf(wa(c, 'instr'))) { const r0 = kids(c, 'r')[0]; const st = readRPr(kid(r0, 'rPr'), { ...pr }); p.runs.push({ ...style(st), field: fieldOf(wa(c, 'instr')), text: '' }); }
        else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple', 'moveTo', 'customXml', 'dir', 'bdo'].includes(n)) await inline(c);
      }
    }
    await inline(pEl);
  }

  async function table(tEl, out) {
    const grid = kids(kid(tEl, 'tblGrid'), 'gridCol').map((g) => tw(wa(g, 'w')) || 60);
    const tblPr = kid(tEl, 'tblPr');
    const borders = kid(tblPr, 'tblBorders');
    const styleId = wa(kid(tblPr, 'tblStyle'), 'val');
    let border = false;
    if (borders) border = [...borders.children].some((b) => !['none', 'nil'].includes(wa(b, 'val')));
    else if (styleId && !/^(TableNormal|NormalTablo|a1)$/i.test(styleId)) border = (styles[styleId]?.el.getElementsByTagNameNS(W, 'tblBorders').length || 0) > 0 || /grid|kılavuz/i.test(styleId);
    const rows = [];
    for (const tr of tEl.children) {
      if (tr.localName !== 'tr') continue;
      const cells = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = parseInt(wa(kid(tcPr, 'gridSpan'), 'val') || '1', 10);
        if (!borders && kid(tcPr, 'tcBorders') && [...kid(tcPr, 'tcBorders').children].some((b) => !['none', 'nil'].includes(wa(b, 'val')))) border = true;
        const blocks = [];
        await body(tc, blocks, true);
        const cell = { blocks: blocks.filter((b) => b.type === 'p'), span };
        const shd = kid(tcPr, 'shd'); const fill = shd && wa(shd, 'fill');
        if (fill && /^[0-9a-f]{6}$/i.test(fill) && !/^f{6}$/i.test(fill)) cell.fill = '#' + fill.toLowerCase();
        const va = wa(kid(tcPr, 'vAlign'), 'val'); if (va === 'center') cell.valign = 'middle'; else if (va === 'bottom') cell.valign = 'bottom';
        const vm = kid(tcPr, 'vMerge'); if (vm) cell.vm = wa(vm, 'val') === 'restart' ? 'restart' : 'continue';
        if (cell.vm === 'continue') cell.blocks = [];
        cells.push(cell);
      }
      if (cells.length) rows.push({ cells });
    }
    const n = Math.max(grid.length, ...rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)), 1);
    while (grid.length < n) grid.push(60);
    // Dikey birleşik hücreler: aradaki yatay çizgileri kaldır
    if (border) {
      const at = rows.map((r) => { let g = 0; const m = {}; for (const c of r.cells) { m[g] = c; g += c.span; } return m; });
      rows.forEach((r, ri) => { for (const [g, c] of Object.entries(at[ri])) if (c.vm === 'continue') { c.borders = (c.borders ?? 15) & ~1; const up = at[ri - 1]?.[g]; if (up) up.borders = (up.borders ?? 15) & ~4; } });
    }
    if (rows.length) out.push({ type: 'table', cols: grid, rows, border, align: wa(kid(tblPr, 'jc'), 'val') === 'center' ? 'center' : 'left' });
  }

  async function body(parent, out, flat = false) {
    for (const c of parent.children) {
      const n = c.localName;
      if (n === 'p') await paragraph(c, out);
      else if (n === 'tbl') { if (flat) { for (const tr of kids(c, 'tr')) for (const tc of kids(tr, 'tc')) await body(tc, out, true); } else await table(c, out); }
      else if (n === 'sdt') await body(kid(c, 'sdtContent') || c, out, flat);
      else if (['sdtContent', 'ins', 'customXml', 'smartTag'].includes(n)) await body(c, out, flat);
    }
  }

  const model = newModel();
  const bodyEl = kid(docXml.documentElement, 'body');
  await body(bodyEl, model.blocks);
  const sects = docXml.getElementsByTagNameNS(W, 'sectPr');
  const sect = kid(bodyEl, 'sectPr') || sects[sects.length - 1];
  if (sect) {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    if (sz) { model.pageW = tw(wa(sz, 'w')) || model.pageW; model.pageH = tw(wa(sz, 'h')) || model.pageH; if (wa(sz, 'orient') === 'landscape' && model.pageW < model.pageH) [model.pageW, model.pageH] = [model.pageH, model.pageW]; }
    if (mar) {
      model.margin = { t: Math.abs(tw(wa(mar, 'top')) ?? 70.9), b: Math.abs(tw(wa(mar, 'bottom')) ?? 70.9), l: (tw(wa(mar, 'left')) ?? 70.9) + (tw(wa(mar, 'gutter')) || 0), r: tw(wa(mar, 'right')) ?? 70.9 };
      if (tw(wa(mar, 'header')) !== undefined) model.headerOffset = tw(wa(mar, 'header'));
      if (tw(wa(mar, 'footer')) !== undefined) model.footerOffset = tw(wa(mar, 'footer'));
    }
    // Üstbilgi / altbilgi (antet). İlk sayfaya özel olan varsa ve "farklı ilk sayfa" açıksa onu, yoksa varsayılanı al.
    const titlePg = on(kid(sect, 'titlePg'));
    const pick = (name) => {
      const refs = kids(sect, name + 'Reference');
      const by = (t) => refs.find((r) => wa(r, 'type') === t);
      const ref = by('default') || (titlePg && by('first')) || refs[0];
      return ref && (ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id'));
    };
    const part = async (rid) => {
      const target = rid && docRels[rid];
      if (!target) return [];
      const path = 'word/' + target.replace(/^\.?\//, '');
      const dom = await xml(path);
      if (!dom) return [];
      const name = path.split('/').pop();
      rels = relMap(await xml('word/_rels/' + name + '.rels'));
      const out = [];
      try { await body(dom.documentElement, out); } finally { rels = docRels; }
      // Boş paragrafları baştan ve sondan at
      const empty = (b) => b.type === 'p' && !b.runs.some((r) => r.image || r.field || (r.text && r.text.trim()));
      while (out.length && empty(out[0])) out.shift();
      while (out.length && empty(out[out.length - 1])) out.pop();
      return out.filter((b) => b.type !== 'pageBreak');
    };
    model.header = await part(pick('header'));
    model.footer = await part(pick('footer'));
  }
  return model;
}

// ───────────────────────── Yazma ─────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const T20 = (pt) => Math.round((pt || 0) * 20);
const WTAB = { left: 'left', center: 'center', right: 'right', decimal: 'decimal' };
const WLEAD = { dot: 'dot', hyphen: 'hyphen', underscore: 'underscore', equals: 'hyphen' };

export async function modelToDocx(model) {
  const jz = new window.JSZip();
  const zip = { file: (path, data) => jz.file(path, data, { createFolders: false }), generateAsync: (o) => jz.generateAsync(o) };
  const contentW = model.pageW - model.margin.l - model.margin.r;
  let media = [];
  let imgSeq = 0;
  const rPr = (r) => {
    let s = '';
    const f = r.font || 'Times New Roman';
    s += `<w:rFonts w:ascii="${esc(f)}" w:hAnsi="${esc(f)}" w:cs="${esc(f)}"/>`;
    if (r.b) s += '<w:b/>';
    if (r.i) s += '<w:i/>';
    if (r.s) s += '<w:strike/>';
    if (r.color) s += `<w:color w:val="${r.color.slice(1)}"/>`;
    const sz = Math.round((r.size || 12) * 2);
    s += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
    if (r.u) s += '<w:u w:val="single"/>';
    if (r.bg) s += `<w:shd w:val="clear" w:color="auto" w:fill="${r.bg.slice(1)}"/>`;
    if (r.va) s += `<w:vertAlign w:val="${r.va === 'sup' ? 'superscript' : 'subscript'}"/>`;
    return `<w:rPr>${s}</w:rPr>`;
  };
  const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x47 ? 'gif' : 'png');
  const imgXml = (im) => {
    const id = ++imgSeq, ext = sniff(im.bytes);
    media.push({ id, ext, bytes: im.bytes });
    const cx = Math.round(im.w * 12700), cy = Math.round(im.h * 12700);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Resim ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const para = (p, width = contentW) => {
    let pp = '';
    const hasTab = p.runs.some((r) => r.tab || (r.text && r.text.includes('\t')));
    if (hasTab || p.tabs?.length) {
      const stops = (hasTab ? tabStopsFor(p, width) : p.tabs).filter((t) => t.pos > 0.5 && t.pos <= width + 1);
      if (stops.length) pp += `<w:tabs>${stops.map((t) => `<w:tab w:val="${WTAB[t.align] || 'left'}"${WLEAD[t.leader] ? ` w:leader="${WLEAD[t.leader]}"` : ''} w:pos="${T20(t.pos)}"/>`).join('')}</w:tabs>`;
    }
    const ls = p.lineSpacing || 1;
    if (p.spaceBefore || p.spaceAfter || Math.abs(ls - 1) > 0.01) pp += `<w:spacing w:before="${T20(p.spaceBefore)}" w:after="${T20(p.spaceAfter)}" w:line="${Math.round(ls * 240)}" w:lineRule="auto"/>`;
    if (p.indL || p.indR || p.indFirst) pp += `<w:ind w:left="${T20(p.indL)}" w:right="${T20(p.indR)}"${p.indFirst > 0 ? ` w:firstLine="${T20(p.indFirst)}"` : p.indFirst < 0 ? ` w:hanging="${T20(-p.indFirst)}"` : ''}/>`;
    if (p.align && p.align !== 'left') pp += `<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>`;
    if (!p.runs.length) pp += rPr({ size: p.size || 12 });
    let runs = '';
    for (const r of p.runs) {
      if (r.image) runs += imgXml(r.image);
      else if (r.field) runs += `<w:fldSimple w:instr=" ${r.field === 'page' ? 'PAGE' : 'NUMPAGES'} "><w:r>${rPr(r)}<w:t>1</w:t></w:r></w:fldSimple>`;
      else if (r.tab) runs += `<w:r>${rPr(r)}<w:tab/></w:r>`;
      else if (r.br) runs += `<w:r>${rPr(r)}<w:br/></w:r>`;
      else if (r.text) {
        const parts = r.text.split(/(\n|\t)/).filter(Boolean).map((t) => (t === '\n' ? '<w:br/>' : t === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${esc(t)}</w:t>`)).join('');
        runs += `<w:r>${rPr(r)}${parts}</w:r>`;
      }
    }
    return `<w:p>${pp ? `<w:pPr>${pp}</w:pPr>` : ''}${runs}</w:p>`;
  };
  const EDGE = [[1, 'top'], [8, 'left'], [4, 'bottom'], [2, 'right']];
  const blocks = (list) => list.map((b) => {
    if (b.type === 'p') return para(b);
    if (b.type === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (b.type === 'table') {
      const total = b.cols.reduce((x, y) => x + y, 0) || 1;
      const k = total > contentW || b.fit ? contentW / total : 1;
      const cols = b.cols.map((w) => w * k);
      const bd = b.border ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') : '';
      const rows = b.rows.map((r) => {
        let ci = 0;
        return `<w:tr>${r.cells.map((c) => {
          const span = c.span || 1;
          const w = cols.slice(ci, ci + span).reduce((x, y) => x + y, 0); ci += span;
          const ps = c.blocks.filter((x) => x.type === 'p');
          let pr = `<w:tcW w:w="${T20(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}`;
          if (c.borders != null) pr += `<w:tcBorders>${EDGE.map(([bit, n]) => `<w:${n} w:val="${c.borders & bit ? 'single' : 'nil'}"${c.borders & bit ? ' w:sz="4" w:space="0" w:color="000000"' : ''}/>`).join('')}</w:tcBorders>`;
          if (c.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill.slice(1)}"/>`;
          if (c.valign) pr += `<w:vAlign w:val="${c.valign === 'middle' ? 'center' : 'bottom'}"/>`;
          return `<w:tc><w:tcPr>${pr}</w:tcPr>${ps.length ? ps.map((q) => para(q, w)).join('') : '<w:p/>'}</w:tc>`;
        }).join('')}</w:tr>`;
      }).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="${T20(cols.reduce((x, y) => x + y, 0))}" w:type="dxa"/>${bd ? `<w:tblBorders>${bd}</w:tblBorders>` : ''}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${T20(w)}"/>`).join('')}</w:tblGrid>${rows}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
    }
    return '';
  }).join('');

  const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;
  const relsXml = (list, extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${extra}${list.map((m) => `<Relationship Id="rIdImg${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${m.id}.${m.ext}"/>`).join('')}</Relationships>`;
  const allMedia = [];
  // Üstbilgi / altbilgi parçaları (her birinin kendi ilişki dosyası olur)
  const parts = [];
  for (const [kind, list] of [['header', model.header], ['footer', model.footer]]) {
    const bl = (list || []).filter((b) => b.type === 'p' || b.type === 'table');
    if (!bl.length) continue;
    media = [];
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    zip.file(`word/${kind}1.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${NS}>${blocks(bl)}</w:${tag}>`);
    zip.file(`word/_rels/${kind}1.xml.rels`, relsXml(media));
    allMedia.push(...media);
    parts.push(kind);
  }
  media = [];
  const bodyXml = blocks(model.blocks);
  allMedia.push(...media);
  const M = model.margin, land = model.pageW > model.pageH;
  const refs = parts.map((k) => `<w:${k}Reference w:type="default" r:id="rId${k === 'header' ? 'Hdr' : 'Ftr'}"/>`).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${bodyXml}<w:sectPr>${refs}<w:pgSz w:w="${T20(model.pageW)}" w:h="${T20(model.pageH)}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${T20(M.t)}" w:right="${T20(M.r)}" w:bottom="${T20(M.b)}" w:left="${T20(M.l)}" w:header="${T20(model.headerOffset ?? 35.4)}" w:footer="${T20(model.footerOffset ?? 35.4)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${parts.map((k) => `<Override PartName="/word/${k}1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${k}+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  const extra = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${parts.map((k) => `<Relationship Id="rId${k === 'header' ? 'Hdr' : 'Ftr'}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${k}" Target="${k}1.xml"/>`).join('')}`;
  zip.file('word/_rels/document.xml.rels', relsXml(media, extra));
  for (const m of allMedia) zip.file(`word/media/img${m.id}.${m.ext}`, m.bytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
