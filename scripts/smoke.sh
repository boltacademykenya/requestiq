#!/usr/bin/env bash
# End-to-end smoke test for the ReorderIQ backend (creates a throwaway tenant).
set -u
BASE="${BASE:-http://localhost:3000}"
ORIGIN="$BASE"
JAR_A=/tmp/smoke-a.txt
JAR_B=/tmp/smoke-b.txt
BODY=/tmp/smoke-body.json
PASS=0; FAIL=0
STAMP="$(date +%s)"
EMAIL_A="smoke.a.${STAMP}@example.test"
EMAIL_B="smoke.b.${STAMP}@example.test"
PASSWORD='SmokeTest12345'
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1 (expected=$2 actual=$3)"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
req() { curl -s -o "$BODY" -w '%{http_code}' -m 25 "$@"; }
jqv() { jq -r "$1" "$BODY" 2>/dev/null; }
rm -f "$JAR_A" "$JAR_B"

echo "== public endpoints =="
check "GET /api/v1/health" 200 "$(req "$BASE/api/v1/health")"

echo "== contact form =="
CONTACT_JSON='{"name":"Smoke Tester","business":"Smoke Ltd","email":"lead.'"$STAMP"'@example.test","phone":"+254700000000","topic":"Pricing","message":"We would like to understand pricing for 200 customers and weekly reorders."}'
check "POST /api/contact" 201 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$CONTACT_JSON" "$BASE/api/contact")"
check "POST /api/contact duplicate suppressed" 201 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$CONTACT_JSON" "$BASE/api/contact")"
# Captured so the platform-surface checks below can try to mutate a real row.
LEAD_ID="$(jqv '.data.id')"
HONEY="${CONTACT_JSON%\}},\"website\":\"http://spam.example\"}"
check "honeypot rejected" 422 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$HONEY" "$BASE/api/contact")"
check "cross-site origin blocked" 403 "$(req -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d "$CONTACT_JSON" "$BASE/api/contact")"
check "GET on POST-only route" 405 "$(req "$BASE/api/contact")"

echo "== auth surface =="
check "unauthenticated customers list" 401 "$(req "$BASE/api/v1/customers")"
check "sign-up owner" 200 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -c "$JAR_A" -d "{\"email\":\"$EMAIL_A\",\"password\":\"$PASSWORD\",\"name\":\"Smoke A\"}" "$BASE/api/auth/sign-up/email")"
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/session" > /dev/null
check "session before onboarding has no org" "null" "$(jqv '.data.organization')"
req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"organizationName\":\"Smoke Test Co $STAMP\"}" "$BASE/api/v1/organizations/onboard" > /dev/null
check "onboard creates tenant" "true" "$(jqv '.data.created')"
req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"organizationName\":\"Smoke Test Co $STAMP\"}" "$BASE/api/v1/organizations/onboard" > /dev/null
check "onboard is idempotent" "false" "$(jqv '.data.created')"
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/session" > /dev/null
ORG_ID="$(jqv '.data.organization.id')"
check "session exposes owner role" "OWNER" "$(jqv '.data.role')"

echo "== tenant writes (owner) =="
check "create product" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Smoke Unga","price":320,"category":"Staples","sku":"SMK-1"}' "$BASE/api/v1/products")"
PRODUCT_ID="$(jqv '.data.id')"
check "create second product" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Smoke Kunde","price":450}' "$BASE/api/v1/products")"
check "duplicate product name conflicts" 409 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Smoke Unga","price":999}' "$BASE/api/v1/products")"
check "invalid phone rejected" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Bad Customer","phone":"not-a-phone"}' "$BASE/api/v1/customers")"
check "unknown field rejected" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Bad Customer","phone":"+254700111222","role":"OWNER"}' "$BASE/api/v1/customers")"
check "create customer" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Smoke Customer","phone":"+254700111222","email":"customer@example.test","location":"Kilimani"}' "$BASE/api/v1/customers")"
CUSTOMER_ID="$(jqv '.data.id')"
check "create order (server priced)" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUSTOMER_ID\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"productName\":\"Smoke Unga\",\"quantity\":3,\"unitPrice\":1}]}" "$BASE/api/v1/orders")"
check "order total ignores client price" 960 "$(jqv '.data.total')"
check "create second order" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"customerId\":\"$CUSTOMER_ID\",\"items\":[{\"productName\":\"Smoke Kunde\",\"quantity\":2}]}" "$BASE/api/v1/orders")"
check "customer insight computed" 200 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/customers/$CUSTOMER_ID")"
check "overview returns kpis" 1 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/insights/overview" > /dev/null; jqv '.data.kpis.totalCustomers')"
check "recompute opportunities" 200 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/opportunities/recompute")"
check "list opportunities" 200 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/opportunities")"

