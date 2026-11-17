// Araç kataloğu ve "dosya seç → ayarla → çalıştır → indir" akışını kullanan basit araçlar.
import { T, L, h, icon, dropzone, toast, busy, download, fmtSize, baseName, extOf, readFile, errText, toBlob } from './ui.js';
import * as core from './pdfcore.js';
import { convert, ocr, engine, OFFICE_EXTS } from './convert.js';

const IMG = '.jpg,.jpeg,.png,.webp,.gif,.bmp';
const pdfOut = (f, suffix) => `${baseName(f.name)}${suffix}.pdf`;

async function conv(files, to, progress) {
  const out = [];
  let via = 'browser';
  for (let i = 0; i < files.length; i++) {
    const p = (t, fr) => progress(t || `${files[i].name}`, (i + (fr || 0)) / files.length);
    p();
    const r = await convert(files[i], to, {}, p);
    via = r.via;
    out.push({ name: `${baseName(files[i].name)}.${to}`, bytes: r.bytes });
  }
  out.via = via;
  return out;
}
const browserNote = ['Tarayıcı içi dönüşüm metni, yazı biçimlerini, tabloları ve görselleri aktarır; karmaşık sayfa düzenleri birebir aynı olmayabilir.', 'In-browser conversion keeps text, formatting, tables and images; complex layouts may not match exactly.'];

export const CATS = [
  ['organize', ['Düzenle', 'Organize']],
  ['convert', ['Dönüştür', 'Convert']],
  ['edit', ['Sayfa İşaretle', 'Mark Pages']],
  ['secure', ['Güvenlik ve Boyut', 'Security & Size']],
];

