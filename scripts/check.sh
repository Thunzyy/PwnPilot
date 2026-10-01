#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
  BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
  BACKEND_PYTHON="$BACKEND_DIR/venv/bin/python"
else
  echo "Backend virtual environment not found. Expected one of:" >&2
  echo "  $BACKEND_DIR/.venv/bin/python" >&2
  echo "  $BACKEND_DIR/venv/bin/python" >&2
  exit 1
fi

if command -v tmux >/dev/null 2>&1 && command -v ttyd >/dev/null 2>&1; then
  CONSOLE_PROVIDER_VALUE="tmux_ttyd"
else
  CONSOLE_PROVIDER_VALUE="legacy"
fi

run_backend_ruff() {
  if "$BACKEND_PYTHON" -m ruff --version >/dev/null 2>&1; then
    "$BACKEND_PYTHON" -m ruff check .
    return
  fi

  if command -v ruff >/dev/null 2>&1; then
    ruff check .
    return
  fi

  echo "ruff not found. Install backend dev requirements or add ruff to PATH." >&2
  exit 1
}

echo "==> Backend lint"
(
  cd "$BACKEND_DIR"
  run_backend_ruff

  echo "==> Backend migrations"
  "$BACKEND_PYTHON" -m alembic upgrade head

  echo "==> Backend tests"
  "$BACKEND_PYTHON" -m pytest -q

  echo "==> Backend import smoke"
  DEBUG=false CONSOLE_PROVIDER="$CONSOLE_PROVIDER_VALUE" "$BACKEND_PYTHON" -c "import app.main"
)

echo "==> Frontend lint"
(
  cd "$FRONTEND_DIR"
  npm run lint

  echo "==> Frontend build"
  npm run build

  echo "==> Frontend tests"
  npm run test

  echo "==> Frontend browser smoke"
  npm run test:e2e
)

echo "Verification completed successfully."
