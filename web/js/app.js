// Belgeci — ana uygulama: yönlendirme, ana sayfa, tema ve dil.
import { T, L, h, icon, getLang, setLang, dropzone, modal, extOf, toast } from './ui.js';
import { TOOLS, CATS, toolById, renderSimpleTool } from './tools.js';
import { engine, checkEngine } from './convert.js';

const app = document.getElementById('app');
let pending = []; // ana sayfadan araca taşınan dosyalar

// ── tema ──
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
let theme = null;
try { theme = localStorage.getItem('theme'); } catch { /* yok say */ }
applyTheme(theme);
const isDark = () => (theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);

function header() {
  return h('header.top',
    h('a.brand', { href: '#/' }, h('span.brand-mark', icon('logo')), h('span', 'Belgeci')),
    h('div.top-right',
      engine.office ? h('span.pill.ok', { title: T('LibreOffice bulundu: Office dönüşümleri birebir yapılır.', 'LibreOffice found: Office conversions are exact.') }, T('Yerel motor açık', 'Local engine on')) : null,
      h('span.pill', { title: T('Dosyaların tarayıcında işlenir, hiçbir sunucuya yüklenmez.', 'Your files are processed in your browser and never uploaded.') }, icon('shield'), T('Dosyalar cihazında kalır', 'Files stay on your device')),
      h('button.icon-btn.lang', { onclick: () => { setLang(getLang() === 'tr' ? 'en' : 'tr'); render(); }, title: T('Switch to English', 'Türkçeye geç'), 'aria-label': T('Switch to English', 'Türkçeye geç') }, getLang() === 'tr' ? 'EN' : 'TR'),
      h('button.icon-btn', { onclick: () => { theme = isDark() ? 'light' : 'dark'; try { localStorage.setItem('theme', theme); } catch { /* yok say */ } applyTheme(theme); app.querySelector('header.top')?.replaceWith(header()); }, title: T('Açık / koyu tema', 'Light / dark theme'), 'aria-label': T('Tema değiştir', 'Toggle theme') }, icon(isDark() ? 'sun' : 'moon'))));
}

const acceptOf = (t) => (t.custom ? { organize: '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp', compare: '.pdf' }[t.id] : typeof t.accept === 'function' ? t.accept() : t.accept) || '';
const accepts = (t, f) => acceptOf(t).split(',').includes('.' + extOf(f.name));

function chooseTool(files) {
  const fits = TOOLS.filter((t) => files.every((f) => accepts(t, f)) && (files.length === 1 || t.multiple || t.id === 'organize' || (t.id === 'compare' && files.length === 2)));
  if (!fits.length) return toast(T('Bu dosya türü için uygun bir araç yok.', 'No tool fits this file type.'), 'warn');
  const m = modal(T('Ne yapmak istersin?', 'What would you like to do?'), h('div',
    h('p.muted', files.map((f) => f.name).join(', ')),
    h('div.cards.small', fits.map((t) => h('button.card.' + t.hue, { onclick: () => { pending = files; m.close(); location.hash = '#/t/' + t.id; } }, h('span.card-ico', icon(t.icon)), h('span.card-text', h('strong', L(t.title))))))));
}

function home() {
  const q = h('input.search-input', { type: 'search', placeholder: T('Araç ara… (ör. birleştir, böl, word)', 'Search tools… (e.g. merge, split, word)'), 'aria-label': T('Araç ara', 'Search tools') });
  const sections = h('div.sections');
  const card = (t) => h('a.card.' + t.hue + (t.featured ? '.featured' : ''), { href: '#/t/' + t.id },
    h('span.card-ico', icon(t.icon)),
    h('span.card-text', h('strong', L(t.title)), h('span', L(t.desc))));
  const fill = () => {
    const s = q.value.trim().toLocaleLowerCase('tr');
    const hit = (t) => !s || [...t.title, ...t.desc, t.id].join(' ').toLocaleLowerCase('tr').includes(s);
    sections.replaceChildren(...CATS.map(([id, name]) => {
      const list = TOOLS.filter((t) => t.cat === id && hit(t));
      return list.length ? h('section', h('h2', L(name)), h('div.cards', list.map(card))) : null;
    }).filter(Boolean));
    if (!sections.children.length) sections.append(h('p.muted.center', T('Eşleşen araç bulunamadı.', 'No matching tool.')));
  };
  q.addEventListener('input', fill);
  fill();
  return h('main.home',
    h('div.hero',
      h('h1', T('PDF işlerinin tamamı, tek yerde.', 'Every PDF job, in one place.')),
      h('p', T('Ücretsiz ve sınırsız. Dosyaların hiçbir sunucuya yüklenmez; her şey kendi cihazında çalışır.', 'Free and unlimited. Your files are never uploaded; everything runs on your own device.')),
      dropzone({ accept: '', multiple: true, onFiles: chooseTool, compact: true, title: T('Dosyanı buraya bırak, ne yapabileceğini gösterelim', 'Drop a file here to see what you can do') }),
      h('div.search', icon('search'), q)),
    sections,
    h('footer.foot',
      h('p', T('Belgeci · açık kaynak (MIT) · reklamsız, hesapsız, sınırsız', 'Belgeci · open source (MIT) · no ads, no accounts, no limits')),
      h('p.disclaimer', T('Bağımsız bir projedir; herhangi bir kurum ya da şirketle bağlantısı yoktur. Yazılım "olduğu gibi" sunulur, dönüştürülen belgeleri kullanmadan önce kontrol edin. Yalnızca hakkınız olan belgeleri işleyin.', 'An independent project, not affiliated with any institution or company. Provided "as is" — check converted documents before use. Only process documents you have the right to.'))));
}

async function toolPage(id) {
  const tool = toolById(id);
  if (!tool) { location.hash = '#/'; return h('main'); }
  const body = h('div.tool-body');
  const main = h('main.tool' + (tool.custom ? '.wide' : ''),
    h('div.tool-head',
      h('a.back', { href: '#/' }, icon('back'), T('Tüm araçlar', 'All tools')),
      h('div.tool-title', h('span.card-ico.' + tool.hue, icon(tool.icon)), h('div', h('h1', L(tool.title)), h('p', L(tool.desc))))),
    body);
  const files = pending; pending = [];
  if (tool.id === 'organize') (await import('./organizer.js')).renderOrganizer(body, files);
  else if (tool.id === 'compare') (await import('./compare.js')).renderCompare(body, files);
  else renderSimpleTool(tool, body, files);
  document.title = `${L(tool.title)} — Belgeci`;
  return main;
}

async function render() {
  const m = location.hash.match(/^#\/t\/([\w-]+)/);
  document.querySelectorAll('.modal, .menu, .busy').forEach((e) => e.remove());
  const page = m ? await toolPage(m[1]) : home();
  if (!m) document.title = T('Belgeci — Ücretsiz PDF araçları', 'Belgeci — Free PDF tools');
  app.replaceChildren(header(), page);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
// Tarayıcının bırakılan dosyayı açıp sayfadan çıkmasını engelle
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

setLang(getLang());
render();
checkEngine().then((e) => { if (e.office) app.querySelector('header.top')?.replaceWith(header()); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
