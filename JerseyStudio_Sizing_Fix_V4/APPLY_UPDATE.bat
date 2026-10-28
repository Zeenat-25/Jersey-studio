@echo off
cd /d "%~dp0"
py APPLY_SIZING_UPDATE.py
if errorlevel 1 (echo Update not applied. Please read error above. & pause & exit /b 1)
echo.
echo Update files ready. Testing Vite build...
cd ..
call npm run build
if errorlevel 1 (echo BUILD FAILED. Keep backups, and do not push. & pause & exit /b 1)
echo BUILD PASSED. Test in browser via npm run dev before GitHub push.
pause
