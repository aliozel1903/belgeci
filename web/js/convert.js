// Biçim dönüşümleri: tarayıcı içi motor + (varsa) yerel LibreOffice motoru + OCR.
import { T, extOf } from './ui.js';
import { lib, openView, renderPage, canvasBlob, blobBytes, saveDoc } from './pdfcore.js';
import { modelToPdf, modelToText } from './doc/layout.js';
import { parseDocx, modelToDocx } from './doc/docx.js';
import { pdfToModel } from './doc/pdf2model.js';

// ───────── Yerel motor (server.py) ─────────
export const engine = { checked: false, office: false, pdf2docx: false };
export async function checkEngine() {
  engine.checked = true;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return engine;
  try {
    const r = await fetch('api/health', { signal: AbortSignal.timeout(2500) });
    if (r.ok) Object.assign(engine, await r.json());
  } catch { /* yerel motor yok */ }
  return engine;
}
async function engineConvert(bytes, name, to) {
  const r = await fetch(`api/convert?to=${to}&name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
  if (!r.ok) throw new Error((await r.text()) || 'Yerel motor hatası');
  return new Uint8Array(await r.arrayBuffer());
}

export const OFFICE_EXTS = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'txt'];

/** Herhangi bir belgeyi ortak modele çevir */
async function toModel(file, progress) {
  const ext = extOf(file.name);
  if (ext === 'docx') return parseDocx(file.bytes);
  if (ext === 'pdf') return pdfToModel(file.bytes, file.name, progress);
  if (ext === 'txt') {
    const text = new TextDecoder('utf-8').decode(file.bytes);
    const { newModel } = await import('./doc/layout.js');
    const m = newModel();
    m.blocks = text.replace(/\r/g, '').split('\n').map((l) => ({ type: 'p', align: 'left', runs: l ? [{ text: l, size: 12 }] : [], size: 12 }));
    return m;
  }
  throw new Error(T(`.${ext} dosyaları tarayıcıda dönüştürülemiyor. Yerel sürümü LibreOffice ile kullanın.`, `.${ext} files cannot be converted in the browser. Use the local version with LibreOffice.`));
}

/**
 * Dönüştür. to: 'pdf' | 'docx' | 'txt'
 * Dönen: { bytes, via: 'engine' | 'browser' }
 */
export async function convert(file, to, { preferEngine = true } = {}, progress) {
  const ext = extOf(file.name);
  if (!engine.checked) await checkEngine();
  // Yüksek kaliteli yol: LibreOffice / pdf2docx
  if (preferEngine && engine.office) {
    try {
      if (to === 'pdf' && OFFICE_EXTS.includes(ext)) return { bytes: await engineConvert(file.bytes, file.name, 'pdf'), via: 'engine' };
      if (to === 'docx' && ext === 'pdf' && engine.pdf2docx) return { bytes: await engineConvert(file.bytes, file.name, 'docx'), via: 'engine' };
    } catch (e) {
      if (!['docx', 'txt'].includes(ext)) throw e;
      console.warn('Yerel motor başarısız, tarayıcı motoruna geçiliyor:', e);
    }
  }
  const model = await toModel(file, progress);
  progress?.(T('Belge oluşturuluyor…', 'Building document…'));
  let bytes;
  if (to === 'pdf') bytes = await modelToPdf(model, progress);
  else if (to === 'docx') bytes = await modelToDocx(model);
  else if (to === 'txt') bytes = new TextEncoder().encode(modelToText(model));
  else throw new Error('Bilinmeyen hedef: ' + to);
  return { bytes, via: 'browser' };
}

// ───────── OCR (Tesseract.js, ilk kullanımda internetten yüklenir) ─────────
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tessLoad = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tessLoad) {
    tessLoad = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TESS; s.onload = res;
      s.onerror = () => { tessLoad = null; rej(new Error(T('OCR bileşeni indirilemedi. İnternet bağlantınızı kontrol edin (yalnızca ilk kullanımda gerekir).', 'Could not download the OCR component. Check your internet connection (only needed the first time).'))); };
      document.head.append(s);
    });
  }
  return tessLoad;
}

/** OCR. out: 'pdf' (aranabilir PDF) | 'txt'. Girdi PDF ya da görsel olabilir. */
export async function ocr(file, { langs = 'tur+eng', out = 'pdf' }, progress) {
  progress?.(T('OCR motoru yükleniyor…', 'Loading OCR engine…'));
  await loadTesseract();
  let pageNo = 0, total = 1;
  const worker = await window.Tesseract.createWorker(langs.split('+'), 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') progress?.(T(`Sayfa ${pageNo} / ${total} tanınıyor`, `Recognizing page ${pageNo} / ${total}`), (pageNo - 1 + m.progress) / total);
      else if (/load|initializ/i.test(m.status)) progress?.(T('Dil verisi indiriliyor (ilk kullanımda biraz sürebilir)…', 'Downloading language data (may take a while the first time)…'), m.progress);
    },
  });
  try {
    const isPdf = extOf(file.name) === 'pdf';
    const view = isPdf ? await openView(file.bytes, file.name, 'copy') : null;
    total = view ? view.numPages : 1;
    const texts = [];
    const outDoc = await lib().PDFDocument.create();
    for (pageNo = 1; pageNo <= total; pageNo++) {
      let image, wPt, hPt;
      if (view) {
        const page = await view.getPage(pageNo);
        const vp = page.getViewport({ scale: 1 });
        wPt = vp.width; hPt = vp.height;
        const c = await renderPage(view, pageNo, { scale: 200 / 72, maxPixels: 12e6 });
        image = await canvasBlob(c, 'image/jpeg', 0.88);
        c.width = c.height = 0;
      } else {
        const bmp = await createImageBitmap(new Blob([file.bytes]));
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        image = await canvasBlob(c, 'image/jpeg', 0.9);
        const s = Math.min(595.28 / bmp.width, 841.89 / bmp.height);
        wPt = bmp.width * s; hPt = bmp.height * s;
      }
      const { data } = await worker.recognize(image, { pdfTitle: file.name }, { text: true, pdf: out === 'pdf' });
      texts.push(data.text || '');
      if (out === 'pdf' && data.pdf) {
        const [emb] = await outDoc.embedPdf(new Uint8Array(data.pdf));
        outDoc.addPage([wPt, hPt]).drawPage(emb, { x: 0, y: 0, width: wPt, height: hPt });
      }
    }
    view?.destroy();
    if (out === 'txt') return new TextEncoder().encode(texts.join('\n\n'));
    return saveDoc(outDoc);
  } finally {
    await worker.terminate();
  }
}
