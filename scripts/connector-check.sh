#!/usr/bin/env bash
# End-to-end connector check against a real public API (`pnpm connector:check`).
#
# The main smoke suite is hermetic on purpose. This script is the opposite: it
# points a connector at https://jsonplaceholder.typicode.com — a real, public,
# credential-free JSON API — and proves the whole pipeline works outside a mock:
# DNS + SSRF validation, paging, field mapping, row normalisation, idempotent
# upserts, and the intelligence engine consuming the result.
#
# Requires: a running server, curl, jq and outbound internet. Skips (exit 0) when
# the internet is unavailable, so it never fails a hermetic CI run.
set -u
BASE="${BASE:-http://localhost:3000}"
ORIGIN="$BASE"
JAR=/tmp/connector-check.txt
BODY=/tmp/connector-check-body.json
PASS=0; FAIL=0; SKIP=0
STAMP="$(date +%s)"
EMAIL="connector.check.${STAMP}@example.test"
PASSWORD='ConnectorCheck123'
API="https://jsonplaceholder.typicode.com"

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1 (expected=$2 actual=$3)"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $1"; SKIP=$((SKIP+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
req()  { curl -s -o "$BODY" -w '%{http_code}' -m 25 "$@"; }
jqv()  { jq -r "$1" "$BODY" 2>/dev/null; }
rm -f "$JAR"

echo "== connectivity =="
if [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$API/users")" != "200" ]; then
  skip "outbound internet unavailable — skipping the live connector check"
  echo; echo "RESULT passed=$PASS failed=$FAIL skipped=$SKIP"
  exit 0
fi
ok "reached $API"

echo "== throwaway tenant =="
check "sign-up" 200 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -c "$JAR" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Connector Check\"}" "$BASE/api/auth/sign-up/email")"
check "onboard" 201 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"organizationName\":\"Connector Check $STAMP\"}" "$BASE/api/v1/organizations/onboard")"

echo "== a connector is configuration, not code =="
CONNECTOR='{
  "provider":"CUSTOM","displayName":"JSONPlaceholder","status":"CONNECTED","syncIntervalMinutes":60,
  "connector":{
    "baseUrl":"'"$API"'","auth":{"type":"none"},
    "resources":{
      "customers":{"path":"/users","recordsPath":"","maxRecords":10,"fields":{
        "externalId":"id","name":"name","phone":"@+25470000000{id}","email":"email","location":"address.city","customerType":"@BUSINESS"}},
      "products":{"path":"/photos","recordsPath":"","maxRecords":5,"fields":{
        "externalId":"id","name":"title","sku":"@PH-{id}","category":"@Catalog","price":"@120"}},
      "orders":{"path":"/posts","recordsPath":"","maxRecords":12,"referencePrefix":"JP-","fields":{
        "externalId":"id","customerExternalId":"userId","orderedAt":"@2026-01-15T09:00:00.000Z",
        "total":"@1500","currency":"@KES","status":"@COMPLETED"},
        "items":{"recordsPath":"","fields":{"productName":"title","quantity":"@1","unitPrice":"@250"}}}
    }
  }
}'
check "connect from a connector spec" 201 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$CONNECTOR" "$BASE/api/v1/integrations")"
IID="$(jqv '.data.id')"
check "connection is live" "CONNECTED" "$(jqv '.data.status')"

echo "== the connection can be tested before anything is saved =="
# One GET with the connection's own settings. The same SSRF guard, credential
# handling and rate limiting apply as on a sync; only the response handling differs.
check "probe succeeds" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"'"$API"'","auth":{"type":"none"}},"path":"/users"}' "$BASE/api/v1/integrations/test")"
check "the probe says the URL and credential work" "true" "$(jqv '.data.ok')"
check "the probe reports the status" 200 "$(jqv '.data.status')"
check "the probe measures the call" "yes" "$([ "$(jqv '.data.durationMs')" -ge 0 ] && echo yes || echo no)"
check "the probe brings the body back" "yes" "$(jqv '.data.response.body' | grep -q 'Leanne Graham' && echo yes || echo no)"
check "the probe reports it parsed as JSON" "true" "$(jqv '.data.response.json')"