export const TOOLS = [
  // ── Düzenle ──
  { id: 'organize', cat: 'organize', icon: 'organize', hue: 'red', custom: true, featured: true,
    title: ['Sayfa Düzenleyici', 'Page Organizer'],
    desc: ['Sayfa sil, taranmış sayfayla değiştir, araya sayfa ekle, sırala, döndür. Birden çok PDF ile çalışır.', 'Delete pages, replace with a scan, insert, reorder, rotate. Works across multiple PDFs.'] },
  { id: 'merge', cat: 'organize', icon: 'merge', hue: 'red', accept: '.pdf,' + IMG, multiple: true, min: 2,
    title: ['PDF Birleştir', 'Merge PDF'], desc: ['Birden çok PDF\'i (ve görseli) istediğin sırayla tek dosyada birleştir.', 'Combine several PDFs (and images) into one, in any order.'],
    action: ['Birleştir', 'Merge'],
    options: [{ key: 'name', type: 'text', label: ['Çıktı adı', 'Output name'], default: 'birlestirilmis' }],
    async run(files, o, progress) {
      const out = await core.lib().PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        progress(files[i].name, i / files.length);
        const src = await core.loadDoc(await core.asPdfBytes(files[i]), files[i].name, 'assemble');
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      }
      return [{ name: (o.name || 'birlestirilmis').replace(/\.pdf$/i, '') + '.pdf', bytes: await core.saveDoc(out) }];
    } },
  { id: 'split', cat: 'organize', icon: 'split', hue: 'red', accept: '.pdf', pageInfo: true,
    title: ['PDF Böl', 'Split PDF'], desc: ['Sayfa aralıklarına göre, her N sayfada bir ya da tek tek sayfalara ayır.', 'Split by page ranges, every N pages, or into single pages.'],
    action: ['Böl', 'Split'],
    options: [
      { key: 'mode', type: 'select', label: ['Bölme şekli', 'How to split'], default: 'ranges', choices: [['ranges', ['Sayfa aralıkları', 'Page ranges']], ['every', ['Her N sayfada bir', 'Every N pages']], ['each', ['Her sayfa ayrı dosya', 'Every page separately']]] },
      { key: 'ranges', type: 'text', label: ['Aralıklar', 'Ranges'], default: '', placeholder: '1-3, 4-10, 11-', hint: ['Her aralık ayrı bir PDF olur. Örn: 1-3, 5, 8-', 'Each range becomes its own PDF. E.g. 1-3, 5, 8-'], showIf: (o) => o.mode === 'ranges' },
      { key: 'single', type: 'checkbox', label: ['Aralıkları tek PDF\'te topla (sayfa çıkar)', 'Put all ranges in one PDF (extract pages)'], default: false, showIf: (o) => o.mode === 'ranges' },
      { key: 'n', type: 'number', label: ['Sayfa sayısı (N)', 'Pages per file (N)'], default: 10, min: 1, showIf: (o) => o.mode === 'every' },
    ],
    async run([f], o, progress) {
      const src = await core.loadDoc(f.bytes, f.name, 'assemble');
      const n = src.getPageCount();
      let groups;
      if (o.mode === 'each') groups = Array.from({ length: n }, (_, i) => [i]);
      else if (o.mode === 'every') { const k = Math.max(1, +o.n || 1); groups = []; for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j)); }
      else { groups = core.parseRanges(o.ranges, n); if (o.single) groups = [groups.flat()]; }
      const out = [];
      for (let i = 0; i < groups.length; i++) {
        progress(null, i / groups.length);
        const g = groups[i];
        const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
        out.push({ name: `${baseName(f.name)}_${o.single ? 'secili' : label}.pdf`, bytes: await core.saveDoc(await core.pagesToDoc(src, g)) });
      }
      return out;
    } },
  { id: 'compare', cat: 'organize', icon: 'compare', hue: 'red', custom: true,
    title: ['Karşılaştır', 'Compare'], desc: ['İki PDF\'i yan yana aç, sayfaları eşleştir, farkları vurgula.', 'Open two PDFs side by side, align pages and highlight differences.'] },

  // ── Dönüştür ──
  { id: 'word2pdf', cat: 'convert', icon: 'word', hue: 'blue', multiple: true,
    accept: () => (engine.office ? OFFICE_EXTS.map((e) => '.' + e).join(',') : '.docx,.txt'),
    title: ['Word → PDF', 'Word to PDF'], desc: ['DOCX belgelerini PDF\'e çevir.', 'Convert DOCX documents to PDF.'], action: ['PDF\'e çevir', 'Convert to PDF'],
    note: () => (engine.office ? ['Yerel motor etkin: LibreOffice ile birebir dönüşüm yapılır (Excel ve PowerPoint de desteklenir).', 'Local engine active: exact conversion via LibreOffice (Excel and PowerPoint supported too).'] : ['Tarayıcı içi dönüşüm yapılır; sayfa sonları Word\'dekiyle birebir aynı olmayabilir. Birebir sonuç için yerel sürümü LibreOffice ile kullanın ya da Word\'de "PDF olarak kaydet" deyin.', 'Converted in the browser; page breaks may differ from Word. For exact results use the local version with LibreOffice, or "Save as PDF" in Word.']),
    run: (files, o, p) => conv(files, 'pdf', p) },
  { id: 'pdf2word', cat: 'convert', icon: 'word', hue: 'blue', accept: '.pdf', multiple: true,
    title: ['PDF → Word', 'PDF to Word'], desc: ['PDF\'i düzenlenebilir DOCX belgesine çevir.', 'Turn a PDF into an editable DOCX.'], action: ['Word\'e çevir', 'Convert to Word'],
    note: ['Metin, yazı biçimi ve paragraflar aktarılır. Taranmış sayfalar görsel olarak eklenir; önce OCR yaparsanız metne dönüşür.', 'Text, styles and paragraphs are carried over. Scanned pages are added as images; run OCR first to get text.'],
    run: (files, o, p) => conv(files, 'docx', p) },
  { id: 'udf2pdf', cat: 'convert', icon: 'udf', hue: 'amber', accept: '.udf', multiple: true,
    title: ['UDF → PDF', 'UDF to PDF'], desc: ['UYAP belgelerini (.udf) PDF\'e çevir.', 'Convert UYAP documents (.udf) to PDF.'], action: ['PDF\'e çevir', 'Convert to PDF'], note: browserNote,
    run: (files, o, p) => conv(files, 'pdf', p) },
  { id: 'pdf2udf', cat: 'convert', icon: 'udf', hue: 'amber', accept: '.pdf', multiple: true,
    title: ['PDF → UDF', 'PDF to UDF'], desc: ['PDF\'i UYAP Doküman Editörü\'nde açılabilen UDF\'e çevir.', 'Convert a PDF to UDF for the UYAP Document Editor.'], action: ['UDF\'e çevir', 'Convert to UDF'],
    note: ['Metin tabanlı PDF\'ler düzenlenebilir metin olarak, taranmış sayfalar görsel olarak aktarılır.', 'Text PDFs become editable text; scanned pages are embedded as images.'],
    run: (files, o, p) => conv(files, 'udf', p) },
  { id: 'word2udf', cat: 'convert', icon: 'udf', hue: 'amber', accept: '.docx', multiple: true,
    title: ['Word → UDF', 'Word to UDF'], desc: ['DOCX belgesini UYAP biçimine (.udf) çevir.', 'Convert DOCX to the UYAP format (.udf).'], action: ['UDF\'e çevir', 'Convert to UDF'], note: browserNote,
    run: (files, o, p) => conv(files, 'udf', p) },
  { id: 'udf2word', cat: 'convert', icon: 'word', hue: 'amber', accept: '.udf', multiple: true,
    title: ['UDF → Word', 'UDF to Word'], desc: ['UYAP belgesini (.udf) Word\'de düzenlenebilir DOCX\'e çevir.', 'Convert a UYAP document (.udf) to an editable DOCX.'], action: ['Word\'e çevir', 'Convert to Word'], note: browserNote,
    run: (files, o, p) => conv(files, 'docx', p) },
  { id: 'img2pdf', cat: 'convert', icon: 'image', hue: 'green', accept: IMG, multiple: true,
    title: ['Görsel → PDF', 'Image to PDF'], desc: ['JPG, PNG ve diğer görselleri (telefonla çekilen taramaları) PDF yap.', 'Turn JPG, PNG and other images (phone scans) into a PDF.'], action: ['PDF oluştur', 'Create PDF'],
    options: [
      { key: 'size', type: 'select', label: ['Sayfa boyutu', 'Page size'], default: 'a4', choices: [['a4', ['A4', 'A4']], ['fit', ['Görsel boyutunda', 'Same as image']]] },
      { key: 'orient', type: 'select', label: ['Yön', 'Orientation'], default: 'auto', choices: [['auto', ['Otomatik', 'Auto']], ['portrait', ['Dikey', 'Portrait']], ['landscape', ['Yatay', 'Landscape']]], showIf: (o) => o.size === 'a4' },
      { key: 'margin', type: 'select', label: ['Kenar boşluğu', 'Margin'], default: '0', choices: [['0', ['Yok', 'None']], ['18', ['Küçük', 'Small']], ['36', ['Büyük', 'Large']]] },
    ],
    async run(files, o, progress) {
      return [{ name: (files.length === 1 ? baseName(files[0].name) : 'gorseller') + '.pdf', bytes: await core.imagesToPdf(files, { size: o.size, orient: o.orient, margin: +o.margin }, progress) }];
    } },
  { id: 'pdf2img', cat: 'convert', icon: 'image', hue: 'green', accept: '.pdf',
    title: ['PDF → Görsel', 'PDF to Image'], desc: ['Her sayfayı JPG ya da PNG olarak dışa aktar.', 'Export every page as JPG or PNG.'], action: ['Görsellere çevir', 'Convert to images'],
    options: [
      { key: 'format', type: 'select', label: ['Biçim', 'Format'], default: 'jpg', choices: [['jpg', 'JPG'], ['png', 'PNG']] },
      { key: 'dpi', type: 'select', label: ['Kalite', 'Quality'], default: '150', choices: [['96', ['Ekran (96 dpi)', 'Screen (96 dpi)']], ['150', ['İyi (150 dpi)', 'Good (150 dpi)']], ['300', ['Baskı (300 dpi)', 'Print (300 dpi)']]] },
    ],
    run: ([f], o, progress) => core.pdfToImages(f.bytes, { format: o.format, dpi: +o.dpi }, baseName(f.name), progress) },
  { id: 'pdf2txt', cat: 'convert', icon: 'text', hue: 'green', accept: '.pdf',
    title: ['PDF → Metin', 'PDF to Text'], desc: ['PDF içindeki metni düz metin (.txt) olarak çıkar.', 'Extract the text of a PDF as plain .txt.'], action: ['Metni çıkar', 'Extract text'],
    async run([f], o, progress) {
      const pages = await core.extractText(f.bytes, f.name, progress);
      if (!pages.some((p) => p)) throw new Error(T('Bu PDF\'te seçilebilir metin yok (taranmış olabilir). Önce OCR aracını kullanın.', 'No selectable text in this PDF (probably scanned). Use the OCR tool first.'));
      return [{ name: baseName(f.name) + '.txt', bytes: new TextEncoder().encode(pages.join('\n\n')) }];
    } },
  { id: 'ocr', cat: 'convert', icon: 'ocr', hue: 'green', accept: '.pdf,' + IMG,
    title: ['OCR (Metin Tanıma)', 'OCR (Text Recognition)'], desc: ['Taranmış PDF ya da fotoğrafı aranabilir, metni seçilebilir PDF\'e çevir.', 'Make a scanned PDF or photo searchable with selectable text.'], action: ['Metni tanı', 'Recognize text'],
    note: ['OCR tarayıcınızda çalışır; dosyanız yüklenmez. İlk kullanımda OCR motoru ve dil verisi (~15 MB) internetten indirilir.', 'OCR runs in your browser; your file is not uploaded. On first use the OCR engine and language data (~15 MB) are downloaded.'],
    options: [
      { key: 'langs', type: 'select', label: ['Belge dili', 'Document language'], default: 'tur+eng', choices: [['tur+eng', ['Türkçe + İngilizce', 'Turkish + English']], ['tur', ['Türkçe', 'Turkish']], ['eng', ['İngilizce', 'English']], ['deu', ['Almanca', 'German']], ['fra', ['Fransızca', 'French']], ['ara', ['Arapça', 'Arabic']]] },
      { key: 'out', type: 'select', label: ['Çıktı', 'Output'], default: 'pdf', choices: [['pdf', ['Aranabilir PDF', 'Searchable PDF']], ['txt', ['Düz metin (.txt)', 'Plain text (.txt)']]] },
    ],
    async run([f], o, progress) {
      return [{ name: `${baseName(f.name)}_ocr.${o.out}`, bytes: await ocr(f, o, progress) }];
    } },

  // ── Düzelt ──
  { id: 'watermark', cat: 'edit', icon: 'watermark', hue: 'violet', accept: '.pdf',
    title: ['Filigran', 'Watermark'], desc: ['Sayfalara "TASLAK", "GİZLİ" gibi yazı filigranı ekle.', 'Stamp pages with text such as "DRAFT" or "CONFIDENTIAL".'], action: ['Filigran ekle', 'Add watermark'],
    options: [
      { key: 'text', type: 'text', label: ['Yazı', 'Text'], default: 'TASLAK' },
      { key: 'layout', type: 'select', label: ['Yerleşim', 'Layout'], default: 'center', choices: [['center', ['Ortada tek', 'Single, centered']], ['tile', ['Tüm sayfaya döşe', 'Tiled']]] },
      { key: 'size', type: 'range', label: ['Boyut', 'Size'], default: 64, min: 12, max: 160 },
      { key: 'angle', type: 'range', label: ['Açı', 'Angle'], default: 45, min: -90, max: 90, unit: '°' },
      { key: 'opacity', type: 'range', label: ['Opaklık', 'Opacity'], default: 0.18, min: 0.05, max: 1, step: 0.01 },
      { key: 'color', type: 'color', label: ['Renk', 'Color'], default: '#c0392b' },
    ],
    async run([f], o) {
      if (!o.text?.trim()) throw new Error(T('Filigran yazısı boş olamaz.', 'Watermark text cannot be empty.'));
      return [{ name: pdfOut(f, '_filigran'), bytes: await core.watermark(f.bytes, o, f.name) }];
    } },
  { id: 'pagenum', cat: 'edit', icon: 'number', hue: 'violet', accept: '.pdf',
    title: ['Sayfa Numarası', 'Page Numbers'], desc: ['Sayfalara numara ekle; konumu ve biçimi seç.', 'Add page numbers; choose position and format.'], action: ['Numara ekle', 'Add numbers'],
    options: [
      { key: 'position', type: 'select', label: ['Konum', 'Position'], default: 'bottom-center', choices: [['bottom-center', ['Alt orta', 'Bottom center']], ['bottom-right', ['Alt sağ', 'Bottom right']], ['bottom-left', ['Alt sol', 'Bottom left']], ['top-center', ['Üst orta', 'Top center']], ['top-right', ['Üst sağ', 'Top right']], ['top-left', ['Üst sol', 'Top left']]] },
      { key: 'format', type: 'select', label: ['Biçim', 'Format'], default: '{n}', choices: [['{n}', '1, 2, 3'], ['{n} / {t}', '1 / 10'], ['- {n} -', '- 1 -'], ['Sayfa {n}', ['Sayfa 1', 'Sayfa 1']], ['Sayfa {n} / {t}', ['Sayfa 1 / 10', 'Sayfa 1 / 10']]] },
      { key: 'from', type: 'number', label: ['Numaralandırma hangi sayfadan başlasın', 'Start numbering on page'], default: 1, min: 1 },
      { key: 'start', type: 'number', label: ['İlk numara', 'First number'], default: 1, min: 0 },
      { key: 'size', type: 'range', label: ['Yazı boyutu', 'Font size'], default: 10, min: 7, max: 20 },
    ],
    run: async ([f], o) => [{ name: pdfOut(f, '_numarali'), bytes: await core.pageNumbers(f.bytes, o, f.name) }] },

  // ── Güvenlik ──
  { id: 'compress', cat: 'secure', icon: 'compress', hue: 'teal', accept: '.pdf', multiple: true,
    title: ['PDF Sıkıştır', 'Compress PDF'], desc: ['E-postaya sığması için dosya boyutunu küçült.', 'Shrink the file so it fits in an e-mail.'], action: ['Sıkıştır', 'Compress'],
    options: [
      { key: 'mode', type: 'select', label: ['Yöntem', 'Method'], default: 'images', choices: [['images', ['Önerilen — görselleri küçült, metin korunur', 'Recommended — shrink images, keep text']], ['raster', ['En küçük — sayfaları görsele çevir (metin seçilemez)', 'Smallest — flatten pages to images (text not selectable)']]] },
      { key: 'level', type: 'select', label: ['Sıkıştırma düzeyi', 'Compression level'], default: 'medium', choices: [['low', ['Hafif (en iyi kalite)', 'Light (best quality)']], ['medium', ['Dengeli', 'Balanced']], ['high', ['Güçlü (en küçük dosya)', 'Strong (smallest file)']]] },
    ],
    async run(files, o, progress) {
      const out = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const bytes = await core.compress(f.bytes, o, f.name, (t, fr) => progress(`${f.name}${t ? ' — ' + t : ''}`, (i + (fr || 0)) / files.length));
        const pct = Math.round((1 - bytes.length / f.bytes.length) * 100);
        out.push({ name: pdfOut(f, '_kucuk'), bytes, info: bytes === f.bytes || pct <= 0 ? T('Daha fazla küçültülemedi', 'Could not shrink further') : T(`%${pct} küçüldü (${fmtSize(f.bytes.length)} → ${fmtSize(bytes.length)})`, `${pct}% smaller (${fmtSize(f.bytes.length)} → ${fmtSize(bytes.length)})`) });
      }
      return out;
    } },
  { id: 'protect', cat: 'secure', icon: 'lock', hue: 'teal', accept: '.pdf',
    title: ['PDF Şifrele', 'Protect PDF'], desc: ['PDF\'i açılış şifresiyle koru.', 'Protect a PDF with an open password.'], action: ['Şifrele', 'Protect'],
    options: [
      { key: 'password', type: 'password', label: ['Şifre', 'Password'], default: '' },
      { key: 'password2', type: 'password', label: ['Şifre (tekrar)', 'Repeat password'], default: '' },
      { key: 'allowPrint', type: 'checkbox', label: ['Yazdırmaya izin ver', 'Allow printing'], default: true },
      { key: 'allowCopy', type: 'checkbox', label: ['Metin kopyalamaya izin ver', 'Allow copying text'], default: true },
    ],
    async run([f], o) {
      if (!o.password) throw new Error(T('Bir şifre girin.', 'Enter a password.'));
      if (o.password !== o.password2) throw new Error(T('Şifreler aynı değil.', 'Passwords do not match.'));
      return [{ name: pdfOut(f, '_sifreli'), bytes: await core.protect(f.bytes, o, f.name) }];
    } },
  { id: 'unlock', cat: 'secure', icon: 'unlock', hue: 'teal', accept: '.pdf',
    title: ['Şifre Kaldır', 'Unlock PDF'], desc: ['Şifresini bildiğin PDF\'in açılış şifresini kaldır.', 'Remove the open password from a PDF whose password you know.'], action: ['Şifreyi kaldır', 'Unlock'],
    note: ['Yalnızca sahibi olduğun ya da korumayı kaldırma iznin olan belgelerde kullan. Yazarın koyduğu düzenleme/kopyalama kısıtlamaları kaldırılmaz.', 'Only use this on documents you own or are permitted to unlock. Editing/copying restrictions set by the author are not removed.'],
    options: [{ key: 'password', type: 'password', label: ['Açılış şifresi', 'Open password'], default: '' }],
    run: async ([f], o) => [{ name: pdfOut(f, '_sifresiz'), bytes: await core.unlock(f.bytes, o.password, f.name) }] },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);

