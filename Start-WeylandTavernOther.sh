#!/bin/bash
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    echo "This start script does not work on Windows."
    echo "Use the windows batch script instead."
    disown
    exit 1
fi

cd "$(dirname "$0")" > /dev/null 2>&1

# ── Weyland palette (256-color: works on macOS Terminal, Linux and Termux) ──
if [ -t 1 ]; then
    R=$'\033[0m'
    WINE=$'\033[38;5;125m'
    PINK=$'\033[38;5;168m'
    ROSE=$'\033[38;5;211m'
    DIM=$'\033[38;5;244m'
    GRY=$'\033[38;5;251m'
    GRN=$'\033[38;5;114m'
    AMB=$'\033[38;5;179m'
    BLD=$'\033[1m'
else
    R=""; WINE=""; PINK=""; ROSE=""; DIM=""; GRY=""; GRN=""; AMB=""; BLD=""
fi

# ── Detect platform for the greeting ──
PLATFORM="Linux"
if [[ "$(uname -s)" == "Darwin" ]]; then
    PLATFORM="macOS"
elif [[ -n "$TERMUX_VERSION" || "$PREFIX" == *com.termux* ]]; then
    PLATFORM="Android (Termux)"
fi

# ── Node/npm bootstrap (before the pretty banner so nvm output isn't buried) ──
if ! command -v npm &> /dev/null
then
    read -p "npm is not installed. Do you want to install nodejs and npm? (y/n) " choice
    case "$choice" in
      y|Y )
        echo "Installing nvm..."
        export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" > /dev/null 2>&1
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash > /dev/null 2>&1
        source ~/.bashrc > /dev/null 2>&1
        if ! command -v nvm &> /dev/null; then
            echo "NVM installation failed. Please install nodejs manually."
            exit 1
        fi
        nvm install --lts > /dev/null 2>&1
        nvm use --lts > /dev/null 2>&1;;
      n|N )
        echo "Nodejs and npm will not be installed."
        exit;;
      * )
        echo "Invalid option. Nodejs and npm will not be installed."
        exit;;
    esac
fi

clear
echo ""
echo "  ${WINE}██╗    ██╗███████╗██╗   ██╗██╗      █████╗ ███╗   ██╗██████╗${R}"
echo "  ${WINE}██║    ██║██╔════╝╚██╗ ██╔╝██║     ██╔══██╗████╗  ██║██╔══██╗${R}"
echo "  ${PINK}██║ █╗ ██║█████╗   ╚████╔╝ ██║     ███████║██╔██╗ ██║██║  ██║${R}"
echo "  ${PINK}██║███╗██║██╔══╝    ╚██╔╝  ██║     ██╔══██║██║╚██╗██║██║  ██║${R}"
echo "  ${ROSE}╚███╔███╔╝███████╗   ██║   ███████╗██║  ██║██║ ╚████║██████╔╝${R}"
echo "  ${ROSE} ╚══╝╚══╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝${R}"
echo ""
echo "  ${DIM}───────────────────────${R}  ${BLD}${PINK}T A V E R N${R}  ${DIM}───────────────────────${R}"
echo "            ${DIM}V5.0 - by Kressa, Lucky Paw, Shiru & FFFox${R}"
echo ""
echo "  ${WINE}┌───────────────────────────────────────────────────────────┐${R}"
echo "  ${WINE}│${R}  ${AMB}■${R}  ${GRY}Keep this window open while using Weyland Tavern.${R}     ${WINE}│${R}"
echo "  ${WINE}│${R}     ${DIM}Closing it will shut down the server.${R}                 ${WINE}│${R}"
echo "  ${WINE}└───────────────────────────────────────────────────────────┘${R}"
echo ""
echo "  ${DIM}·${R}  ${GRY}Detected platform:${R} ${PINK}${PLATFORM}${R}"
echo ""

# ── Git update check ──
if ! command -v git &> /dev/null; then
    echo "  ${AMB}!${R}  ${GRY}Git is not installed - cannot check for updates.${R}"
    echo "     ${DIM}Please install git manually to receive the latest updates.${R}"
    read -p "  ${PINK}»${R} Continue without update checking? (Y/N) [Default: Y] " continue_nogit
    continue_nogit=${continue_nogit:-Y}
    if [[ "$continue_nogit" =~ ^[Nn]$ ]]; then
        exit 0
    fi
