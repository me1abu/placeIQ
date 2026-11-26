@echo off
REM PlaceIQ: one-click local start (Windows). Nothing is deployed anywhere.
REM   1. installs Python and Node packages (first run only)
REM   2. adds missing secrets to .env (roll-number salt, session secret, placement-cell password)
REM      and trains on the bundled public datasets if there is no model yet
REM   3. starts the PlaceIQ engine (127.0.0.1:8765) in its own window
REM   4. builds (first run) and starts the web app on http://127.0.0.1:3100 and opens it
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo Python 3.10+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js 20.9+ is required: https://nodejs.org & pause & exit /b 1)

if not exist ".venv\Scripts\python.exe" (
  echo [PlaceIQ] Creating Python environment...
  python -m venv .venv || (echo Could not create .venv & pause & exit /b 1)
)
if not exist ".venv\.placeiq-installed" (
  echo [PlaceIQ] Installing Python packages ^(first run only, several minutes^)...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo pip install failed. & pause & exit /b 1)
  echo ok> ".venv\.placeiq-installed"
)
if not exist "web\node_modules" (
  echo [PlaceIQ] Installing web packages...
  pushd web & call npm install --no-audit --no-fund & popd
)

".venv\Scripts\python.exe" -m placeiq init

REM Pass .env (salt, session secret, placement-cell password) to the web app as well.
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do if not "%%B"=="" set "%%A=%%B"

if not exist "placeiq-data\artifacts\model.joblib" (
  echo [PlaceIQ] No model yet: training on the bundled public placement datasets ^(about 2 minutes^)...
  ".venv\Scripts\python.exe" -m placeiq public
)

if not exist "web\.next\BUILD_ID" (
  echo [PlaceIQ] Building the web app ^(first run only^)...
  pushd web & call npm run build & popd
)

echo [PlaceIQ] Starting the engine on http://127.0.0.1:8765 ...
start "PlaceIQ engine" /min ".venv\Scripts\python.exe" -m placeiq serve

echo [PlaceIQ] Opening http://127.0.0.1:3100 ...
start "" "http://127.0.0.1:3100"
pushd web
call npm run start
popd
