# PDF Atölyesi

Ücretsiz, açık kaynak PDF araç seti. Reklam yok, hesap yok, dosya sınırı yok.
**Dosyalarınız hiçbir sunucuya yüklenmez**; bütün işlemler tarayıcınızda, kendi cihazınızda yapılır.

Hem **web sitesi** olarak (GitHub Pages) hem de **bilgisayarda yerel** olarak çalışır. Arayüz Türkçe ve İngilizcedir.

## Araçlar

| Grup | Araç | Ne yapar |
|---|---|---|
| Düzenle | **Sayfa Düzenleyici** | Sayfa sil, taranmış sayfayla **değiştir**, araya PDF/görsel/boş sayfa ekle, sürükleyerek sırala, döndür, seçili sayfaları ayrı indir. Birden çok PDF ile çalışır, geri al (Ctrl+Z) destekler. |
| | PDF Birleştir | PDF ve görselleri istenen sırayla tek dosyada toplar. |
| | PDF Böl | Sayfa aralıklarına göre, her N sayfada bir ya da tek tek sayfalara böler; sayfa çıkarır. |
| | Karşılaştır | İki PDF'i yan yana gösterir, sayfaları hizalar, metin ve görsel farkları işaretler. |
| Dönüştür | Word → PDF, PDF → Word | DOCX ↔ PDF |
| | UDF → PDF, PDF → UDF | UYAP Doküman Editörü biçimi (.udf) ↔ PDF |
| | Word → UDF, UDF → Word | DOCX ↔ UDF |
| | Görsel → PDF, PDF → Görsel | JPG/PNG/WebP ↔ PDF |
| | PDF → Metin | Düz metin çıkarır. |
| | OCR | Taranmış PDF/fotoğrafı aranabilir PDF'e ya da metne çevirir (Türkçe destekli). |
| İşaretle | Filigran, Sayfa Numarası | |
| Güvenlik | Sıkıştır, Şifrele, Şifre Kaldır | |

### Örnek: imzalı sayfayı belgeye geri koymak

1. **Sayfa Düzenleyici**'yi aç, 100 sayfalık PDF'i bırak.
2. 60. sayfanın üzerine gel, **Değiştir** (↻) düğmesine bas ve taranmış imzalı sayfayı (PDF ya da fotoğraf) seç.
3. **PDF'i indir**. İmzasız sayfa gitti, yerine imzalısı geldi.

## Kullanım

### 1) Web sürümü (GitHub Pages)

Bu depoyu GitHub'a yükleyin, sonra **Settings → Pages → Source: GitHub Actions** seçin.
`main` dalına her gönderimde `.github/workflows/pages.yml` iş akışı `web/` klasörünü yayınlar.

`web/` klasörü tamamen statiktir; Netlify, Vercel, Cloudflare Pages gibi herhangi bir statik barındırmaya da olduğu gibi konabilir (derleme adımı yoktur).
Site telefona/bilgisayara uygulama gibi kurulabilir (PWA) ve bir kez açıldıktan sonra çevrimdışı da çalışır.

### 2) Yerel sürüm

Tek gereksinim [Python 3](https://www.python.org/downloads/) (ek paket kurulmaz).

- **macOS:** `PDF Atölyesi.command` dosyasına çift tıklayın.
- **Windows:** `PDF Atolyesi.bat` dosyasına çift tıklayın.
- **Linux / terminal:**

```bash
python3 server.py
```

Uygulama `http://127.0.0.1:8844` adresinde açılır. Sunucu yalnızca kendi bilgisayarınızı dinler.

### Yerel motor (isteğe bağlı, birebir Word → PDF)

Tarayıcı içi dönüştürücü metni, yazı biçimlerini, tabloları ve görselleri aktarır ama Word'ün sayfa düzenini birebir üretemez.
Bilgisayarınızda [LibreOffice](https://tr.libreoffice.org/) kuruluysa yerel sürüm bunu otomatik algılar ve
**Word / Excel / PowerPoint → PDF** dönüşümlerini LibreOffice ile birebir yapar (üst çubukta "Yerel motor açık" yazar).
`pip install pdf2docx` yapılırsa PDF → Word için de o kullanılır.

## Bilinen sınırlar

- **Word → PDF (tarayıcıda):** sayfa sonları Word'dekiyle aynı olmayabilir; üstbilgi/altbilgi, dipnot, metin kutusu ve karmaşık stiller aktarılmaz. Birebir sonuç için yerel motoru ya da Word'ün "PDF olarak kaydet" özelliğini kullanın.
- **PDF → Word / UDF:** PDF bir "baskı" biçimidir; paragraflar ve hizalama sezgisel olarak çıkarılır, tablolar düz metne dönüşür. Taranmış sayfalar görsel olarak eklenir (önce OCR yapılırsa metin olur).
- **UDF:** biçim resmî olarak belgelenmemiştir; metin, biçimlendirme, tablo, görsel, üst/altbilgi desteklenir. Üretilen dosyaları önemli işlerde UYAP Editör'de açıp kontrol edin. e-imzalı UDF'lerin imzası dönüşümde korunmaz.
- **OCR** ilk kullanımda motoru ve dil verisini (~15 MB) internetten indirir; belge yine cihazınızda işlenir.
- **Sıkıştır:** "Önerilen" yöntem yalnızca gömülü JPEG görselleri küçültür; zaten küçük ya da yalnızca metin içeren PDF'lerde kazanç olmayabilir.
- Şifreleme standart PDF parola korumasıdır; şifre kaldırmak için şifreyi bilmeniz gerekir.

## Proje yapısı

```
web/                  Statik uygulama (yayınlanan klasör)
  index.html, css/, js/
  js/pdfcore.js       pdf.js + pdf-lib sarmalayıcıları, temel PDF işlemleri
  js/organizer.js     Sayfa Düzenleyici
  js/compare.js       Karşılaştır
  js/tools.js         Araç kataloğu ve genel araç ekranı
  js/convert.js       Dönüşüm yönlendirici, yerel motor, OCR
  js/doc/             Belge modeli: UDF ve DOCX okuma/yazma, PDF'ten metin modeli, PDF düzen motoru
  vendor/, fonts/     Üçüncü taraf kütüphaneler ve yazı tipleri
server.py             Yerel sunucu + LibreOffice köprüsü (yalnızca standart kütüphane)
```

Derleme adımı yoktur: dosyayı düzenleyip sayfayı yenilemek yeterlidir.

## Kullanılan açık kaynak bileşenler

[pdf-lib (@cantoo)](https://github.com/cantoo-scribe/pdf-lib) (MIT) · [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) ·
[fontkit](https://github.com/foliojs/fontkit) (MIT) · [JSZip](https://stuk.github.io/jszip/) (MIT) ·
[SortableJS](https://sortablejs.github.io/Sortable/) (MIT) · [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0, CDN'den yüklenir) ·
[Liberation Fonts](https://github.com/liberationfonts/liberation-fonts) (SIL OFL 1.1)

## Lisans

[MIT](LICENSE)

---

## English

**PDF Atölyesi** ("PDF Workshop") is a free, open-source PDF toolkit that runs entirely in your browser — files never leave your device.
Organize pages (delete / replace / insert / reorder / rotate), merge, split, compare side by side, convert between PDF, Word (DOCX),
UYAP UDF and images, OCR, watermark, number, compress, protect and unlock.

- **Web:** deploy the static `web/` folder anywhere (a GitHub Pages workflow is included).
- **Local:** run `python3 server.py` (Python 3 only, no dependencies). If LibreOffice is installed, Office → PDF conversions use it for exact output.

The UI is available in Turkish and English (toggle in the top bar).
