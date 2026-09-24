/**
 * Offline checks for the connector fetch guard (`pnpm guard:check`).
 *
 * The preview and the "Test connection" probe are two doors into the same outbound
 * fetch, so both must be refused before a socket is opened when the target is a
 * private, loopback or metadata address. This script runs without a server, a
 * database or the network: the refusal happens during address validation, so a
 * pass here means no packet was sent.
 *
 * It intentionally runs with the *default* environment. A deployment that opts in
 * with `INTEGRATION_ALLOW_PRIVATE_NETWORKS=true` (for an on-premise ERP) relaxes
 * this on purpose, which is why `scripts/connector-check.sh` skips its live SSRF
 * assertion in that case.
 */
import { fetchJson, isBlockedAddress } from '../lib/connectors/fetch'
import { probeConnectorConnection } from '../lib/services/sync'

let failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`✓ ${name}`)
    return
  }
  failures += 1
  console.error(`✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function statusOf(error: unknown): number | null {
  return typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null
}

/* -------------------------------------------------------------------------- */
/* Address classification                                                     */
/* -------------------------------------------------------------------------- */

check('cloud metadata is blocked', isBlockedAddress('169.254.169.254'), true)
check('loopback is blocked', isBlockedAddress('127.0.0.1'), true)
check('private 10/8 is blocked', isBlockedAddress('10.1.2.3'), true)
check('private 192.168/16 is blocked', isBlockedAddress('192.168.0.10'), true)
check('CGNAT is blocked', isBlockedAddress('100.64.0.1'), true)
check('TEST-NET-1 is blocked', isBlockedAddress('192.0.2.1'), true)
check('multicast is blocked', isBlockedAddress('239.0.0.1'), true)
check('IPv6 loopback is blocked', isBlockedAddress('::1'), true)
check('IPv4-mapped loopback is blocked', isBlockedAddress('::ffff:127.0.0.1'), true)
check('a public address is allowed', isBlockedAddress('93.184.216.34'), false)
check('a public IPv6 address is allowed', isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false)

/* -------------------------------------------------------------------------- */
/* The guard runs before the network                                          */
/* -------------------------------------------------------------------------- */

async function main() {
  try {
    await fetchJson('http://169.254.169.254/latest/meta-data/')
    check('the shared fetch refuses the metadata address', 'no error', 403)
  } catch (error) {
    check('the shared fetch refuses the metadata address', statusOf(error), 403)
  }

  try {
    await probeConnectorConnection({
      organizationId: '00000000-0000-4000-8000-000000000000',
      connector: { baseUrl: 'http://169.254.169.254', auth: { type: 'none' }, headers: {}, query: {}, timeoutMs: 10_000 },
    })
    check('the connection probe refuses it too', 'no error', 403)
  } catch (error) {
    check('the connection probe refuses it too', statusOf(error), 403)
  }

  /* ------------------------------------------------------------------------ */
  /* A credential is required when the auth type needs one                    */
  /* ------------------------------------------------------------------------ */

  try {
    await probeConnectorConnection({
      organizationId: '00000000-0000-4000-8000-000000000000',
      connector: { baseUrl: 'https://93.184.216.34', auth: { type: 'bearer' }, headers: {}, query: {}, timeoutMs: 10_000 },
    })
    check('a probe without a credential fails closed', 'no error', 422)
  } catch (error) {
    check('a probe without a credential fails closed', statusOf(error), 422)
  }

  if (failures > 0) {
    console.error(`\n${failures} guard check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll connector guard checks passed.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
