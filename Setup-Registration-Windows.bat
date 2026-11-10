@echo off
cd /d "%~dp0"
python scripts\setup_registration.py
if errorlevel 1 pause
