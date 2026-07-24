#!/usr/bin/env bash
# Lightweight production smoke checks (no secrets).
set -euo pipefail

API="${SMOKE_API:-https://ghostchat-app.gustom81.workers.dev}"
WEB="${SMOKE_WEB:-https://ghostchat-web-two.vercel.app}"
API="${API%/}"
WEB="${WEB%/}"

echo "==> health (worker)"
h=$(curl -fsS --max-time 15 "$API/api/health")
echo "$h" | grep -q '"ok":true' || { echo "worker health failed: $h"; exit 1; }

echo "==> health (web rewrite)"
wh=$(curl -fsS --max-time 15 "$WEB/api/health")
echo "$wh" | grep -q '"ok":true' || { echo "web health failed: $wh"; exit 1; }

echo "==> create room"
create=$(curl -fsS --max-time 15 -X POST "$API/api/rooms" \
  -H 'content-type: application/json' \
  -d '{"maxParticipants":2}')
echo "$create"
room=$(echo "$create" | sed -n 's/.*"roomId":"\([^"]*\)".*/\1/p')
test -n "$room" || { echo "no roomId"; exit 1; }

# Prefer path-only; allow legacy wsUrl
if echo "$create" | grep -q '"wsPath"'; then
  echo "$create" | grep -q "\"wsPath\":\"/ws/$room\"" || {
    echo "unexpected wsPath"; exit 1;
  }
  # Must not leak loopback
  if echo "$create" | grep -qi '127.0.0.1\|localhost'; then
    echo "create response leaks loopback"; exit 1;
  fi
fi

echo "==> status probe"
st=$(curl -fsS --max-time 15 "$API/api/rooms/$room")
echo "$st"
echo "$st" | grep -q '"status":"ok"' || { echo "status not ok"; exit 1; }
# Public probe should not expose internalId
if echo "$st" | grep -q '"internalId"'; then
  echo "status leaks internalId"; exit 1;
fi

echo "==> landing"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$WEB/")
test "$code" = "200" || { echo "landing HTTP $code"; exit 1; }

echo "==> smoke OK"
