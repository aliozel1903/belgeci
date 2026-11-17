// PDF çekirdeği: pdf.js (görüntüleme) + pdf-lib (düzenleme) sarmalayıcıları ve temel işlemler.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { T } from './ui.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const PDFJS_BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
const FONT_BASE = new URL('../fonts/', import.meta.url).href;

export const lib = () => window.PDFLib;
export { pdfjs };

// Aynı dosya için şifreyi iki kez sormamak üzere hatırla
const passwords = new WeakMap();
function askPassword(name, wrong) {
  return window.prompt((wrong ? T('Şifre yanlış. ', 'Wrong password. ') : '') + T(`"${name || 'PDF'}" şifreli. Açma şifresini girin:`, `"${name || 'PDF'}" is encrypted. Enter its password:`));
}

// pdf.js izin bayrakları (PDF belirtimi, Tablo 22)
const PERM = { MODIFY: 8, COPY: 16, ASSEMBLE: 1024 };
/**
 * Belgenin yazarı bir işleme izin vermemişse durdurur. Kısıtlamalı (sahip şifreli) PDF'lerde
 * koruma aşılmaz; yalnızca görüntülemeye izin verilir.
 * need: 'modify' (içerik değiştirme) | 'assemble' (sayfa ekle/sil/sırala) | 'copy' (metin/görsel çıkarma)
 */
export async function checkPermissions(view, need, name) {
  if (!need) return;
  const perms = await view.getPermissions();
  if (!perms) return; // şifresiz ya da kısıtlamasız
  const ok = need === 'copy' ? perms.includes(PERM.COPY)
    : need === 'assemble' ? perms.includes(PERM.ASSEMBLE) || perms.includes(PERM.MODIFY)
    : perms.includes(PERM.MODIFY);
  if (ok) return;
  const what = need === 'copy' ? T('içeriğinin kopyalanmasına', 'copying its content') : T('düzenlenmesine', 'editing');
  throw new Error(T(
    `"${name || 'PDF'}" belgesinin yazarı ${what} izin vermemiş. Belgeci yazarın koyduğu kısıtlamaları aşmaz. Belgenin sahibiyseniz kısıtlamayı, belgeyi oluşturduğunuz programdan kaldırın.`,
    `The author of "${name || 'PDF'}" does not allow ${what}. Belgeci does not bypass restrictions set by a document's author. If you own the document, remove the restriction in the program that created it.`));
}

/** pdf.js belgesi aç (görüntüleme / metin çıkarma). need verilirse yazar izinleri denetlenir. */
export async function openView(bytes, name, need) {
  let password = passwords.get(bytes);
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await pdfjs.getDocument({
        data: bytes.slice(), password,
        cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
        isEvalSupported: false,
      }).promise;
      if (password != null) passwords.set(bytes, password);
      try { await checkPermissions(doc, need, name); } catch (e) { doc.destroy(); throw e; }
      return doc;
    } catch (e) {
      if (e?.name !== 'PasswordException') throw e;
      password = askPassword(name, attempt > 0);
      if (password == null) throw new Error(T('Şifre girilmedi.', 'No password entered.'));
    }
  }
}

/**
 * pdf-lib belgesi yükle. Şifreliyse şifre sorar, yazar izinlerini denetler ve şifresi çözülmüş bir kopya döndürür.
 * need: 'modify' | 'assemble' (bkz. checkPermissions)
 */
export async function loadDoc(bytes, name, need = 'modify') {
  const { PDFDocument } = lib();
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    if (!/encrypted/i.test(e.message)) throw e;
  }
  let password = passwords.get(bytes) ?? '';
  for (let attempt = 0; ; attempt++) {
    try {
      const enc = await PDFDocument.load(bytes, { password });
      passwords.set(bytes, password);
      const view = await openView(bytes, name, need);
      view.destroy();
      const out = await PDFDocument.create();
      (await out.copyPages(enc, enc.getPageIndices())).forEach((p) => out.addPage(p));
      return out;
    } catch (e) {
      if (!/password/i.test(e.message)) throw e;
      password = askPassword(name, attempt > 0);
      if (password == null) throw new Error(T('Şifre girilmedi.', 'No password entered.'));
    }
  }
}

export const saveDoc = (doc) => doc.save({ useObjectStreams: true });

/** Sayfayı canvas'a çiz. width (css px) ya da scale verin. */
export async function renderPage(view, pageNo, { width, scale, rotation = 0, maxPixels = 16e6 } = {}) {
  const page = await view.getPage(pageNo);
  const rot = (page.rotate + rotation) % 360;
  const base = page.getViewport({ scale: 1, rotation: rot });
  let s = scale || (width / base.width);
  if (base.width * base.height * s * s > maxPixels) s = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale: s, rotation: rot });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

