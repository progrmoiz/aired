#!/usr/bin/env bash
# Deploy the Worker to staging or production. From apps/worker:
#
#   pnpm deploy:staging        # https://staging.aired.sh
#   pnpm deploy:production     # https://aired.sh (also `pnpm run deploy`)
#
# Steps:
#   1. From a laptop (CI unset), the checks below run first.
#   2. Apply D1 migrations.
#   3. `wrangler deploy --tag <sha>`, so the dashboard's version list says
#      which commit is live.
#   4. Poll /health until it answers 200.
#
# Laptop checks: a clean tree, production only from a pushed main, then
# typecheck and tests. CI has already run those, so it skips them.
#
# Roll back: `pnpm exec wrangler rollback` (add `--env staging` for staging).
# A rollback doesn't undo D1 migrations, so keep migrations additive.
set -euo pipefail

target="${1:-}"
case "$target" in
  staging)    db="aired-staging"; origin="https://staging.aired.sh" ;;
  production) db="aired";         origin="${DEPLOY_ORIGIN:-https://aired.sh}" ;;
  *) echo "usage: scripts/deploy.sh staging|production" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

# wrangler with --env staging for staging, no --env for production. A
# function, not an array, because macOS bash 3.2 can't expand an empty one.
wr() {
  if [ "$target" = staging ]; then pnpm exec wrangler "$@" --env staging; else pnpm exec wrangler "$@"; fi
}

sha="$(git rev-parse HEAD)"
tag="${sha:0:12}"
message="$(git log -1 --format=%s | cut -c1-100)"

if [ -z "${CI:-}" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Uncommitted changes. Commit them first, so the deploy tag names what ships." >&2
    exit 1
  fi
  if [ "$target" = production ]; then
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$branch" != main ]; then
      echo "Production deploys from main only (you're on $branch)." >&2
      exit 1
    fi
    git fetch --quiet origin main
    if [ "${ALLOW_UNPUSHED:-}" != 1 ] && ! git merge-base --is-ancestor HEAD origin/main; then
      echo "HEAD isn't on origin/main yet. Push first so CI checks it (ALLOW_UNPUSHED=1 to skip)." >&2
      exit 1
    fi
  fi
  echo "→ typecheck and tests"
  (cd ../.. && pnpm typecheck && pnpm test)
fi

echo "→ D1 migrations ($db)"
wr d1 migrations apply "$db" --remote

echo "→ deploy $target at $tag"
wr deploy --tag "$tag" --message "$message"

echo "→ health check $origin/health"
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 "$origin/health"; then
    echo
    echo "✓ $target is live at $tag"
    exit 0
  fi
  sleep 5
done
echo "✗ $origin/health didn't answer 200 after the deploy." >&2
if [ "$target" = staging ]; then
  echo "  Look at the logs, then roll back if needed: pnpm exec wrangler rollback --env staging" >&2
else
  echo "  Look at the logs, then roll back if needed: pnpm exec wrangler rollback" >&2
fi
exit 1
