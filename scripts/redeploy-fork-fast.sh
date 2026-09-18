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
# Requires: docker compose, BuildKit (DOCKER_BUILDKIT=1), existing stack already up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-frontend}"
case "$TARGET" in
  frontend|web|fe) SERVICES=(frontend) ;;
  backend|api|be)  SERVICES=(backend) ;;
  all|both)        SERVICES=(backend frontend) ;;
  -h|--help)
    sed -n '2,16p' "$0"
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
echo "    tip: UI-only changes → ./scripts/redeploy-fork-fast.sh frontend"
echo "    tip: keep BuildKit cache (do not prune) so the 2nd run is much faster"