else
    # Get current branch name
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    # Get current version (just the commit hash since we don't use tags)
    CURRENT_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

    echo "  ${DIM}·${R}  ${GRY}Checking for Weyland Tavern updates...${R}"
    echo ""

    # Fetch latest from remote
    git fetch > /dev/null 2>&1

    # Get new version
    NEW_VERSION=$(git rev-parse --short origin/$CURRENT_BRANCH 2>/dev/null || echo "unknown")

    # Simply compare if they're different
    if [ "$CURRENT_VERSION" != "$NEW_VERSION" ]; then
        echo "  ${PINK}*${R}  ${BLD}${GRY}Update found.${R}"
        echo "     ${DIM}Current version:${R} ${GRY}${CURRENT_VERSION}${R}"
        echo "     ${DIM}New version:    ${R} ${PINK}${NEW_VERSION}${R}"
        echo ""
        read -p "  ${PINK}»${R} Apply update? (Y/N) [Default: Y] " apply_update
        apply_update=${apply_update:-Y}

        if [[ "$apply_update" =~ ^[Yy]$ ]]; then
            echo ""
            echo "  ${DIM}·${R}  ${GRY}Applying update...${R}"

            if ! git pull > SillyTavern/WTUpdate.log 2>&1; then
                echo ""
                echo "  ${AMB}!${R}  ${AMB}Update failed - there may be file conflicts.${R}"
                echo "     ${DIM}Generating log file: SillyTavern/WTUpdate.log${R}"
                echo ""
                git --no-pager diff --compact-summary | tee -a SillyTavern/WTUpdate.log
                echo ""
                read -p "  ${PINK}»${R} Reset to latest official version? Your personal files won't be affected. (Y/N) [Default: Y] " do_reset
                do_reset=${do_reset:-Y}

                if [[ "$do_reset" =~ ^[Yy]$ ]]; then
                    echo ""
                    echo "  ${DIM}·${R}  ${GRY}Resetting to latest version...${R}"

                    # Abort any stuck merge
                    git merge --abort > /dev/null 2>&1

                    # Clear any remaining conflicts
                    REMAINING=$(git diff --name-only --diff-filter=U 2>/dev/null)
                    if [ -n "$REMAINING" ]; then
                        while IFS= read -r file; do
                            [ -z "$file" ] && continue
                            git checkout --theirs "$file" > /dev/null 2>&1
                            git add "$file" > /dev/null 2>&1
                        done <<< "$REMAINING"
                    fi

                    # Hard reset to remote - no merge commits left behind
                    if ! git reset --hard "origin/$CURRENT_BRANCH" > /dev/null 2>&1; then
                        echo "  ${WINE}x${R}  ${WINE}Reset failed. Please contact support.${R}"
                        echo "     ${DIM}Log saved to: SillyTavern/WTUpdate.log${R}"
                        read -p "  ${PINK}»${R} Continue without update? (Y/N) [Default: N] " continue_update
                        continue_update=${continue_update:-N}
                        if [[ "$continue_update" =~ ^[Nn]$ ]]; then
                            exit 0
                        fi
                    else
                        echo "  ${GRN}√${R}  ${GRN}Update applied successfully.${R}"
                    fi
                else
                    read -p "  ${PINK}»${R} Continue without update? (Y/N) [Default: N] " continue_update
                    continue_update=${continue_update:-N}
                    if [[ "$continue_update" =~ ^[Nn]$ ]]; then
                        exit 0
                    fi
                fi
            else
                echo "  ${GRN}√${R}  ${GRN}Update applied successfully.${R}"
            fi
        else
            echo "  ${DIM}·${R}  ${GRY}Proceeding without update...${R}"
        fi
    else
        echo "  ${GRN}√${R}  ${GRY}Weyland Tavern is up to date.${R}  ${DIM}(version ${CURRENT_VERSION})${R}"
    fi
fi

echo ""
echo "  ${DIM}─────────────────────────────────────────────────────────────${R}"
echo ""

