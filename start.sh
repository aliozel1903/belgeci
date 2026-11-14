#!/bin/sh
# Linux / macOS terminal: ./start.sh
cd "$(dirname "$0")" && exec python3 server.py "$@"
