#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PWNPILOT_ENV_FILE:-$SCRIPT_DIR/.env}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

load_env_file() {
    local env_file="$1"
    if [[ -f "$env_file" ]]; then
        echo -e "${BLUE}Using startup config from ${env_file}${NC}"
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    else
        echo -e "${YELLOW}No repo .env found at ${env_file}. Using built-in defaults.${NC}"
    fi
}

config_value() {
    local name="$1"
    local default_value="$2"
    local current_value="${!name:-}"
    if [[ -n "$current_value" ]]; then
        printf '%s' "$current_value"
        return
    fi
    printf '%s' "$default_value"
}

config_bool() {
    local raw_value
    raw_value="$(config_value "$1" "$2")"
    raw_value="${raw_value,,}"
    case "$raw_value" in
        1|true|yes|on) printf 'true' ;;
        0|false|no|off) printf 'false' ;;
        *) echo "Invalid boolean value for $1: '$raw_value'" >&2; exit 1 ;;
    esac
}

ensure_port_available() {
    local port="$1"
    local auto_stop="$2"

    if ! command -v lsof >/dev/null 2>&1; then
        echo "Warning: lsof not found. Cannot automatically check port $port."
        return
    fi

    if ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        return
    fi

    local pids
    pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN | tr '\n' ' ' | xargs)"

    if [[ "$auto_stop" != "true" ]]; then
        echo "Port $port is already in use by PID(s): ${pids}. Update ${ENV_FILE} to use another port or stop the process manually."
        exit 1
    fi

    echo "Port $port is in use. Attempting to stop running process..."
    if [[ -n "$pids" ]]; then
        echo "$pids" | xargs -r kill >/dev/null 2>&1 || true
        sleep 1
    fi

    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "Unable to free port $port automatically. Stop the existing process and retry."
        exit 1
    fi
}

echo -e "${BLUE}Starting PwnPilot...${NC}"

load_env_file "$ENV_FILE"

BACKEND_HOST="$(config_value BACKEND_HOST 127.0.0.1)"
BACKEND_PORT="$(config_value BACKEND_PORT 8000)"
FRONTEND_HOST="$(config_value FRONTEND_HOST 127.0.0.1)"
FRONTEND_PORT="$(config_value FRONTEND_PORT 5173)"
BACKEND_URL="$(config_value BACKEND_URL "http://${BACKEND_HOST}:${BACKEND_PORT}")"
API_BASE_URL="$(config_value API_BASE_URL "${BACKEND_URL}/api/v1")"
VITE_API_URL="$(config_value VITE_API_URL "${BACKEND_URL}")"
DEBUG_VALUE="$(config_value DEBUG false)"
CONSOLE_PROVIDER_VALUE="$(config_value LINUX_CONSOLE_PROVIDER "$(config_value CONSOLE_PROVIDER tmux_ttyd)")"
PROJECTS_ROOT_VALUE="$(config_value PROJECTS_ROOT "")"
AUTO_STOP_PORT_LISTENERS="$(config_bool AUTO_STOP_PORT_LISTENERS false)"

echo -e "${GREEN}[1/2] Starting backend...${NC}"
cd "$SCRIPT_DIR/backend"

ensure_port_available "$BACKEND_PORT" "$AUTO_STOP_PORT_LISTENERS"

if [[ ! -d ".venv" && -d "venv" ]]; then
    VENV_DIR="venv"
else
    VENV_DIR=".venv"
fi

if [[ ! -d "$VENV_DIR" ]]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"
pip install -q -r requirements.txt
python -m alembic upgrade head
export DEBUG="$DEBUG_VALUE"
export CONSOLE_PROVIDER="$CONSOLE_PROVIDER_VALUE"
export API_BASE_URL="$API_BASE_URL"
if [[ -n "$PROJECTS_ROOT_VALUE" ]]; then
    export PROJECTS_ROOT="$PROJECTS_ROOT_VALUE"
fi
uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
BACKEND_PID=$!

echo -e "${GREEN}[2/2] Starting frontend...${NC}"
cd "$SCRIPT_DIR/frontend"

ensure_port_available "$FRONTEND_PORT" "$AUTO_STOP_PORT_LISTENERS"

if [[ ! -d "node_modules" ]]; then
    echo "Installing dependencies..."
    npm install
fi

export VITE_API_URL="$VITE_API_URL"
npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ PwnPilot is running!${NC}"
echo -e "   Backend:  ${BACKEND_URL}"
echo -e "   Frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo -e "   Terminal provider: ${CONSOLE_PROVIDER_VALUE}"
echo -e "   Auto-stop conflicting listeners: ${AUTO_STOP_PORT_LISTENERS}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Press Ctrl+C to stop"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

wait
