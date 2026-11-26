#!/usr/bin/env bash
# Deploy the Worker to production. From apps/worker: `npm run deploy`.
#
# Steps:
#   1. From a laptop (CI unset), the checks below run first.
#   2. Apply D1 migrations.
#   3. `wrangler deploy --tag <sha>`, so the dashboard's version list says
#      which commit is live.
#   4. Poll /health until it answers 200.
#
# Laptop checks: a clean tree, on a pushed main, then typecheck and tests.
# CI has already run those, so it skips them.
#
# Roll back: `pnpm exec wrangler rollback`. A rollback doesn't undo D1
# migrations, so keep migrations additive.
#
# DEPLOY_ORIGIN changes where the health check goes (self-hosted deploys).
set -euo pipefail

db="aired"
origin="${DEPLOY_ORIGIN:-https://aired.sh}"

cd "$(dirname "$0")/.."

sha="$(git rev-parse HEAD)"
tag="${sha:0:12}"
message="$(git log -1 --format=%s | cut -c1-100)"

if [ -z "${CI:-}" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Uncommitted changes. Commit them first, so the deploy tag names what ships." >&2
    exit 1
  fi
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
  echo "→ typecheck and tests"
  (cd ../.. && pnpm typecheck && pnpm test)
fi

echo "→ D1 migrations ($db)"
pnpm exec wrangler d1 migrations apply "$db" --remote

echo "→ deploy at $tag"
pnpm exec wrangler deploy --tag "$tag" --message "$message"

echo "→ health check $origin/health"
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 "$origin/health"; then
    echo
    echo "✓ live at $tag"
    exit 0
  fi
  sleep 5
done
echo "✗ $origin/health didn't answer 200 after the deploy." >&2
echo "  Look at the logs, then roll back if needed: pnpm exec wrangler rollback" >&2
exit 1