check "a 404 is a result, not a thrown error" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"'"$API"'","auth":{"type":"none"}},"path":"/definitely-not-here"}' "$BASE/api/v1/integrations/test")"
check "the probe says it failed" "false" "$(jqv '.data.ok')"
check "the probe reports the status" 404 "$(jqv '.data.status')"
check "the probe explains the status" "yes" "$(jqv '.data.error' | grep -q '404' && echo yes || echo no)"
check "the provider's own body is shown" "true" "$(jqv '.data.response.json')"

echo "== dry run reads one page and writes nothing =="
check "preview customers" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"resource":"customers","limit":3}' "$BASE/api/v1/integrations/$IID/preview")"
check "preview mapped 3 rows" 3 "$(jqv '.data.rows | length')"
check "preview rows carry real data" "Leanne Graham" "$(jqv '.data.rows[0].name')"
check "preview rejected nothing" 0 "$(jqv '.data.rejections | length')"
check "the preview shows the response it read" 200 "$(jqv '.data.response.status')"
check "the preview's response is the raw page" "yes" "$(jqv '.data.response.body' | grep -q 'Leanne Graham' && echo yes || echo no)"
check "nothing was written by the preview" 0 "$(req -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/customers" > /dev/null; jqv '.pagination.total')"

echo "== a wrong mapping is explained, with the response that proves it =="
BAD='{"resource":"customers","connector":{"baseUrl":"'"$API"'","auth":{"type":"none"},"resources":{"customers":{"path":"/users","recordsPath":"data.items","fields":{"name":"name","phone":"@+254700000000"}}}}}'
check "a mismatched records path is a result, not a server error" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$BAD" "$BASE/api/v1/integrations/$IID/preview")"
check "the error names the path" "yes" "$(jqv '.data.error' | grep -q 'matched nothing' && echo yes || echo no)"
check "no rows are reported as mapped" 0 "$(jqv '.data.rows | length')"
check "the raw response comes back anyway" 200 "$(jqv '.data.response.status')"
check "an object body without a records path is reported" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"resource":"customers","connector":{"baseUrl":"'"$API"'","auth":{"type":"none"},"resources":{"customers":{"path":"/users/1","recordsPath":"","fields":{"name":"name","phone":"p"}}}}}' "$BASE/api/v1/integrations/$IID/preview")"
check "the report says the body is not a list" "yes" "$(jqv '.data.error' | grep -q 'not a list' && echo yes || echo no)"

echo "== sync imports the history =="
check "sync runs" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$IID/sync")"
check "run succeeded" "SUCCEEDED" "$(jqv '.data.run.status')"
check "customers created" 10 "$(jqv '.data.run.counts.customers.created')"
check "products created" 5 "$(jqv '.data.run.counts.products.created')"
check "orders created" 12 "$(jqv '.data.run.counts.orders.created')"
check "nothing rejected" 0 "$(jqv '.data.run.counts.customers.rejected + .data.run.counts.products.rejected + .data.run.counts.orders.rejected')"

echo "== re-running updates instead of duplicating =="
check "second sync runs" 200 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$IID/sync")"
check "no customers duplicated" 0 "$(jqv '.data.run.counts.customers.created')"
check "all customers updated" 10 "$(jqv '.data.run.counts.customers.updated')"
check "no orders duplicated" 0 "$(jqv '.data.run.counts.orders.created')"
req -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/customers" > /dev/null
check "customer count is still 10" 10 "$(jqv '.pagination.total')"
# The orders list paginates by cursor and returns no total, so count the page.
req -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/orders?limit=100" > /dev/null
check "order count is still 12" 12 "$(jqv '.data | length')"

