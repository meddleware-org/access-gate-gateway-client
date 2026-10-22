import type { Challenge } from './types.js'
import { gatewayOrigin, isNonce, isRecord } from './proof.js'

/** Default time limit for the challenge request; a hung gateway must not stall the caller. */
const DEFAULT_TIMEOUT_MS = 10_000
/** A challenge is a nonce and an expiry; anything larger is not a challenge. */
const MAX_CHALLENGE_BYTES = 4096

/** `<origin>/v1/challenge` for the gateway at `gatewayHost` (a path prefix is kept). */
function challengeUrl(gatewayHost: string): string {
  const origin = gatewayOrigin(gatewayHost)
  const prefix = new URL(gatewayHost).pathname.replace(/\/+$/, '')
  return `${origin}${prefix}/v1/challenge`
}

/** Read at most {@link MAX_CHALLENGE_BYTES} of the body, cancelling the stream past the cap. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_CHALLENGE_BYTES) {
    await res.body?.cancel()
    throw new Error('challenge response too large')
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_CHALLENGE_BYTES) {
      await reader.cancel()
      throw new Error('challenge response too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Fetch a fresh challenge from a gateway's `GET /v1/challenge` endpoint.
 *
 * The request is aborted after `timeoutMs` (default 10 s) or when `signal` aborts, whichever comes
 * first. Redirects are refused (a gateway that redirects is not the gateway the caller chose), the
 * response is never taken from or stored in an HTTP cache (`cache: 'no-store'`), no cookies or other
 * ambient credentials are sent (`credentials: 'omit'`), and the body is cut off at 4 KiB while it is
 * being read.
 *
 * @throws {Error} if the host is not an https URL (http is allowed for loopback hosts only).
 * @throws {Error} if the request fails, times out, is redirected, or the gateway returns a non-2xx status.
 * @throws {Error} if the response is oversized, not JSON, or lacks a valid `nonce` or a positive
 *   numeric `expiresAt`.
 */
export async function fetchChallenge(
  gatewayHost: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Challenge> {
  const url = challengeUrl(gatewayHost)
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  // A nonce must be fresh and anonymous: never answered from a cache, never sent with ambient credentials.
  const res = await fetch(url, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' })
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`challenge request failed: ${res.status}`)
  }
  const text = await readCapped(res)
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('challenge response is not JSON')
  }
  const body = isRecord(data) ? data : {}
  const nonce = body.nonce
  if (typeof nonce !== 'string' || !isNonce(nonce)) throw new Error('challenge response missing a valid nonce')
  const expiresAt = body.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('challenge response has an invalid expiry')
  }
  return { nonce, expiresAt }
}