export const canvasBlob = (canvas, type = 'image/jpeg', q = 0.85) => new Promise((res) => canvas.toBlob(res, type, q));
export const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

const fontCache = {};
export async function fontBytes(file) {
  if (!fontCache[file]) fontCache[file] = fetch(FONT_BASE + file).then((r) => { if (!r.ok) throw new Error('Font yüklenemedi: ' + file); return r.arrayBuffer(); });
  return fontCache[file];
}
/** Türkçe karakter destekli gömülü yazı tipi */
export async function embedFont(doc, kind = 'sans', bold = false, italic = false) {
  doc.registerFontkit(window.fontkit);
  const style = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const file = `Liberation${kind === 'serif' ? 'Serif' : 'Sans'}-${style}.ttf`;
  return doc.embedFont(await fontBytes(file), { subset: true });
}

/** "1-3, 5, 8-" → [[0,1,2],[4],[7..n-1]] (0 tabanlı gruplar) */
export function parseRanges(str, n) {
  const groups = [];
  for (const part of String(str).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(-)?\s*(\d*)$/);
    if (!m || (!m[1] && !m[3])) throw new Error(T(`Geçersiz aralık: "${part}"`, `Invalid range: "${part}"`));
    let a = m[1] ? +m[1] : 1;
    let b = m[2] ? (m[3] ? +m[3] : n) : a;
    if (a < 1 || b < 1 || a > n || b > n) throw new Error(T(`"${part}" belge sınırı dışında (1-${n}).`, `"${part}" is out of bounds (1-${n}).`));
    const g = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  if (!groups.length) throw new Error(T('Sayfa aralığı girin. Örn: 1-3, 5', 'Enter a page range, e.g. 1-3, 5'));
  return groups;
}

export async function pagesToDoc(src, indices) {
  const out = await lib().PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
  return out;
}

/** Görsel dosyasını (jpg/png/webp/…) tek sayfalık PDF'e eklenecek biçimde hazırla */
export async function embedImageFile(doc, bytes, name = '') {
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  let bmp = null;
  try { bmp = await createImageBitmap(new Blob([bytes])); } catch { /* tarayıcı çözemedi */ }
  if (isPng) return doc.embedPng(bytes);
  if (isJpg) {
    const img = await doc.embedJpg(bytes);
    // EXIF yönü varsa (telefon fotoğrafı) tarayıcının düzelttiği hâli kullan
    if (!bmp || (bmp.width === img.width && bmp.height === img.height)) return img;
  }
  if (!bmp) throw new Error(T(`Görsel okunamadı: ${name}`, `Cannot read image: ${name}`));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  return doc.embedJpg(await blobBytes(await canvasBlob(c, 'image/jpeg', 0.92)));
}

const A4 = [595.28, 841.89];
/** Görsellerden PDF. size: 'a4' | 'fit' ; margin pt */
export async function imagesToPdf(files, { size = 'a4', margin = 0, orient = 'auto' } = {}, progress) {
  const doc = await lib().PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    progress?.(null, i / files.length);
    const img = await embedImageFile(doc, files[i].bytes, files[i].name);
    let pw, ph;
    if (size === 'fit') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; }
    else {
      const land = orient === 'landscape' || (orient === 'auto' && img.width > img.height);
      [pw, ph] = land ? [A4[1], A4[0]] : A4;
    }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * s, hh = img.height * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
  }
  return saveDoc(doc);
}

/** Dosya PDF değilse (görsel) tek sayfalık PDF'e çevir */
export async function asPdfBytes(file) {
  const b = file.bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return b;
  if (/\.pdf$/i.test(file.name)) return b;
  return imagesToPdf([file], { size: 'a4' });
}

/**
 * Sayfanın görünen (döndürülmüş) koordinatlarını PDF koordinatına çevirir.
 * vx, vy: görünen sayfanın sol-altından pt. Dönen: {x, y, angle, vw, vh}
 */
export function visualToPdf(page, vx, vy) {
  const box = page.getCropBox();
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  const W = box.width, H = box.height;
  let x, y;
  if (R === 90) { x = W - vy; y = vx; }
  else if (R === 180) { x = W - vx; y = H - vy; }
  else if (R === 270) { x = vy; y = H - vx; }
  else { x = vx; y = vy; }
  return { x: x + box.x, y: y + box.y, angle: R };
}
export function visualSize(page) {
  const box = page.getCropBox();
  const R = ((page.getRotation().angle % 360) + 360) % 360;
  return R % 180 ? { vw: box.height, vh: box.width } : { vw: box.width, vh: box.height };
}