echo "== campaigns, billing, integrations =="
check "create campaign" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"name":"Smoke reminder","channel":"WHATSAPP","audienceFilter":{"minReorderScore":0}}' "$BASE/api/v1/campaigns")"
CAMPAIGN_ID="$(jqv '.data.id')"
check "dispatch campaign" 200 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"limit":10}' "$BASE/api/v1/campaigns/$CAMPAIGN_ID/dispatch")"
check "messages queued" 1 "$(jqv '.data.queued')"
check "read messages" 200 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/messages")"
check "connect integration" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"provider":"ZOHO_INVENTORY","displayName":"Zoho demo","status":"CONNECTED"}' "$BASE/api/v1/integrations")"
INTEGRATION_ID="$(jqv '.data.id')"
check "credential-like config rejected" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"provider":"SHOPIFY","config":{"api_key":"sk_live_123"}}' "$BASE/api/v1/integrations")"

echo "== data connectors (mapping validation, SSRF guard, scheduler) =="
check "provider templates listed" "yes" "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/presets" > /dev/null; [ "$(jqv '.data | length')" -ge 5 ] && echo yes || echo no)"
check "connector without a required field rejected" 422 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"https://api.example.test","resources":{"customers":{"path":"/customers","fields":{"externalId":"id","name":"name"}}}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "connector with an unknown field rejected" 422 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"https://api.example.test","resources":{"customers":{"path":"/customers","fields":{"name":"n","phone":"p","favouriteColour":"x"}}}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "connector with no resources rejected" 422 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"https://api.example.test","resources":{}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "connector cannot hold a credential header" 422 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"https://api.example.test","headers":{"X-Api-Key":"sk_live_123"},"resources":{"customers":{"path":"/c","fields":{"name":"n","phone":"p"}}}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "valid connector saved" 200 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"connector":{"baseUrl":"https://api.example.test","auth":{"type":"bearer"},"resources":{"customers":{"path":"/customers","recordsPath":"data","fields":{"externalId":"id","name":"name","phone":"phone"}}}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "sync refused without a credential" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$INTEGRATION_ID/sync")"
check "preview of a disabled resource rejected" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"resource":"orders"}' "$BASE/api/v1/integrations/$INTEGRATION_ID/preview")"
check "credential must be a value or null" 422 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"credential":""}' "$BASE/api/v1/integrations/$INTEGRATION_ID/credential")"
check "sync run history" 200 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/integrations/$INTEGRATION_ID/runs")"
# The guard runs before any connection is made, so this needs no network access.
if [ "${INTEGRATION_ALLOW_PRIVATE_NETWORKS:-false}" = "true" ]; then
  echo "  SKIP  private-address guard (INTEGRATION_ALLOW_PRIVATE_NETWORKS=true on this server)"
else
  check "preview refuses a private address (SSRF)" 403 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"resource":"customers","connector":{"baseUrl":"http://169.254.169.254","auth":{"type":"none"},"resources":{"customers":{"path":"/latest/meta-data/","recordsPath":"","fields":{"name":"@probe","phone":"@+254700000000"}}}}}' "$BASE/api/v1/integrations/$INTEGRATION_ID/preview")"
fi
# Which refusal appears depends on whether the *server* has SYNC_CRON_SECRET set —
# 401 when a secret is configured and missing/wrong, 403 when the endpoint is
# disabled entirely. This script cannot read the server's environment, so it
# asserts the property that holds either way: an unauthenticated caller is
# refused, and no caller without the secret is ever let in.
no_secret="$(req -X POST -H 'Content-Type: application/json' -d '{"limit":1}' "$BASE/api/v1/integrations/sync-due")"
if [ "$no_secret" = "401" ] || [ "$no_secret" = "403" ]; then
  ok "scheduled sync refused without a secret ($no_secret)"
else
  bad "scheduled sync refused without a secret" "401 or 403" "$no_secret"
fi
wrong_secret="$(req -X POST -H 'Content-Type: application/json' -H 'x-cron-secret: not-the-secret' -d '{"limit":1}' "$BASE/api/v1/integrations/sync-due")"
if [ "$wrong_secret" = "401" ] || [ "$wrong_secret" = "403" ]; then
  ok "scheduled sync refuses a wrong secret ($wrong_secret)"
else
  bad "scheduled sync refuses a wrong secret" "401 or 403" "$wrong_secret"
