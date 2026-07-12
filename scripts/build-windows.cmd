@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

set "TEMPBUILD=%TEMP%\care-taxi-meter-build-%RANDOM%"
set "TEMPOUT=%TEMP%\care-taxi-meter-dist-%RANDOM%"

mkdir "%TEMPBUILD%" 2>nul
mkdir "%TEMPOUT%" 2>nul

robocopy "%ROOT%" "%TEMPBUILD%" /E /XD node_modules dist .git .cursor /NFL /NDL /NJH /NJS /nc /ns /np
if %ERRORLEVEL% GTR 7 exit /b %ERRORLEVEL%

if exist "%TEMPBUILD%\node_modules" rmdir "%TEMPBUILD%\node_modules"
mklink /J "%TEMPBUILD%\node_modules" "%ROOT%\node_modules" >nul

set "CARE_TAXI_METER_OUT_DIR=%TEMPOUT%"
pushd "%TEMPBUILD%"
node "%ROOT%\scripts\viteBuildRunner.mjs" "%TEMPBUILD%"
set "BUILDERR=%ERRORLEVEL%"
popd

if %BUILDERR% NEQ 0 (
  rmdir /s /q "%TEMPBUILD%" 2>nul
  rmdir /s /q "%TEMPOUT%" 2>nul
  exit /b %BUILDERR%
)

if not exist "%TEMPOUT%\index.html" (
  rmdir /s /q "%TEMPBUILD%" 2>nul
  rmdir /s /q "%TEMPOUT%" 2>nul
  exit /b 1
)

if not exist "%TEMPOUT%\sw.js" (
  echo [build-windows] PWA service worker sw.js was not generated.
  rmdir /s /q "%TEMPBUILD%" 2>nul
  rmdir /s /q "%TEMPOUT%" 2>nul
  exit /b 1
)

if exist "%ROOT%\dist" rmdir /s /q "%ROOT%\dist"
robocopy "%TEMPOUT%" "%ROOT%\dist" /E /NFL /NDL /NJH /NJS /nc /ns /np
if %ERRORLEVEL% GTR 7 (
  set "COPYERR=%ERRORLEVEL%"
  rmdir /s /q "%TEMPBUILD%" 2>nul
  rmdir /s /q "%TEMPOUT%" 2>nul
  exit /b %COPYERR%
)

rmdir /s /q "%TEMPBUILD%" 2>nul
rmdir /s /q "%TEMPOUT%" 2>nul

if exist "%ROOT%\dist\index.html" if exist "%ROOT%\dist\sw.js" exit /b 0
exit /b 1
