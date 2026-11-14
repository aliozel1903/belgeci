#!/usr/bin/env python3
"""PDF Atölyesi — yerel sunucu.

Uygulamayı bilgisayarında çalıştırır (http://127.0.0.1:8844) ve LibreOffice kuruluysa
Word/Excel/PowerPoint → PDF dönüşümlerini birebir yapan "yerel motor"u sağlar.
Yalnızca Python standart kütüphanesini kullanır; kurulum gerektirmez.

Kullanım:  python3 server.py [--port 8844] [--no-browser]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent / "web"
MAX_UPLOAD = 300 * 1024 * 1024  # 300 MB
OFFICE_EXTS = {"doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "txt", "pdf"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


def find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        os.path.expanduser("~/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/lib/libreoffice/program/soffice",
        "/opt/libreoffice/program/soffice",
    ]
    return next((c for c in candidates if os.path.isfile(c)), None)


SOFFICE = find_soffice()
try:
    import pdf2docx  # type: ignore  # noqa: F401  (isteğe bağlı: daha iyi PDF → Word)
    HAS_PDF2DOCX = True
except Exception:
    HAS_PDF2DOCX = False


def convert(data: bytes, name: str, to: str) -> bytes:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in OFFICE_EXTS:
        raise ValueError(f"Desteklenmeyen dosya türü: .{ext}")
    if to not in {"pdf", "docx"}:
        raise ValueError("Geçersiz hedef biçim")
    with tempfile.TemporaryDirectory(prefix="pdfatolyesi-") as tmp:
        src = Path(tmp) / f"girdi.{ext}"
        src.write_bytes(data)
        out = Path(tmp) / f"girdi.{to}"
        if ext == "pdf" and to == "docx" and HAS_PDF2DOCX:
            from pdf2docx import Converter  # type: ignore

            cv = Converter(str(src))
            try:
                cv.convert(str(out))
            finally:
                cv.close()
        else:
            if not SOFFICE:
                raise RuntimeError("LibreOffice bulunamadı")
            profile = Path(tmp) / "profil"
            cmd = [SOFFICE, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore"]
            if ext == "pdf":
                cmd.append("--infilter=writer_pdf_import")
            cmd += ["--convert-to", to, "--outdir", tmp, str(src)]
            proc = subprocess.run(cmd, capture_output=True, timeout=300)
            if not out.exists():
                detail = (proc.stderr or proc.stdout or b"").decode("utf-8", "replace").strip()[-400:]
                raise RuntimeError("Dönüştürme başarısız oldu. " + detail)
        return out.read_bytes()


class Handler(SimpleHTTPRequestHandler):
    server_version = "PDFAtolyesi/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):  # sessiz
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _json(self, code: int, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, code: int, msg: str) -> None:
        body = msg.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_local(self) -> bool:
        """Yalnızca bu bilgisayardaki sayfadan gelen isteklere izin ver (başka siteler API'yi çağıramasın)."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin:
            return (urlparse(origin).hostname or "") in {"127.0.0.1", "localhost", "::1"}
        return True

    def do_GET(self):
        if urlparse(self.path).path == "/api/health":
            if not self._is_local():
                return self._text(403, "Yasak")
            return self._json(200, {"office": bool(SOFFICE), "pdf2docx": HAS_PDF2DOCX})
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/convert":
            return self._text(404, "Bulunamadı")
        if not self._is_local():
            return self._text(403, "Yasak")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_UPLOAD:
            return self._text(413, "Dosya boş ya da çok büyük")
        q = parse_qs(url.query)
        name = re.sub(r"[^\w.\- ]", "_", (q.get("name") or ["dosya"])[0])[-120:]
        to = (q.get("to") or ["pdf"])[0]
        data = self.rfile.read(length)
        try:
            result = convert(data, name, to)
        except subprocess.TimeoutExpired:
            return self._text(500, "Dönüştürme zaman aşımına uğradı")
        except Exception as exc:  # noqa: BLE001
            return self._text(500, str(exc))
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)


def main() -> None:
    ap = argparse.ArgumentParser(description="PDF Atölyesi yerel sunucusu")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8844)))
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if not ROOT.is_dir():
        sys.exit(f"web klasörü bulunamadı: {ROOT}")
    port = args.port
    httpd = None
    for _ in range(20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            port += 1
    if httpd is None:
        sys.exit("Boş port bulunamadı")
    url = f"http://127.0.0.1:{port}/"
    print(f"PDF Atölyesi çalışıyor: {url}")
    print("Yerel motor (LibreOffice): " + ("AÇIK — " + SOFFICE if SOFFICE else "kapalı (LibreOffice kurulursa Word → PDF birebir olur)"))
    print("Kapatmak için Ctrl+C")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatıldı.")


if __name__ == "__main__":
    main()