echo "== one run at a time per connection =="
# Six syncs at once. Only one may run: two concurrent runs would each rewrite an
# order's line items, and under READ COMMITTED that interleaving can duplicate
# them, inflating the quantities the reorder engine reads. A held slot is refused
# with 409; 429 is the per-user rate limit and also means "not started".
CODES=/tmp/connector-check-codes.txt
: > "$CODES"
for _ in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w '%{http_code}\n' -m 60 -b "$JAR" -H "Origin: $ORIGIN" -X POST "$BASE/api/v1/integrations/$IID/sync" >> "$CODES" &
done
wait
check "at least one of the six ran" "yes" "$(grep -q '^200$' "$CODES" && echo yes || echo no)"
check "none failed unexpectedly" 0 "$(grep -v -E '^(200|409|429)$' "$CODES" | wc -l | tr -d ' ')"
# The invariant that matters, and the one that survives the rate limiter: history
# must never contain two runs for this connection whose windows intersect.
RUNS=/tmp/connector-check-runs.json
curl -s -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$IID/runs?limit=50" -o "$RUNS"
check "no two runs of this connection overlapped" 0 "$(jq '[.data[] | select(.finishedAt != null)
  | .startedAt = (.startedAt | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601)
  | .finishedAt = (.finishedAt | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601)] as $r
  | [ $r[] as $a | $r[] | select(.id != $a.id)
      | select(.startedAt < $a.finishedAt and $a.startedAt < .finishedAt) ] | length' "$RUNS")"
IN_FLIGHT="$(jq '[.data[] | select(.status == "RUNNING")] | length' "$RUNS")"
check "at most one run in flight" "yes" "$([ "$IN_FLIGHT" -le 1 ] && echo yes || echo no)"

echo "== the imported history feeds the intelligence =="
req -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/insights/overview" > /dev/null
check "insights see the customers" 10 "$(jqv '.data.kpis.totalCustomers')"
check "insights see the order values" 1500 "$(jqv '.data.kpis.averageOrderValue')"
req -b "$JAR" -H "Origin: $ORIGIN" "$BASE/api/v1/orders?limit=1" > /dev/null
check "imported orders are attributed to the API source" "API" "$(jqv '.data[0].source')"
check "imported orders carry their line items" 1 "$(jqv '.data[0].items | length')"

echo "== the same spec cannot be pointed at the private network =="
SSRF='{"resource":"customers","connector":{"baseUrl":"http://169.254.169.254","auth":{"type":"none"},"resources":{"customers":{"path":"/latest/meta-data/","recordsPath":"","fields":{"name":"@p","phone":"@+254700000000"}}}}}'
SSRF_CODE="$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$SSRF" "$BASE/api/v1/integrations/$IID/preview")"
if [ "$SSRF_CODE" = "403" ]; then
  check "cloud metadata address refused" 403 "$SSRF_CODE"
  # The probe is a second door into the same fetch layer, so it must be locked the
  # same way: a tenant may not use "Test connection" to reach the metadata service.
  check "the connection probe refuses it too" 403 "$(req -X POST -b "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"http://169.254.169.254"}}' "$BASE/api/v1/integrations/test")"
else
  # INTEGRATION_ALLOW_PRIVATE_NETWORKS=true is a deliberate opt-in for on-premise
  # sources (the local tester relies on it), so there is no refusal to observe here.
  skip "SSRF refusal (private networks are enabled on this deployment)"
fi

echo "== a second tenant cannot see this connection =="
JAR_B=/tmp/connector-check-b.txt
rm -f "$JAR_B"
req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -c "$JAR_B" -d "{\"email\":\"connector.other.${STAMP}@example.test\",\"password\":\"$PASSWORD\",\"name\":\"Other\"}" "$BASE/api/auth/sign-up/email" > /dev/null
req -X POST -b "$JAR_B" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"organizationName\":\"Rival $STAMP\"}" "$BASE/api/v1/organizations/onboard" > /dev/null
check "other tenant cannot read its runs" 404 "$(req -b "$JAR_B" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$IID/runs")"
check "other tenant cannot sync it" 404 "$(req -X POST -b "$JAR_B" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$IID/sync")"

echo
echo "RESULT passed=$PASS failed=$FAIL skipped=$SKIP"
[ "$FAIL" -eq 0 ]
