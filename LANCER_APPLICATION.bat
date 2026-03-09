@echo off
echo ==========================================
echo    LANCEMENT DE FOOT KIT SWAPPER
echo ==========================================
echo.
echo Verification de Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR : Node.js n'est pas installe !
    echo Veuillez l'installer sur https://nodejs.org/
    pause
    exit
)

if not exist node_modules (
    echo Installation des composants (premiere fois)...
    call npm install
)

echo Lancement du serveur...
start http://localhost:3000
call npm run dev
pause
