// Ortak arayüz yardımcıları: dil, DOM, bildirim, indirme, dosya bırakma alanı.

let lang = 'tr';
try { lang = localStorage.getItem('lang') || ((navigator.language || 'tr').startsWith('tr') ? 'tr' : 'en'); } catch { /* yok say */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch { /* yok say */ }
  document.documentElement.lang = l;
}
/** T('Türkçe', 'English') */
export const T = (tr, en) => (lang === 'tr' ? tr : (en ?? tr));
/** L(['Türkçe','English']) ya da düz metin */
export const L = (v) => (Array.isArray(v) ? T(v[0], v[1]) : v);

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Küçük hyperscript: h('div.kart', {onclick}, çocuklar...) */
export function h(spec, attrs, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  logo: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  organize: P('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><path d="M17.5 15v6M14.5 18h6"/>'),
  merge: P('<path d="M8 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"/><path d="M9 12h6M12.5 9.5 15 12l-2.5 2.5"/>'),
  split: P('<path d="M12 3v18" stroke-dasharray="2 3"/><path d="M8 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  replace: P('<path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/>'),
  rotate: P('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>'),
  rotateL: P('<path d="M4 11a8 8 0 1 1 2.3 6.3"/><path d="M4 5v6h6"/>'),
  compare: P('<rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/><path d="M6 9h2M6 12h2M16 9h2M16 12h2"/>'),
  compress: P('<path d="M4 9h16M4 15h16M12 3v4M10 5l2 2 2-2M12 21v-4M10 19l2-2 2 2"/>'),
  ocr: P('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
  word: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m8.5 12 1.2 5 2.3-4 2.3 4 1.2-5"/>'),
  udf: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 12v3a3 3 0 0 0 6 0v-3"/>'),
  pdf: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 17v-5h1.5a1.5 1.5 0 0 1 0 3H9M14 12v5"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 20"/>'),
  text: P('<path d="M5 6h14M5 10h14M5 14h9M5 18h11"/>'),
  watermark: P('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z"/>'),
  number: P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 17h4M11 13.500l1-.8V17"/>'),
  lock: P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  unlock: P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.500-2"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'),
  download: P('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: P('<path d="M15 5l-7 7 7 7"/>'),
  undo: P('<path d="M9 13 4 8l5-5"/><path d="M4 8h10a6 6 0 0 1 0 12h-4"/>'),
  zoom: P('<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500M8.500 11h5M11 8.500v5"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5"/>'),
  moon: P('<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a8.500 8.500 0 1 0 10.500 10.500z"/>'),
  search: P('<circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>'),
  check: P('<path d="m5 12.500 4.500 4.500L19 7.500"/>'),
  file: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  blank: P('<rect x="5" y="3" width="14" height="18" rx="2" stroke-dasharray="3 3"/>'),
  extract: P('<rect x="4" y="3" width="10" height="13" rx="1.5"/><path d="M10 20h9a1 1 0 0 0 1-1V9M14 12h6M17.500 9.500 20 12l-2.500 2.500"/>'),
  shield: P('<path d="M12 3 5 6v5c0 4.500 3 8.500 7 10 4-1.500 7-5.500 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  grip: P('<circle cx="9" cy="7" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17" r="1"/><circle cx="15" cy="17" r="1"/>'),
};
export const icon = (name, cls = '') => h('span.ico' + (cls ? '.' + cls : ''), { html: ICONS[name] || ICONS.file, 'aria-hidden': 'true' });

export function toast(msg, type = 'info', ms = 4200) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div.toast.' + type, msg);
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
}
export const baseName = (name) => name.replace(/\.[^.]+$/, '');
export const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
/** File/Blob ya da {name, bytes} nesnesinden bayt dizisi (File.bytes() yöntemiyle karışmaması için tür denetimi yapılır) */
export const readFile = async (file) => (file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes);

const MIME = { pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain;charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', udf: 'application/octet-stream', jpg: 'image/jpeg', png: 'image/png' };
export function toBlob(data, name) {
  if (data instanceof Blob) return data;
  return new Blob([data], { type: MIME[extOf(name)] || 'application/octet-stream' });
}
export function download(data, name) {
  const url = URL.createObjectURL(toBlob(data, name));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** İlerleme göstergeli kilit ekranı */
export function busy(label) {
  const bar = h('div.bar', h('i'));
  const txt = h('div.busy-text', label || T('İşleniyor…', 'Working…'));
  const el = h('div.busy', h('div.busy-box', h('div.spinner'), txt, bar));
  document.body.append(el);
  return {
    set(text, frac) {
      if (text) txt.textContent = text;
      if (frac != null) { bar.classList.add('on'); bar.firstChild.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%'; }
    },
    close() { el.remove(); },
  };
}

/** Dosya seçme / sürükle-bırak alanı */
export function dropzone({ accept = '', multiple = false, onFiles, title, hint, compact = false }) {
  const input = h('input', { type: 'file', accept, multiple, hidden: true });
  const el = h('div.drop' + (compact ? '.compact' : ''), { tabIndex: 0, role: 'button' },
    icon('upload', 'big'),
    h('div.drop-title', title || T(multiple ? 'Dosyaları seç veya buraya sürükle' : 'Dosya seç veya buraya sürükle', multiple ? 'Choose files or drop them here' : 'Choose a file or drop it here')),
    hint ? h('div.drop-hint', hint) : null,
    input);
  const take = (list) => {
    let files = [...list];
    if (accept) {
      const exts = accept.split(',').map((s) => s.trim().toLowerCase());
      const ok = (f) => exts.some((e) => (e.startsWith('.') ? f.name.toLowerCase().endsWith(e) : e.endsWith('/*') ? f.type.startsWith(e.slice(0, -1)) : f.type === e));
      const bad = files.filter((f) => !ok(f));
      files = files.filter(ok);
      if (bad.length) toast(T('Desteklenmeyen dosya atlandı: ', 'Unsupported file skipped: ') + bad.map((f) => f.name).join(', '), 'warn');
    }
    if (!multiple) files = files.slice(0, 1);
    if (files.length) onFiles(files);
  };
  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); take(e.dataTransfer.files); });
  return el;
}

/** Programatik dosya seçici */
export function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, hidden: true });
    document.body.append(input);
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    input.click();
  });
}

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => { el.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const el = h('div.modal', { onclick: (e) => { if (e.target === el) close(); } },
    h('div.modal-box' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true' },
      h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, title: T('Kapat', 'Close'), 'aria-label': T('Kapat', 'Close') }, icon('x'))),
      h('div.modal-body', body)));
  document.addEventListener('keydown', esc);
  document.body.append(el);
  return { el, close };
}

export function errText(e) {
  const m = String(e?.message || e || '');
  if (/PDFDocument\.load|PasswordException/.test(m)) return T('Bu PDF şifreli. Önce "Şifre Kaldır" aracını kullanın.', 'This PDF is encrypted. Use the "Unlock" tool first.');
  if (/Invalid PDF|No PDF header|Failed to parse/i.test(m)) return T('Dosya geçerli bir PDF değil ya da bozuk.', 'The file is not a valid PDF or is corrupted.');
  return m || T('Bilinmeyen hata', 'Unknown error');
}