// ───────── Genel araç sayfası ─────────
export function renderSimpleTool(tool, root, preset = []) {
  let files = [];
  const opts = {};
  for (const o of tool.options || []) opts[o.key] = o.default;
  const accept = typeof tool.accept === 'function' ? tool.accept() : tool.accept;
  const stage = h('div.stage');
  root.append(stage);

  async function addFiles(list) {
    for (const f of list) {
      const item = { name: f.name, bytes: await readFile(f), pages: null };
      if (tool.multiple) files.push(item); else files = [item];
      if (extOf(item.name) === 'pdf') core.openView(item.bytes, item.name).then((v) => { item.pages = v.numPages; v.destroy(); draw(); }).catch(() => {});
    }
    draw();
  }

  function field(o) {
    const id = 'opt-' + o.key;
    const set = (v) => { opts[o.key] = v; if ((tool.options || []).some((x) => x.showIf)) draw(); };
    let input;
    if (o.type === 'select') {
      input = h('select', { id, onchange: (e) => set(e.target.value) }, o.choices.map(([v, label]) => h('option', { value: v, selected: opts[o.key] === v }, L(label))));
    } else if (o.type === 'checkbox') {
      return h('label.check', h('input', { type: 'checkbox', checked: !!opts[o.key], onchange: (e) => set(e.target.checked) }), h('span', L(o.label)));
    } else if (o.type === 'range') {
      const val = h('output', String(opts[o.key]) + (o.unit || ''));
      input = h('div.range', h('input', { id, type: 'range', min: o.min, max: o.max, step: o.step || 1, value: opts[o.key], oninput: (e) => { opts[o.key] = +e.target.value; val.textContent = e.target.value + (o.unit || ''); } }), val);
    } else {
      input = h('input', { id, type: o.type, value: opts[o.key] ?? '', min: o.min, placeholder: o.placeholder || '', autocomplete: o.type === 'password' ? 'new-password' : 'off', oninput: (e) => { opts[o.key] = e.target.value; } });
    }
    return h('div.field', h('label', { for: id }, L(o.label)), input, o.hint ? h('div.hint', L(o.hint)) : null);
  }

  function draw() {
    stage.replaceChildren();
    const note = typeof tool.note === 'function' ? tool.note() : tool.note;
    if (!files.length) {
      stage.append(dropzone({ accept, multiple: !!tool.multiple, onFiles: addFiles, hint: accept.replace(/\./g, '').toUpperCase().replace(/,/g, ' · ') }));
      if (note) stage.append(h('p.note', L(note)));
      return;
    }
    const list = h('ul.files');
    files.forEach((f, i) => {
      list.append(h('li', { 'data-i': i },
        tool.multiple && files.length > 1 ? h('span.grip', { title: T('Sürükleyerek sırala', 'Drag to reorder') }, icon('grip')) : null,
        icon(extOf(f.name) === 'pdf' ? 'pdf' : 'file'),
        h('span.fname', f.name),
        h('span.fmeta', [f.pages ? T(`${f.pages} sayfa`, `${f.pages} page${f.pages > 1 ? 's' : ''}`) : null, fmtSize(f.bytes.length)].filter(Boolean).join(' · ')),
        h('button.icon-btn', { title: T('Kaldır', 'Remove'), 'aria-label': T('Kaldır', 'Remove'), onclick: () => { files.splice(i, 1); draw(); } }, icon('x'))));
    });
    if (tool.multiple && files.length > 1 && window.Sortable) {
      window.Sortable.create(list, { animation: 150, handle: '.grip', onEnd: (e) => { const [m] = files.splice(e.oldIndex, 1); files.splice(e.newIndex, 0, m); draw(); } });
    }
    const panel = h('div.panel', h('div.panel-main', list,
      tool.multiple ? dropzone({ accept, multiple: true, onFiles: addFiles, compact: true, title: T('Dosya ekle', 'Add files') }) : null));
    const visible = (tool.options || []).filter((o) => !o.showIf || o.showIf(opts));
    const side = h('div.panel-side',
      visible.length ? h('div.options', visible.map(field)) : null,
      note ? h('p.note', L(note)) : null,
      h('button.btn.primary.big', { disabled: files.length < (tool.min || 1), onclick: run }, L(tool.action || ['Başlat', 'Start'])),
      files.length < (tool.min || 1) ? h('div.hint', T(`En az ${tool.min} dosya ekleyin.`, `Add at least ${tool.min} files.`)) : null,
      h('button.btn.ghost', { onclick: () => { files = []; draw(); } }, T('Baştan başla', 'Start over')));
    panel.append(side);
    stage.append(panel);
  }

  async function run() {
    const b = busy(L(tool.title));
    try {
      const out = await tool.run(files, { ...opts }, (t, fr) => b.set(t, fr));
      b.close();
      showResult(out);
    } catch (e) {
      b.close();
      console.error(e);
      toast(errText(e), 'error', 7000);
    }
  }

  function showResult(out) {
    stage.replaceChildren();
    const zipAll = async () => {
      const zip = new window.JSZip();
      out.forEach((o) => zip.file(o.name, o.bytes));
      download(await zip.generateAsync({ type: 'blob' }), `${baseName(files[0]?.name || 'belgeci')}_${tool.id}.zip`);
    };
    const one = out.length === 1;
    stage.append(h('div.result',
      h('div.result-ico', icon('check')),
      h('h2', T('Hazır!', 'Done!')),
      out.via === 'engine' ? h('p.note', T('Yerel motor (LibreOffice) ile dönüştürüldü.', 'Converted with the local engine (LibreOffice).')) : null,
      one ? h('p.muted', [out[0].name, fmtSize(out[0].bytes.length), out[0].info].filter(Boolean).join(' · ')) : h('p.muted', T(`${out.length} dosya oluşturuldu`, `${out.length} files created`)),
      h('div.result-actions',
        one ? h('button.btn.primary.big', { onclick: () => download(out[0].bytes, out[0].name) }, icon('download'), T('İndir', 'Download'))
          : h('button.btn.primary.big', { onclick: zipAll }, icon('download'), T('Tümünü ZIP olarak indir', 'Download all as ZIP')),
        one && /\.pdf$/i.test(out[0].name) ? h('button.btn', { onclick: () => window.open(URL.createObjectURL(toBlob(out[0].bytes, out[0].name)), '_blank') }, T('Önizle', 'Preview')) : null,
        h('button.btn.ghost', { onclick: draw }, T('Geri dön', 'Back')),
        h('button.btn.ghost', { onclick: () => { files = []; draw(); } }, T('Yeni dosya', 'New file'))),
      one ? null : h('ul.files.out', out.map((o) => h('li', icon(extOf(o.name) === 'pdf' ? 'pdf' : 'file'), h('span.fname', o.name), h('span.fmeta', [fmtSize(o.bytes.length), o.info].filter(Boolean).join(' · ')), h('button.icon-btn', { title: T('İndir', 'Download'), 'aria-label': T('İndir', 'Download'), onclick: () => download(o.bytes, o.name) }, icon('download')))))));
    if (one) download(out[0].bytes, out[0].name);
  }

  draw();
  if (preset.length) addFiles(preset);
  return { addFiles };
}
