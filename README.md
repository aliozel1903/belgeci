# Belgeci

Ücretsiz, açık kaynak PDF araç seti. Reklam yok, hesap yok, dosya sınırı yok.
**Dosyalarınız hiçbir sunucuya yüklenmez**; bütün işlemler tarayıcınızda, kendi cihazınızda yapılır.

Hem **web sitesi** olarak (Cloudflare) hem de **bilgisayarda yerel** olarak çalışır. Arayüz Türkçe ve İngilizcedir.

## Araçlar

| Grup | Araç | Ne yapar |
|---|---|---|
| Düzenle | **Sayfa Düzenleyici** | Sayfa sil, taranmış sayfayla **değiştir**, araya PDF/görsel/boş sayfa ekle, sürükleyerek sırala, döndür, seçili sayfaları ayrı indir. Birden çok PDF ile çalışır, geri al (Ctrl+Z) destekler. |
| | PDF Birleştir | PDF ve görselleri istenen sırayla tek dosyada toplar. |
| | PDF Böl | Sayfa aralıklarına göre, her N sayfada bir ya da tek tek sayfalara böler; sayfa çıkarır. |
| | Karşılaştır | İki PDF'i yan yana gösterir, sayfaları hizalar, metin ve görsel farkları işaretler. |
| Dönüştür | Word → PDF, PDF → Word | DOCX ↔ PDF |
| | Görsel → PDF, PDF → Görsel | JPG/PNG/WebP ↔ PDF |
| | PDF → Metin | Düz metin çıkarır. |
| | OCR | Taranmış PDF/fotoğrafı aranabilir PDF'e ya da metne çevirir (Türkçe destekli). |
| Metin ve İşaret | **Metin Düzelt** | Sayfadaki bir satıra tıklayıp yazıyı değiştir (yazım hatası, tarih, isim); boyut ve yazı tipi otomatik eşleşir. Taranmış sayfalarda alan seçip yazılabilir. |
| | Filigran, Sayfa Numarası | |
| Güvenlik | Sıkıştır, Şifrele, Şifre Kaldır | |

### Örnek: belgedeki bir sayfayı taranmış haliyle değiştirmek

1. **Sayfa Düzenleyici**'yi aç, 100 sayfalık PDF'i bırak.
2. 60. sayfanın üzerine gel, **Değiştir** (↻) düğmesine bas ve o sayfanın taranmış halini (PDF ya da fotoğraf) seç.
3. **PDF'i indir**. Eski sayfa çıktı, yerine taranmış sayfa geldi.

## Kullanım

### 1) Web sürümü (Cloudflare)

1. Cloudflare panelinde **Workers & Pages → Create → Import a repository** ile bu depoyu seçin.
2. Ayarları olduğu gibi bırakın (deploy komutu `npx wrangler deploy`). Yayınlanacak klasör `wrangler.jsonc` dosyasında `web` olarak tanımlıdır; derleme adımı yoktur.
3. **Deploy**. Site `https://belgeci.<hesap-adı>.workers.dev` adresinde yayına girer; `main` dalına her gönderimde kendiliğinden güncellenir.

**Kendi alan adınız:** projede **Settings → Domains & Routes → Add → Custom domain** ile `belgeci.alanadiniz.com` gibi bir alt alan adı ekleyin
(alan adının DNS'i Cloudflare'de olmalıdır).
Alt alan adı kullanıldığında ana alan adınız başka işler için boşta kalır.

`web/` klasörü tamamen statiktir (derleme adımı yoktur); Netlify, Vercel ya da GitHub Pages gibi herhangi bir statik barındırmaya da olduğu gibi konabilir.
`web/_headers` dosyası Cloudflare'e güvenlik ve önbellek başlıklarını bildirir.
Site telefona/bilgisayara uygulama gibi kurulabilir (PWA) ve bir kez açıldıktan sonra çevrimdışı da çalışır.

### 2) Yerel sürüm

