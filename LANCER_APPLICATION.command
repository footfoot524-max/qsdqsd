#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo "   LANCEMENT DE FOOT KIT SWAPPER"
echo "=========================================="
echo ""

if ! command -v node &> /dev/null
then
    echo "ERREUR : Node.js n'est pas installe !"
    echo "Veuillez l'installer sur https://nodejs.org/"
    exit
fi

if [ ! -d "node_modules" ]; then
    echo "Installation des composants (premiere fois)..."
    npm install
fi

echo "Lancement du serveur..."
open http://localhost:3000
npm run dev
