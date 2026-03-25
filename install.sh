#!/bin/bash
set -e

# Colors
GREEN='\033[92m'
CYAN='\033[96m'
YELLOW='\033[93m'
RED='\033[91m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}  🧵 Stitcher Proxy Installer${RESET}"
echo -e "${CYAN}  LLMs have amnesia. Stitcher is the cure.${RESET}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed.${RESET}"
    echo ""
    echo "Install it with one of:"
    echo -e "  ${GREEN}curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts${RESET}"
    echo -e "  ${GREEN}brew install node${RESET}  (macOS)"
    echo -e "  ${GREEN}apt install nodejs npm${RESET}  (Ubuntu/Debian)"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js v18+ required. You have $(node -v).${RESET}"
    echo -e "Upgrade: ${GREEN}fnm install --lts${RESET} or ${GREEN}brew upgrade node${RESET}"
    exit 1
fi

echo -e "${GREEN}✓${RESET} Node.js $(node -v) detected"

# Install
echo -e "${CYAN}Installing stitcher-proxy globally...${RESET}"
npm install -g stitcher-proxy

echo ""
echo -e "${GREEN}${BOLD}✅ Installed!${RESET}"
echo ""
echo -e "  Run the setup wizard:  ${BOLD}stitcher-proxy init${RESET}"
echo -e "  Start the proxy:       ${BOLD}stitcher-proxy${RESET}"
echo -e "  Auto-configure tools:  ${BOLD}stitcher-proxy integrate all${RESET}"
echo ""

# Offer to run wizard
read -p "Run setup wizard now? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    stitcher-proxy init
fi
