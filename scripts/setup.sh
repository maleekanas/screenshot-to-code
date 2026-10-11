#!/usr/bin/env bash
# One-shot local setup: installs Poetry (if missing), backend + frontend
# dependencies, the Playwright Chromium used for screenshot previews, and
# creates backend/.env from the example template.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }

if command -v poetry >/dev/null 2>&1; then
  POETRY="poetry"
elif [ -x "$HOME/.local/bin/poetry" ]; then
  POETRY="$HOME/.local/bin/poetry"
elif command -v uv >/dev/null 2>&1; then
  info "Installing Poetry with uv (Python 3.12)"
  uv python install 3.12
  uv tool install poetry --python 3.12
  POETRY="$(uv tool dir --bin)/poetry"
  "$POETRY" -C backend env use "$(uv python find 3.12)"
else
  info "Installing Poetry"
  curl -sSL https://install.python-poetry.org | python3 -
  POETRY="$HOME/.local/bin/poetry"
fi

info "Installing backend dependencies"
"$POETRY" -C backend install --no-interaction

info "Installing Playwright Chromium (optional screenshot preview tool)"
"$POETRY" -C backend run playwright install chromium || \
  echo "Skipping Chromium install; screenshot preview will be disabled."

if ! command -v pnpm >/dev/null 2>&1; then
  info "Enabling pnpm via corepack"
  corepack enable
fi

info "Installing frontend dependencies"
pnpm -C frontend install

if [ ! -f backend/.env ]; then
  info "Creating backend/.env from backend/.env.example"
  cp backend/.env.example backend/.env
fi

info "Done. Add your API keys to backend/.env, then run: pnpm dev"