fi
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/billing/subscription" > /dev/null
check "subscription created on demand" "TRIALING" "$(jqv '.data.status')"
req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"plan":"LARGE","seats":10}' "$BASE/api/v1/billing/subscription" > /dev/null
check "plan upgrade repricing" 20000 "$(jqv '.data.amount')"
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/team" > /dev/null
check "team list" 1 "$(jqv '.data | length')"
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/audit" > /dev/null
AUDIT_ROWS="$(jqv '.data | length')"
check "audit trail recorded" "yes" "$([ "$AUDIT_ROWS" -gt 0 ] && echo yes || echo no)"
check "update organization" 200 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"industry":"Retail"}' "$BASE/api/v1/organization")"
echo "== platform surface is staff-only (tenant isolation) =="
check "tenant owner cannot list platform leads" 403 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/platform/leads")"
check "tenant owner cannot mutate a real lead" 403 "$(req -X PATCH -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"status":"SPAM"}' "$BASE/api/v1/platform/leads/$LEAD_ID")"
check "anonymous cannot list platform leads" 401 "$(req -H "Origin: $ORIGIN" "$BASE/api/v1/platform/leads")"
check "tenant leads route no longer exists" 404 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/leads")"
check "soft delete product" 204 "$(req -X DELETE -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/products/$PRODUCT_ID")"

echo "== tenant isolation =="
RANDOM_UUID="$(cat /proc/sys/kernel/random/uuid)"
check "unknown customer id is not found" 404 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/customers/$RANDOM_UUID")"
check "unknown order id is not found" 404 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/orders/$RANDOM_UUID")"

echo "== role based access =="
check "sign-up analyst" 200 "$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -c "$JAR_B" -d "{\"email\":\"$EMAIL_B\",\"password\":\"$PASSWORD\",\"name\":\"Smoke B\"}" "$BASE/api/auth/sign-up/email")"
check "add analyst member" 201 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_B\",\"role\":\"ANALYST\"}" "$BASE/api/v1/team")"
check "analyst can read customers" 200 "$(req -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" "$BASE/api/v1/customers")"
check "analyst cannot create products" 403 "$(req -X POST -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" -H 'Content-Type: application/json' -d '{"name":"Analyst Product","price":10}' "$BASE/api/v1/products")"
check "analyst cannot manage billing" 403 "$(req -X PATCH -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" -H 'Content-Type: application/json' -d '{"plan":"SMALL"}' "$BASE/api/v1/billing/subscription")"
check "analyst can read integrations" 200 "$(req -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" "$BASE/api/v1/integrations")"
check "analyst cannot configure a connector" 403 "$(req -X PATCH -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" -H 'Content-Type: application/json' -d '{"status":"DISCONNECTED"}' "$BASE/api/v1/integrations/$INTEGRATION_ID")"
check "analyst cannot run a sync" 403 "$(req -X POST -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" "$BASE/api/v1/integrations/$INTEGRATION_ID/sync")"
check "analyst cannot store a credential" 403 "$(req -X POST -b "$JAR_B" -H "Origin: $ORIGIN" -H "x-organization-id: $ORG_ID" -H 'Content-Type: application/json' -d '{"credential":"x"}' "$BASE/api/v1/integrations/$INTEGRATION_ID/credential")"
check "untrusted origin on write" 403 "$(req -X POST -b "$JAR_A" -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"organizationName":"Evil"}' "$BASE/api/v1/organizations/onboard")"
check "missing content-type rejected" 415 "$(req -X POST -b "$JAR_A" -H "Origin: $ORIGIN" -d 'plain text' "$BASE/api/v1/customers")"

echo "== rate limiting =="
RL=0
for i in 1 2 3 4 5 6; do
  CODE="$(req -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "{\"name\":\"Rate $i\",\"business\":\"Rate Ltd\",\"email\":\"rate.$i.$STAMP@example.test\",\"topic\":\"Other\",\"message\":\"Rate limit probe number $i with enough characters.\"}" "$BASE/api/contact")"
  [ "$CODE" = "429" ] && RL=1
done
check "contact endpoint rate limits" 1 "$RL"

echo "== sign-out (last: it revokes the session every check above used) =="
check "signed in before sign-out" 200 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/customers")"
check "sign-out revokes the session" 200 "$(req -X POST -b "$JAR_A" -c "$JAR_A" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/sign-out")"
# curl drops a cookie whose Set-Cookie carries Max-Age=0, which is exactly what a
# browser does — so this asserts the browser is left with nothing to present.
check "sign-out expires the session cookies" "0" "$(grep -c 'better-auth' "$JAR_A" || true)"
req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/session" > /dev/null
check "no user after sign-out" "null" "$(jqv '.data.user')"
check "tenant reads rejected after sign-out" 401 "$(req -b "$JAR_A" -H "Origin: $ORIGIN" "$BASE/api/v1/customers")"

echo
echo "RESULT passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