Tek gereksinim [Python 3](https://www.python.org/downloads/) (ek paket kurulmaz).

- **macOS:** `Belgeci.command` dosyasına çift tıklayın.
- **Windows:** `Belgeci.bat` dosyasına çift tıklayın.
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
- **PDF → Word:** PDF bir "baskı" biçimidir; paragraflar ve hizalama sezgisel olarak çıkarılır, tablolar düz metne dönüşür. Taranmış sayfalar görsel olarak eklenir (önce OCR yapılırsa metin olur).
- **OCR** ilk kullanımda motoru ve dil verisini (~15 MB) internetten indirir; belge yine cihazınızda işlenir.
- **Metin Düzelt:** eski metnin üstü zemin rengiyle örtülüp yenisi yazılır; eski metin varsayılan olarak dosyada kalır ve kopyalanarak görülebilir. "Eski metni dosyadan tamamen sil" seçilirse düzeltilen sayfalar görüntüye çevrilir (o sayfalarda metin seçilemez). Yalnızca yatay metin satırları tıklanarak seçilebilir.
- **Sıkıştır:** "Önerilen" yöntem yalnızca gömülü JPEG görselleri küçültür; zaten küçük ya da yalnızca metin içeren PDF'lerde kazanç olmayabilir.
- Şifreleme standart PDF parola korumasıdır; şifre kaldırmak için şifreyi bilmeniz gerekir.

## Yasal uyarı

- Belgeci bağımsız, gönüllü bir açık kaynak projedir. **Herhangi bir kurum ya da şirketle bağlantısı yoktur.**
- Yazılım MIT lisansıyla **"olduğu gibi"** sunulur; hiçbir garanti verilmez. Özellikle mahkemeye, resmî kuruma ya da karşı tarafa gönderilecek belgelerde dönüştürülmüş çıktıyı kullanmadan önce mutlaka kontrol edin.
- Uygulamayı yalnızca **üzerinde hakkınız olan** belgelerde kullanın. Şifre Kaldır aracı yalnızca açılış şifresini bildiğiniz belgeler içindir. Belgeci, yazarın koyduğu düzenleme/kopyalama kısıtlamalarını **aşmaz**: böyle belgeler görüntülenebilir ama düzenlenemez, dönüştürülemez.
- Dosyalar tarayıcıda işlenir ve hiçbir sunucuya gönderilmez; uygulama çerez, hesap, analiz/izleme kullanmaz. Tek istisna OCR'dır: ilk kullanımda OCR motoru ve dil verisi jsDelivr CDN'inden indirilir (belgeniz gönderilmez).
- Üçüncü taraf bileşenlerin lisansları: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Proje yapısı

```
web/                  Statik uygulama (yayınlanan klasör)
  index.html, css/, js/
  js/pdfcore.js       pdf.js + pdf-lib sarmalayıcıları, temel PDF işlemleri
  js/organizer.js     Sayfa Düzenleyici
  js/compare.js       Karşılaştır
  js/edittext.js      Metin Düzelt
  js/tools.js         Araç kataloğu ve genel araç ekranı
  js/convert.js       Dönüşüm yönlendirici, yerel motor, OCR
  js/doc/             Belge modeli: DOCX okuma/yazma, PDF'ten metin modeli, PDF düzen motoru
  vendor/, fonts/     Üçüncü taraf kütüphaneler ve yazı tipleri
server.py             Yerel sunucu + LibreOffice köprüsü (yalnızca standart kütüphane)
```

Derleme adımı yoktur: dosyayı düzenleyip sayfayı yenilemek yeterlidir.

## Kullanılan açık kaynak bileşenler

Tam lisans metinleri: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)


[pdf-lib (@cantoo)](https://github.com/cantoo-scribe/pdf-lib) (MIT) · [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) ·
[fontkit](https://github.com/foliojs/fontkit) (MIT) · [JSZip](https://stuk.github.io/jszip/) (MIT) ·
[SortableJS](https://sortablejs.github.io/Sortable/) (MIT) · [Tesseract.js](https://tesseract.projectnaptha.com/) (Apache-2.0, CDN'den yüklenir) ·
[Liberation Fonts](https://github.com/liberationfonts/liberation-fonts) (SIL OFL 1.1)

## Lisans

[MIT](LICENSE)

---

## English

**Belgeci** ("document clerk" in Turkish) is a free, open-source PDF toolkit that runs entirely in your browser — files never leave your device.
Organize pages (delete / replace / insert / reorder / rotate), edit text, merge, split, compare side by side, convert between PDF, Word (DOCX),
and images, OCR, watermark, number, compress, protect and unlock.

- **Web:** deploy the static `web/` folder anywhere — e.g. Cloudflare Workers via the included `wrangler.jsonc` (no build step).
- **Local:** run `python3 server.py` (Python 3 only, no dependencies). If LibreOffice is installed, Office → PDF conversions use it for exact output.

The UI is available in Turkish and English (toggle in the top bar).
