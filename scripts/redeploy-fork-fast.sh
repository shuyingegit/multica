#!/usr/bin/env bash
# Fast fork redeploy for day-to-day UI/API verification.
#
# Full `redeploy-fork.sh` (down + rebuild everything) is fine for major upgrades
# but wastes ~10+ minutes when you only changed the web sidebar or a Go handler.
#
# Usage (from the multica checkout that the deploy machine uses):
#   ./scripts/redeploy-fork-fast.sh frontend   # only rebuild+restart web  (UI tweaks)
#   ./scripts/redeploy-fork-fast.sh backend    # only rebuild+restart API
#   ./scripts/redeploy-fork-fast.sh all        # both images, but no compose down
#
# FORK PORT CONTRACT (hard):
#   Frontend host port = 3005
#   Backend  host port = 8088
# Publishing elsewhere previously crashed the live stack. Override only with
# MULTICA_ALLOW_ALT_PORTS=1 (and explicit FRONTEND_PORT / BACKEND_PORT).
#
# Requires: docker compose, BuildKit (DOCKER_BUILDKIT=1), existing stack already up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load fork port defaults first; ambient env still wins for deliberate overrides.
if [[ -f "$ROOT/scripts/fork-ports.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=fork-ports.env
  source "$ROOT/scripts/fork-ports.env"
  set +a
fi

# Re-assert after source so an empty .env cannot wipe the contract defaults.
export FRONTEND_PORT="${FRONTEND_PORT:-3005}"
export BACKEND_PORT="${BACKEND_PORT:-8088}"
export PORT="${BACKEND_PORT}"
export API_PORT="${BACKEND_PORT}"
export SERVER_PORT="${BACKEND_PORT}"
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"

if [[ "${FRONTEND_PORT}" != "3005" || "${BACKEND_PORT}" != "8088" ]]; then
  if [[ "${MULTICA_ALLOW_ALT_PORTS:-}" != "1" ]]; then
    echo "ERROR: SCS fork must publish FE=3005 BE=8088 (got FE=${FRONTEND_PORT} BE=${BACKEND_PORT})." >&2
    echo "        Wrong ports previously took the stack down. Set MULTICA_ALLOW_ALT_PORTS=1 to override." >&2
    exit 1
  fi
  echo "WARNING: MULTICA_ALLOW_ALT_PORTS=1 — publishing FE=${FRONTEND_PORT} BE=${BACKEND_PORT}" >&2
fi

TARGET="${1:-frontend}"
case "$TARGET" in
  frontend|web|fe) SERVICES=(frontend) ;;
  backend|api|be)  SERVICES=(backend) ;;
  all|both)        SERVICES=(backend frontend) ;;
  -h|--help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
  *)
    echo "unknown target: $TARGET (want: frontend | backend | all)" >&2
    exit 2
    ;;
esac

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export VERSION="${VERSION:-fork-$(date +%Y%m%d-%H%M%S)}"
export COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
export DATE="${DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
if [[ -z "${UPSTREAM_VERSION:-}" && -f UPSTREAM_BASE ]]; then
  UPSTREAM_VERSION="$(tr -d '[:space:]' < UPSTREAM_BASE)"
fi
export UPSTREAM_VERSION="${UPSTREAM_VERSION:-}"

COMPOSE=(docker compose -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml)

echo "==> fast redeploy"
echo "    target:   ${SERVICES[*]}"
echo "    ports:    FE=${FRONTEND_PORT}  BE=${BACKEND_PORT}  (fork contract)"
echo "    VERSION:  $VERSION"
echo "    COMMIT:   $COMMIT"
echo "    UPSTREAM: ${UPSTREAM_VERSION:-"(empty)"}"
echo "    cwd:      $ROOT"
START=$(date +%s)

# --no-deps: do not restart postgres / the other app when only one image changed.
# No `compose down`: keep DB and volumes warm.
"${COMPOSE[@]}" up -d --build --no-deps "${SERVICES[@]}"

ELAPSED=$(( $(date +%s) - START ))
echo "==> done in ${ELAPSED}s"
echo "    FE http://127.0.0.1:${FRONTEND_PORT}/"
echo "    BE http://127.0.0.1:${BACKEND_PORT}/"
echo "    tip: UI-only → ./scripts/redeploy-fork-fast.sh frontend"
echo "    tip: keep BuildKit cache (do not prune) so the 2nd run is much faster"
