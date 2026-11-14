#!/bin/bash
# macOS: çift tıklayarak PDF Atölyesi'ni başlatır.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 bulunamadı. https://www.python.org/downloads/ adresinden kurun."
  read -r -p "Kapatmak için Enter'a basın..."
  exit 1
fi
exec python3 server.py
