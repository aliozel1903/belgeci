@echo off
rem Windows: cift tiklayarak PDF Atolyesini baslatir.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 server.py & goto :eof)
where python >nul 2>nul && (python server.py & goto :eof)
echo Python 3 bulunamadi. https://www.python.org/downloads/ adresinden kurun.
pause