export function hexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') || [0, '000000'];
  const n = parseInt(m[1], 16);
  return lib().rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Görünür konuma göre dik duran metin çizer (sayfa döndürülmüş olsa da). */
export function drawVisualText(page, text, font, { vx, vy, size, color, opacity = 1, angle = 0 }) {
  const { degrees } = lib();
  const p = visualToPdf(page, vx, vy);
  page.drawText(text, { x: p.x, y: p.y, size, font, color, opacity, rotate: degrees(angle + p.angle) });
}

export async function watermark(bytes, o, name) {
  const doc = await loadDoc(bytes, name);
  const font = await embedFont(doc, 'sans', true);
  const color = hexColor(o.color);
  const size = +o.size || 48, ang = +o.angle || 0, rad = (ang * Math.PI) / 180;
  const tw = font.widthOfTextAtSize(o.text, size);
  for (const page of doc.getPages()) {
    const { vw, vh } = visualSize(page);
    const put = (cx, cy) => drawVisualText(page, o.text, font, {
      // metnin merkezi (cx, cy) olacak şekilde başlangıç noktası
      vx: cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * size * 0.35),
      vy: cy - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * size * 0.35),
      size, color, opacity: +o.opacity || 0.2, angle: ang,
    });
    if (o.layout === 'tile') {
      const stepX = tw + size * 2, stepY = size * 4;
      for (let y = -vh * 0.2, r = 0; y < vh * 1.2; y += stepY, r++) for (let x = (r % 2 ? stepX / 2 : 0) - stepX; x < vw + stepX; x += stepX) put(x, y);
    } else put(vw / 2, vh / 2);
  }
  return saveDoc(doc);
}

export async function pageNumbers(bytes, o, name) {
  const doc = await loadDoc(bytes, name);
  const font = await embedFont(doc, 'sans');
  const pages = doc.getPages();
  const size = +o.size || 10, m = +o.margin || 28, start = +o.start || 1, from = Math.max(1, +o.from || 1);
  const total = pages.length - (from - 1) + (start - 1);
  pages.forEach((page, i) => {
    if (i + 1 < from) return;
    const n = i + 1 - from + start;
    const text = (o.format || '{n}').replace('{n}', n).replace('{t}', total);
    const tw = font.widthOfTextAtSize(text, size);
    const { vw, vh } = visualSize(page);
    const [v, hz] = (o.position || 'bottom-center').split('-');
    const vx = hz === 'left' ? m : hz === 'right' ? vw - m - tw : (vw - tw) / 2;
    const vy = v === 'top' ? vh - m - size * 0.7 : m;
    drawVisualText(page, text, font, { vx, vy, size, color: hexColor('#222222') });
  });
  return saveDoc(doc);
}

export async function protect(bytes, { password, allowPrint = true, allowCopy = true }, name) {
  const doc = await loadDoc(bytes, name);
  doc.encrypt({
    userPassword: password,
    ownerPassword: password + '#' + Math.random().toString(36).slice(2),
    permissions: { printing: allowPrint ? 'highResolution' : false, copying: allowCopy, modifying: false, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false },
  });
  return doc.save({ useObjectStreams: false });
}

export async function unlock(bytes, password, name) {
  const { PDFDocument } = lib();
  let plain = false;
  try { await PDFDocument.load(bytes); plain = true; } catch (e) { if (!/encrypted/i.test(e.message)) throw e; }
  if (plain) throw new Error(T('Bu PDF zaten şifresiz.', 'This PDF is not protected.'));
  let enc, used;
  // Girilen şifreyi, sonra boş şifreyi dene (açılış şifresi olmayan belgelerde kullanıcı yine de bir şey yazmış olabilir)
  for (const pw of password ? [password, ''] : ['']) {
    try { enc = await PDFDocument.load(bytes, { password: pw }); used = pw; break; }
    catch (e) { if (!/password/i.test(e.message)) throw e; }
  }
  if (!enc) throw new Error(password ? T('Şifre yanlış.', 'Incorrect password.') : T('Bu PDF açılış şifresiyle korunuyor; şifreyi girin.', 'This PDF needs an open password; please enter it.'));
  passwords.set(bytes, used);
  // Açılış şifresi kaldırılır; yazarın koyduğu düzenleme/kopyalama kısıtlamaları aşılmaz.
  (await openView(bytes, name, 'modify')).destroy();
  const out = await PDFDocument.create();
  (await out.copyPages(enc, enc.getPageIndices())).forEach((p) => out.addPage(p));
  return saveDoc(out);
}

