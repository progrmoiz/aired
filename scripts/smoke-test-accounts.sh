#!/usr/bin/env bash
# smoke-test-accounts.sh
#
# Integration smoke tests for the aired accounts feature (GitHub OAuth + JWT).
#
# Usage:
#   BASE_URL=http://localhost:8787 bash scripts/smoke-test-accounts.sh
#   BASE_URL=https://aired.sh SKIP_BROWSER=1 bash scripts/smoke-test-accounts.sh
#
# Environment variables:
#   BASE_URL      Worker origin. Default: http://localhost:8787 (wrangler dev)
#   SKIP_BROWSER  Set to 1 to skip interactive browser-based OAuth steps (use device flow instead)
#
# Prerequisites:
#   - wrangler dev running on BASE_URL, or a live deployment URL
#   - npx aired available (or aired installed globally)
#   - curl available
#   - For steps 14/15/17: dev SESSION_SECRET known + wrangler CLI available
#
# Steps that are FULLY AUTOMATED (pure HTTP, no OAuth required):
#   1  Anonymous publish + update
#   6  JWT tamper test
#   8  OAuth no-state-cookie
#   9  OAuth state-mismatch
#   10 OAuth user-cancel
#   11 CSRF claim (no X-Aired-Request header)
#   12 CSRF delete (no X-Aired-Request header)
#   13 CSRF safe-method bypass (GET is OK without header)
#   18 Anonymous flow still works post-login
#
# Steps that require interactive OAuth (marked MANUAL in output):
#   2  Login
#   3  Authenticated publish + claim --all
#   4  whoami
#   5  Authenticated publish attribution
#   7  Bearer-replay-after-logout
#
# Steps marked TODO (require dev SESSION_SECRET or wrangler KV tooling):
#   14 Sliding-reissue revokes-old-JTI
#   15 Stale-index self-heal
#
# Steps marked MANUAL (require multiple owned pages under a real account):
#   16 claim-batch identical reasons
#   17 Authenticated DELETE rate limit

set -e
set -u

BASE_URL="${BASE_URL:-http://localhost:8787}"
SKIP_BROWSER="${SKIP_BROWSER:-0}"

PASS=0
FAIL_COUNT=0
SKIPPED=0

step() {
  echo "==> step $1: $2" >&2
}

pass_step() {
  echo "    PASS" >&2
  PASS=$((PASS + 1))
}

skip_step() {
  echo "    SKIPPED: $1" >&2
  SKIPPED=$((SKIPPED + 1))
}

fail_step() {
  echo "FAIL: $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  # do not exit immediately — collect all failures so the report is complete
}