CONFIG_FILE="SillyTavern/config.yaml"
if [ -f "$CONFIG_FILE" ]; then
    if grep -qE '^[[:space:]]*enableCorsProxy:' "$CONFIG_FILE"; then
        tmpfile=$(mktemp)
        sed 's/^[[:space:]]*enableCorsProxy:.*/enableCorsProxy: true/' "$CONFIG_FILE" > "$tmpfile" && mv "$tmpfile" "$CONFIG_FILE"
    else
        printf '\nenableCorsProxy: true\n' >> "$CONFIG_FILE"
    fi
fi

if [ ! -f "SillyTavern/server.js" ]; then
    echo "  ${WINE}x${R}  ${WINE}SillyTavern/server.js was not found next to this launcher.${R}"
    echo "     ${DIM}Make sure the launcher sits in your WeylandTavern folder.${R}"
    read -n 1 -s
    exit 1
fi

# Install npm dependencies
echo "  ${DIM}·${R}  ${GRY}Preparing dependencies...${R} ${DIM}(first run can take a few minutes)${R}"
export NODE_ENV=production
cd SillyTavern && npm i --no-audit --no-fund --loglevel=error --no-progress --omit=dev > /dev/null 2>&1

echo ""
echo "  ${DIM}·${R}  ${GRY}Starting the Weyland Tavern server...${R}"

# Start the SillyTavern server in background
node --max-old-space-size=3072 server.js --listen true --listen-host 0.0.0.0 --listen-port 8000 "$@" > /dev/null 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > .wt.pid

# Always clean up the server if this window/script dies
cleanup() {
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
    rm -f .wt.pid > /dev/null 2>&1
}
trap cleanup EXIT INT TERM

# Wait until the server is actually listening before declaring it active.
# On the very first launch, SillyTavern downloads extra components
# (image captioning model and such) BEFORE it starts listening, which
# can take several minutes.
echo "  ${DIM}·${R}  ${GRY}Waiting for the server to come online...${R}"
echo "     ${DIM}First launch can take several minutes while extra${R}"
echo "     ${DIM}components download - this is normal. Hang tight~${R}"
echo ""

wait_ticks=0
server_up=0
while [ $wait_ticks -lt 300 ]; do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        break
    fi
    if node -e "const s=require('net').connect(8000,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500)" > /dev/null 2>&1; then
        server_up=1
        break
    fi
    wait_ticks=$((wait_ticks + 1))
    sleep 2
done

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "  ${WINE}x${R}  ${WINE}The server stopped unexpectedly while starting.${R}"
    echo "     ${DIM}Run this launcher again - if it keeps happening, contact support.${R}"
    read -n 1 -s
    exit 1
fi

if [ $server_up -eq 1 ]; then
    echo "  ${WINE}┌───────────────────────────────────────────────────────────┐${R}"
    echo "  ${WINE}│${R}                                                           ${WINE}│${R}"
    echo "  ${WINE}│${R}      ${GRN}■${R}  ${BLD}${GRY}WEYLAND TAVERN IS NOW ACTIVE${R}                      ${WINE}│${R}"
    echo "  ${WINE}│${R}         ${DIM}Server running on${R} ${PINK}localhost:8000${R}                  ${WINE}│${R}"
    echo "  ${WINE}│${R}                                                           ${WINE}│${R}"
    echo "  ${WINE}└───────────────────────────────────────────────────────────┘${R}"
    echo ""
    echo "     ${DIM}A browser window should open automatically.${R}"
    echo ""
    echo "  ${AMB}■${R}  ${GRY}Reminder: keep this window open!${R}"
    echo ""
else
    echo "  ${AMB}!${R}  ${GRY}The server is taking unusually long to start (10+ minutes).${R}"
    echo "     ${DIM}It may still be downloading, or something went wrong.${R}"
    echo "     ${DIM}If this keeps happening, please contact support.${R}"
    echo ""
fi

echo "  ${DIM}Press any key to shut down and close Weyland Tavern...${R}"
read -n 1 -s

echo ""
echo "  ${DIM}·${R}  ${GRY}Shutting down the Weyland Tavern server... see you soon~${R}"
exit 0
