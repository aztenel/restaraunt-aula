#!/usr/bin/env bash
# docker compose для production-стека AULA с текущим тегом из .deploy/current_tag.
# Для ручной работы на сервере:
#
#   ops/deploy/compose.sh ps
#   ops/deploy/compose.sh logs -f --tail=100 api worker
#   ops/deploy/compose.sh exec api node dist/cli/seed.js
#   ops/deploy/compose.sh run --rm backup backup.sh        # внеплановый бэкап
#   TAG=v1.4.0 ops/deploy/compose.sh config                # с явным тегом

# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

TAG="${TAG:-$(read_state current_tag)}"
[[ -n "$TAG" ]] || die "текущий тег неизвестен (.deploy/current_tag пуст) — задайте TAG=vX.Y.Z"
export TAG

compose "$@"