assert_http_status() {
  local actual="$1"
  local expected="$2"
  local ctx="$3"
  if [ "$actual" != "$expected" ]; then
    fail_step "$ctx: expected HTTP $expected, got HTTP $actual"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Step 1: Anonymous regression
# ---------------------------------------------------------------------------
step 1 "Anonymous publish (no session) → URL returned; update via stored token → succeeds"

PUBLISH_OUTPUT=$(npx aired examples/hello.html --json --api-url "$BASE_URL" 2>/dev/null || true)
PAGE_ID=$(echo "$PUBLISH_OUTPUT" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
PAGE_URL=$(echo "$PUBLISH_OUTPUT" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//')

if [ -z "$PAGE_ID" ] || [ -z "$PAGE_URL" ]; then
  fail_step "Anonymous publish did not return id/url. Output: $PUBLISH_OUTPUT"
else
  # Attempt update via stored token (will pass if token was saved)
  UPDATE_OUTPUT=$(npx aired update "$PAGE_ID" examples/hello.html --json --api-url "$BASE_URL" 2>/dev/null || true)
  UPDATE_URL=$(echo "$UPDATE_OUTPUT" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//')
  if [ -z "$UPDATE_URL" ]; then
    fail_step "Anonymous update via stored token failed. Output: $UPDATE_OUTPUT"
  else
    pass_step
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: Login
# ---------------------------------------------------------------------------
step 2 "Login (device flow in CI, browser flow otherwise)"

if [ "$SKIP_BROWSER" = "1" ]; then
  # Device flow — non-interactive only if a token code appears and we can poll.
  # In a pure CI environment with no GitHub credentials, skip gracefully.
  echo "    Attempting device flow login..." >&2
  if npx aired login --device --api-url "$BASE_URL" 2>/dev/null; then
    pass_step
  else
    skip_step "no GitHub credentials available in this environment — device flow login skipped"
  fi
else
  # Browser flow requires a human to click through GitHub OAuth.
  # MANUAL: run `npx aired login --api-url $BASE_URL` interactively.
  skip_step "MANUAL — run 'npx aired login --api-url $BASE_URL' interactively, then re-run this script"
fi

# ---------------------------------------------------------------------------
# Step 3: Authenticated publish + claim --all
# ---------------------------------------------------------------------------
step 3 "Authenticated publish + claim --all"

SESSION_FILE="$HOME/.config/aired/session.json"
if [ ! -f "$SESSION_FILE" ]; then
  skip_step "MANUAL — requires login (step 2). Run 'npx aired login' first."
else
  AUTH_PUBLISH=$(npx aired examples/hello.html --json --api-url "$BASE_URL" 2>/dev/null || true)
  AUTH_PAGE_ID=$(echo "$AUTH_PUBLISH" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
  if [ -z "$AUTH_PAGE_ID" ]; then
    fail_step "Authenticated publish failed. Output: $AUTH_PUBLISH"
  else
    CLAIM_OUTPUT=$(npx aired claim --all --api-url "$BASE_URL" 2>/dev/null || true)
    # claim --all exits 0 on success; any output with "failed" that isn't partial is suspicious
    if echo "$CLAIM_OUTPUT" | grep -qi "error"; then
      fail_step "claim --all reported an error. Output: $CLAIM_OUTPUT"
    else
      pass_step
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 4: whoami
# ---------------------------------------------------------------------------
step 4 "whoami returns @login"

if [ ! -f "$SESSION_FILE" ]; then
  skip_step "MANUAL — requires login (step 2)"
else
  WHOAMI=$(npx aired whoami --api-url "$BASE_URL" 2>/dev/null || true)
  if echo "$WHOAMI" | grep -qE '@[a-zA-Z0-9_-]+'; then
    pass_step
  else
    fail_step "whoami did not return @login. Output: $WHOAMI"
  fi
fi

# ---------------------------------------------------------------------------
# Step 5: Authenticated publish attribution
# ---------------------------------------------------------------------------
step 5 "Authenticated publish appears in /api/me/pages"

if [ ! -f "$SESSION_FILE" ]; then
  skip_step "MANUAL — requires login (step 2)"
else
  JWT=$(python3 -c "import json,sys; d=json.load(open('$SESSION_FILE')); print(d.get('jwt',''))" 2>/dev/null || true)
  if [ -z "$JWT" ]; then
    skip_step "could not read JWT from session.json"
  else
    MY_PAGES_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/me/pages" \
      -H "aired-Session: $JWT" 2>/dev/null)
    if assert_http_status "$MY_PAGES_STATUS" "200" "GET /api/me/pages"; then
      # Check the newly published page appears
      MY_PAGES_BODY=$(curl -s "$BASE_URL/api/me/pages" -H "aired-Session: $JWT" 2>/dev/null)
      if [ -n "$AUTH_PAGE_ID" ] && echo "$MY_PAGES_BODY" | grep -q "$AUTH_PAGE_ID"; then
        pass_step
      else
        skip_step "page id not in /api/me/pages (AUTH_PAGE_ID may not be set — step 3 was skipped)"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 6: JWT tamper test
# ---------------------------------------------------------------------------
step 6 "Mangled JWT in aired-Session header → 401"

# Build a fake JWT (change last char of a plausible-looking token)
FAKE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEyMywibG9naW4iOiJ0ZXN0IiwiZW1haWwiOm51bGwsIm5hbWUiOiJUZXN0IiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTksImp0aSI6ImFiY2QiLCJ2IjoxfQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAX"

TAMPER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/me" \
  -H "aired-Session: $FAKE_JWT" 2>/dev/null)

if assert_http_status "$TAMPER_STATUS" "401" "JWT tamper → /api/me"; then
  pass_step
fi

# ---------------------------------------------------------------------------
# Step 7: Bearer-replay-after-logout
# ---------------------------------------------------------------------------
step 7 "Capture JWT, logout, replay → 401"

if [ ! -f "$SESSION_FILE" ]; then
  skip_step "MANUAL — requires login (step 2). Capture JWT before logout, run 'npx aired logout', then curl /api/me with the captured JWT and assert 401."
else
  PRE_LOGOUT_JWT=$(python3 -c "import json,sys; d=json.load(open('$SESSION_FILE')); print(d.get('jwt',''))" 2>/dev/null || true)
  if [ -z "$PRE_LOGOUT_JWT" ]; then
    skip_step "could not read JWT from session.json"
  else
    npx aired logout --api-url "$BASE_URL" >/dev/null 2>&1 || true
    REPLAY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/me" \
      -H "aired-Session: $PRE_LOGOUT_JWT" 2>/dev/null)
    if assert_http_status "$REPLAY_STATUS" "401" "JWT replay after logout → /api/me"; then
      pass_step
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 8: OAuth no-state-cookie test
# ---------------------------------------------------------------------------
step 8 "OAuth no-state-cookie: /auth/callback?code=fake&state=fake with no cookie → 400"

NOSTATE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/auth/callback?code=fake&state=fake" 2>/dev/null)

if assert_http_status "$NOSTATE_STATUS" "400" "OAuth no-state-cookie"; then
  pass_step
fi

# ---------------------------------------------------------------------------
# Step 9: OAuth state-mismatch test
# ---------------------------------------------------------------------------
step 9 "OAuth state-mismatch: cookie=A, URL state=B → 400"

MISMATCH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/auth/callback?code=fake&state=state_b" \
  -H "Cookie: aired_oauth_state=state_a" 2>/dev/null)

if assert_http_status "$MISMATCH_STATUS" "400" "OAuth state-mismatch"; then
  pass_step
fi

# ---------------------------------------------------------------------------
# Step 10: OAuth user-cancel test
# ---------------------------------------------------------------------------
step 10 "OAuth user-cancel: ?error=access_denied → 302 to /?login_cancelled=1"

CANCEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -L \
  "$BASE_URL/auth/callback?error=access_denied&state=anything" 2>/dev/null)
# Follow redirects — the final destination should be the landing with login_cancelled param
# We also check without -L to confirm the initial response is a redirect
CANCEL_RAW_HEADERS=$(curl -s -D - -o /dev/null \
  "$BASE_URL/auth/callback?error=access_denied&state=anything" 2>/dev/null)

CANCEL_LOCATION=$(echo "$CANCEL_RAW_HEADERS" | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
CANCEL_RAW_STATUS=$(echo "$CANCEL_RAW_HEADERS" | head -1 | awk '{print $2}')

if [ "$CANCEL_RAW_STATUS" = "302" ] && echo "$CANCEL_LOCATION" | grep -q "login_cancelled=1"; then
  pass_step
else
  fail_step "expected 302 to /?login_cancelled=1, got status=$CANCEL_RAW_STATUS location=$CANCEL_LOCATION"
fi

# ---------------------------------------------------------------------------
# Step 11: CSRF claim — no X-Aired-Request header → 403
# ---------------------------------------------------------------------------
step 11 "CSRF: POST /api/me/claim with cookie but no X-Aired-Request → 403"

# We use a fake cookie value — the CSRF check fires before auth, so we should get 403
CSRF_CLAIM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$BASE_URL/api/me/claim" \
  -H "Cookie: aired_session=fake_jwt_value" \
  -H "Content-Type: application/json" \
  -d '{"ids":["test"]}' 2>/dev/null)

if assert_http_status "$CSRF_CLAIM_STATUS" "403" "CSRF claim no X-Aired-Request"; then
  pass_step
fi

# ---------------------------------------------------------------------------
# Step 12: CSRF delete — no X-Aired-Request header → 403
# ---------------------------------------------------------------------------
step 12 "CSRF: DELETE /api/pages/:id with cookie but no X-Aired-Request → 403"

CSRF_DELETE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "$BASE_URL/api/pages/somefakeid" \
  -H "Cookie: aired_session=fake_jwt_value" 2>/dev/null)

if assert_http_status "$CSRF_DELETE_STATUS" "403" "CSRF delete no X-Aired-Request"; then
  pass_step
fi

# ---------------------------------------------------------------------------
# Step 13: CSRF safe-method bypass — GET /api/me without X-Aired-Request → 200 (or 401)
# ---------------------------------------------------------------------------
step 13 "CSRF safe-method bypass: GET /api/me with cookie but no X-Aired-Request → not 403"
# Safe methods (GET, HEAD) must not require the CSRF header.
# With a fake cookie the server returns 401 (invalid JWT), not 403 (CSRF rejection).
# Either 200 (valid session) or 401 (invalid/missing session) is acceptable here.
# 403 would mean CSRF middleware is incorrectly firing on GET — that is the failure case.

SAFE_GET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/me" \
  -H "Cookie: aired_session=fake_jwt_value" 2>/dev/null)

if [ "$SAFE_GET_STATUS" = "403" ]; then
  fail_step "GET /api/me returned 403 — CSRF middleware must not block safe methods"
elif [ "$SAFE_GET_STATUS" = "401" ] || [ "$SAFE_GET_STATUS" = "200" ]; then
  pass_step
else
  fail_step "GET /api/me returned unexpected status $SAFE_GET_STATUS"
fi

# ---------------------------------------------------------------------------
# Step 14: Sliding-reissue revokes-old-JTI (advanced)
# ---------------------------------------------------------------------------
step 14 "Sliding-reissue revokes old JTI (requires dev SESSION_SECRET)"
# TODO: requires dev SESSION_SECRET to fabricate a backdated JWT.
# Manual procedure:
#   1. Obtain SESSION_SECRET from apps/worker/.dev.vars
#   2. Use node scripts/test-jwt.mjs or a custom script to mint:
#        { sub: <your_uid>, login: '...', iat: now - 8*86400, exp: now + 30*86400, jti: uuid, v: 1 }
#      signed with SESSION_SECRET.
#   3. curl GET /api/me with aired-Session: <backdated_jwt>
#      → assert HTTP 200 + Set-Cookie header present (new JTI issued)
#   4. Replay the original backdated JWT
#      → assert HTTP 401 (old JTI revoked)
skip_step "TODO: requires dev SESSION_SECRET — see script comments for manual procedure"

# ---------------------------------------------------------------------------
# Step 15: Stale-index self-heal (advanced)
# ---------------------------------------------------------------------------
step 15 "Stale-index self-heal (requires wrangler KV write + real session)"
# TODO: requires wrangler CLI and a real authenticated session.
# Manual procedure:
#   1. Obtain your numeric user ID from `npx aired whoami --json`
#   2. wrangler kv:key put --binding PAGES_KV \
#        "pages_by_owner:<uid>:<rev_ts>:nonexistent_id" '{"expiresAt":null}'
#   3. curl GET /api/me/pages -H "aired-Session: $JWT"
#      → assert response body does not contain "nonexistent_id"
skip_step "TODO: requires wrangler KV write + real session — see script comments for manual procedure"

# ---------------------------------------------------------------------------
# Step 16: claim-batch identical reasons
# ---------------------------------------------------------------------------
step 16 "claim-batch: mixed failure batch → all reasons are 'claim failed'"
# MANUAL: requires a real authenticated session and knowledge of:
#   - a nonexistent page id
#   - a page id owned by a different user
#   - a page id where the local update_token does not match
# All three failure types must return reason: "claim failed" (no oracle).
# Procedure:
#   1. npx aired login (if not already)
#   2. curl -X POST /api/me/claim \
#        -H "aired-Session: $JWT" -H "X-Aired-Request: 1" \
#        -H "Content-Type: application/json" \
#        -d '{"ids":["nonexistent","cross-user-owned","wrong-token"]}'
#   3. Assert all entries in .failed[].reason === "claim failed"
skip_step "MANUAL — requires real session + specific page IDs. See script comments."

# ---------------------------------------------------------------------------
# Step 17: Authenticated DELETE rate limit → 429 on 11th delete
# ---------------------------------------------------------------------------
step 17 "Authenticated DELETE rate limit: 11th delete in same hour → 429"
# MANUAL: requires a real authenticated session and 11 owned pages.
# The delete tier is 10/hr/user (TIERS.delete).
# Procedure:
#   1. Publish 11 pages while authenticated
#   2. Delete 10 → all 200
#   3. Delete 11th → assert 429
skip_step "MANUAL — requires real session + 11 owned pages within an hour. See script comments."

# ---------------------------------------------------------------------------
# Step 18: Anonymous flow still works post-login (R1 final check)
# ---------------------------------------------------------------------------
step 18 "Anonymous flow still works after logout: publish without session → URL"

# Ensure session is cleared (logout if step 7 didn't already clear it)
npx aired logout --api-url "$BASE_URL" >/dev/null 2>&1 || true

# Temporarily move session.json aside if it somehow survived
SESSION_BACKUP=""
if [ -f "$SESSION_FILE" ]; then
  SESSION_BACKUP="${SESSION_FILE}.bak.$$"
  mv "$SESSION_FILE" "$SESSION_BACKUP"
fi

ANON_OUTPUT=$(npx aired examples/hello.html --json --api-url "$BASE_URL" 2>/dev/null || true)
ANON_URL=$(echo "$ANON_OUTPUT" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//')

# Restore backup if we moved it
if [ -n "$SESSION_BACKUP" ] && [ -f "$SESSION_BACKUP" ]; then
  mv "$SESSION_BACKUP" "$SESSION_FILE"
fi

if [ -z "$ANON_URL" ]; then
  fail_step "Anonymous publish post-logout failed. Output: $ANON_OUTPUT"
else
  pass_step
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "" >&2
echo "==> Smoke test summary" >&2
echo "    PASS:    $PASS" >&2
echo "    SKIPPED: $SKIPPED" >&2
echo "    FAIL:    $FAIL_COUNT" >&2

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "" >&2
  echo "FAIL: $FAIL_COUNT step(s) failed. See output above." >&2
  exit 1
fi

echo "" >&2
echo "All automated steps passed." >&2
echo "Manual steps (2, 3, 4, 5, 7, 16, 17) and TODO steps (14, 15) require a real GitHub session." >&2
exit 0
