#!/usr/bin/env bash
# End-to-end check against the local third-party tester (`pnpm connector:tester`).
#
# `connector:check` proves the pipeline against a public JSON API with no
# credential. This script proves the parts a credential changes, against a
# different backend on purpose (the tester at 127.0.0.1:4100 in the sibling
# `reorder-iq-business-tester` project, which serves a `{ ok, data, meta, links }`
# envelope and rejects a bad key with its own JSON error body):
#
#   - "Test connection" surfaces a provider's 401 verbatim, and never echoes the
#     credential it sent;
#   - a probe without a credential fails closed with a message that says so;
#   - a preview maps real rows, reports the row that has no phone with its reason,
#     and carries the raw page back;
#   - a stored credential is used without being sent again.
#
# Requires: the tester running, a ReorderIQ server, curl and jq. Skips (exit 0)
# when the tester is unreachable, so it never fails a hermetic CI run.
set -u
BASE="${BASE:-http://localhost:3000}"
ORIGIN="$BASE"
TESTER="${TESTER_BASE:-http://127.0.0.1:4100/api/v1}"
KEY="${TESTER_KEY:-rt_nairobi_fresh_produce}"
JAR=/tmp/connector-tester-check.txt
BODY=/tmp/connector-tester-check-body.json
STAMP="$(date +%s)"
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1 (expected=$2 actual=$3)"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $1"; SKIP=$((SKIP+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
grep_yes(){ if grep -q "$2" "$1"; then echo yes; else echo no; fi; }
req()  { curl -s -o "$BODY" -w '%{http_code}' -m 25 "$@"; }
jqv()  { jq -r "$1" "$BODY" 2>/dev/null; }
rm -f "$JAR"

echo "== connectivity =="
if [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$TESTER/customers")" = "000" ]; then
  skip "the business tester is not running at $TESTER — skipping the live credential check"
  echo; echo "RESULT passed=$PASS failed=$FAIL skipped=$SKIP"
  exit 0
fi
ok "reached $TESTER"

EMAIL="tester.check.${STAMP}@example.test"
PASSWORD='TesterCheck123'
check "sign-up" 200 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -c "$JAR" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Tester Check\"}" "$BASE/api/auth/sign-up/email")"
check "onboard" 201 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"organizationName\":\"Tester Check $STAMP\"}" "$BASE/api/v1/organizations/onboard")"

echo "== the probe recognises a working credential =="
check "probe returns data" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"connector\":{\"baseUrl\":\"$TESTER\",\"auth\":{\"type\":\"bearer\"}},\"credential\":\"$KEY\",\"path\":\"/customers\"}" "$BASE/api/v1/integrations/test")"
check "the URL and key work" "true" "$(jqv '.data.ok')"
check "the probe reports 200" 200 "$(jqv '.data.status')"
check "the body is the provider's envelope" "yes" "$(grep_yes "$BODY" 'full_name')"
check "the body is marked as parsed JSON" "true" "$(jqv '.data.response.json')"
check "the credential is not echoed back" "no" "$(grep_yes "$BODY" "$KEY")"

echo "== a probe without a credential fails closed =="
check "the request is refused" 422 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"connector\":{\"baseUrl\":\"$TESTER\",\"auth\":{\"type\":\"bearer\"}},\"path\":\"/customers\"}" "$BASE/api/v1/integrations/test")"
check "the message says a credential is needed" "yes" "$(grep_yes "$BODY" 'needs a credential')"

echo "== a wrong key shows the provider's own 401 =="
check "the probe returns data, not a thrown error" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"connector\":{\"baseUrl\":\"$TESTER\",\"auth\":{\"type\":\"bearer\"}},\"credential\":\"wrong_key\",\"path\":\"/customers\"}" "$BASE/api/v1/integrations/test")"
check "the probe says it failed" "false" "$(jqv '.data.ok')"
check "the probe reports 401" 401 "$(jqv '.data.status')"
check "the error explains the status" "yes" "$(grep_yes "$BODY" 'credentials')"
check "the provider's message is shown verbatim" "yes" "$(grep_yes "$BODY" 'Missing or invalid API key')"
check "the rejected credential is not echoed back" "no" "$(grep_yes "$BODY" 'wrong_key')"


echo "== the preview maps the store and explains its rejects =="
CONNECTOR='{"provider":"CUSTOM","displayName":"Tester store '"$STAMP"'","status":"PENDING","connector":{"baseUrl":"'"$TESTER"'","auth":{"type":"bearer"},"resources":{"customers":{"path":"/customers","recordsPath":"data","fields":{"externalId":"id","name":"full_name","phone":"msisdn","email":"email","location":"city","customerType":"type"}}}}}'
check "create the connection" 201 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$CONNECTOR" "$BASE/api/v1/integrations")"
IID="$(jqv '.data.id')"
check "store the credential" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"credential\":\"$KEY\"}" "$BASE/api/v1/integrations/$IID/credential")"

check "preview reads the page" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"resource":"customers","limit":5}' "$BASE/api/v1/integrations/$IID/preview")"
check "rows were read" "yes" "$([ "$(jqv '.data.fetched')" -ge 5 ] && echo yes || echo no)"
check "rows were mapped" "yes" "$([ "$(jqv '.data.accepted')" -ge 1 ] && echo yes || echo no)"
# The tester seeds one customer without a phone on purpose: a reorder needs a
# phone, so the row must be rejected *with that reason*, not dropped silently.
check "the phone-less row was rejected with a reason" "yes" "$(jqv '.data.rejections[0].reason' | grep -qi 'phone' && echo yes || echo no)"
check "the rejections are counted" "yes" "$([ "$(jqv '.data.rejections | length')" -ge 1 ] && echo yes || echo no)"
check "the raw page comes with the result" 200 "$(jqv '.data.response.status')"
check "the raw page is the provider's" "yes" "$(grep_yes "$BODY" 'full_name')"
check "the stored credential was used" "yes" "$(grep_yes "$BODY" 'Ruaka')"
check "no credential appears in the response" "no" "$(grep_yes "$BODY" "$KEY")"

echo
echo "RESULT passed=$PASS failed=$FAIL skipped=$SKIP"
[ "$FAIL" -eq 0 ]