/** PDF → görseller. Dönen: [{name, bytes}] */
export async function pdfToImages(bytes, { format = 'jpg', dpi = 150, pages }, name, progress) {
  const view = await openView(bytes, name, 'copy');
  const list = pages || Array.from({ length: view.numPages }, (_, i) => i);
  const out = [];
  const pad = String(view.numPages).length;
  for (let k = 0; k < list.length; k++) {
    progress?.(T(`Sayfa ${k + 1} / ${list.length}`, `Page ${k + 1} / ${list.length}`), k / list.length);
    const c = await renderPage(view, list[k] + 1, { scale: dpi / 72, maxPixels: 40e6 });
    const blob = await canvasBlob(c, format === 'png' ? 'image/png' : 'image/jpeg', 0.9);
    out.push({ name: `${name}-${String(list[k] + 1).padStart(pad, '0')}.${format}`, bytes: await blobBytes(blob) });
    c.width = c.height = 0;
  }
  view.destroy();
  return out;
}

export async function extractText(bytes, name, progress) {
  const view = await openView(bytes, name, 'copy');
  const parts = [];
  for (let i = 1; i <= view.numPages; i++) {
    progress?.(null, i / view.numPages);
    const page = await view.getPage(i);
    const tc = await page.getTextContent();
    let s = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY != null && Math.abs(y - lastY) > 2 && !s.endsWith('\n')) s += '\n';
      s += it.str;
      if (it.hasEOL) s += '\n';
      lastY = y;
    }
    parts.push(s.trim());
  }
  view.destroy();
  return parts;
}

/**
 * Sıkıştırma.
 * mode 'images': gömülü JPEG görselleri küçültür (metin korunur).
 * mode 'raster': her sayfayı görsele çevirir (en küçük boyut, metin seçilemez).
 */
export async function compress(bytes, { mode = 'images', level = 'medium' }, name, progress) {
  const cfg = { low: { q: 0.78, max: 2200, dpi: 150 }, medium: { q: 0.62, max: 1600, dpi: 120 }, high: { q: 0.45, max: 1100, dpi: 96 } }[level] || { q: 0.62, max: 1600, dpi: 120 };
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFDict, PDFNumber } = lib();
  if (mode === 'raster') {
    const view = await openView(bytes, name, 'modify');
    const out = await PDFDocument.create();
    for (let i = 1; i <= view.numPages; i++) {
      progress?.(T(`Sayfa ${i} / ${view.numPages}`, `Page ${i} / ${view.numPages}`), (i - 1) / view.numPages);
      const page = await view.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const c = await renderPage(view, i, { scale: cfg.dpi / 72 });
      const img = await out.embedJpg(await blobBytes(await canvasBlob(c, 'image/jpeg', cfg.q)));
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      c.width = c.height = 0;
    }
    view.destroy();
    const res = await saveDoc(out);
    return res.length < bytes.length ? res : bytes;
  }
  const doc = await loadDoc(bytes, name);
  const N = (s) => PDFName.of(s);
  const images = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(N('Subtype')) !== N('Image')) continue;
    let f = d.lookup(N('Filter'));
    if (f instanceof PDFArray) f = f.size() === 1 ? f.lookup(0) : null;
    if (f !== N('DCTDecode')) continue;
    if (d.has(N('Decode')) || d.has(N('ImageMask'))) continue;
    const cs = d.lookup(N('ColorSpace'));
    if (cs === N('DeviceCMYK')) continue;
    if (cs instanceof PDFArray) {
      if (cs.lookup(0) !== N('ICCBased')) continue;
      const icc = cs.lookup(1);
      const n = icc?.dict?.lookup(N('N'));
      if (!(n instanceof PDFNumber) || n.asNumber() === 4) continue;
    }
    images.push([ref, obj]);
  }
  for (let i = 0; i < images.length; i++) {
    progress?.(T(`Görsel ${i + 1} / ${images.length}`, `Image ${i + 1} / ${images.length}`), i / images.length);
    const [ref, obj] = images[i];
    try {
      const bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }), { imageOrientation: 'none' });
      const s = Math.min(1, cfg.max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const nb = await blobBytes(await canvasBlob(c, 'image/jpeg', cfg.q));
      if (nb.length >= obj.contents.length * 0.92) continue;
      const nd = PDFDict.withContext(doc.context);
      for (const [k, v] of obj.dict.entries()) if (!['DecodeParms', 'Length', 'Filter', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent'].includes(k.decodeText())) nd.set(k, v);
      nd.set(N('Filter'), N('DCTDecode')); nd.set(N('Width'), PDFNumber.of(c.width)); nd.set(N('Height'), PDFNumber.of(c.height));
      nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8)); nd.set(N('Length'), PDFNumber.of(nb.length));
      doc.context.assign(ref, PDFRawStream.of(nd, nb));
    } catch { /* bu görseli olduğu gibi bırak */ }
  }
  const out = await saveDoc(doc);
  return out.length < bytes.length ? out : bytes;
}
