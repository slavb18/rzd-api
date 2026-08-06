#!/usr/bin/env bash
#
# Rate-limits the public MCP endpoint at the Vercel edge: 60 requests per minute
# per client IP by default.
#
# The limit lives in the firewall rather than in the function because a
# serverless instance cannot count reliably - it keeps its counters in memory,
# scales horizontally and loses them on every cold start, so an in-process limit
# is really "N per instance". The edge also rejects the request before the
# function runs, so a flood costs no invocations.
#
# Idempotent: run it as often as you like. An existing rule is edited in place,
# a missing one is created, and the draft is published either way.
#
#   ./scripts/firewall-rate-limit.sh          apply the rule
#   ./scripts/firewall-rate-limit.sh check    show the live rule, change nothing
#
# Override any of these:
#   RULE_NAME=mcp-rate-limit
#   RATE_LIMIT_REQUESTS=60      requests allowed per window (1-10000000)
#   RATE_LIMIT_WINDOW=60        window in seconds (10-3600)
#   RATE_LIMIT_PATH=/mcp        path prefix the rule applies to
#   VERCEL="npx --yes vercel@latest"
#
set -euo pipefail

RULE_NAME="${RULE_NAME:-mcp-rate-limit}"
RATE_LIMIT_REQUESTS="${RATE_LIMIT_REQUESTS:-60}"
RATE_LIMIT_WINDOW="${RATE_LIMIT_WINDOW:-60}"
RATE_LIMIT_PATH="${RATE_LIMIT_PATH:-/mcp}"
VERCEL="${VERCEL:-npx --yes vercel@latest}"

cd "$(dirname "$0")/.."

if ! $VERCEL whoami >/dev/null 2>&1; then
  echo "Not signed in to Vercel. Run: ${VERCEL} login" >&2
  exit 1
fi

if [ "${1:-apply}" = "check" ]; then
  exec $VERCEL firewall rules inspect "$RULE_NAME"
fi

# The rule is keyed on the client IP. Vercel overwrites x-forwarded-for and
# refuses external values, so the address behind this key cannot be spoofed.
flags=(
  --condition "{\"type\":\"path\",\"op\":\"pre\",\"value\":\"${RATE_LIMIT_PATH}\"}"
  --action rate_limit
  --rate-limit-window "$RATE_LIMIT_WINDOW"
  --rate-limit-requests "$RATE_LIMIT_REQUESTS"
  --rate-limit-keys ip
  --rate-limit-action deny
  --description "Read-only MCP endpoint, no authentication: cap one client at ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW}s."
  --yes
)

if $VERCEL firewall rules inspect "$RULE_NAME" >/dev/null 2>&1; then
  echo "Rule ${RULE_NAME} exists, updating it."
  $VERCEL firewall rules edit "$RULE_NAME" "${flags[@]}"
else
  echo "Rule ${RULE_NAME} is missing, creating it."
  $VERCEL firewall rules add "$RULE_NAME" "${flags[@]}"
fi

# add and edit only stage a draft; nothing is live until it is published.
$VERCEL firewall publish --yes
$VERCEL firewall rules inspect "$RULE_NAME"
