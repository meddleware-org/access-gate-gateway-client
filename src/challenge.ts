/**
 * @file Fetching a challenge from a gateway: the first step of the access protocol.
 *
 * Role: one hardened HTTP call. The caller chooses the gateway; this module makes sure the answer is the gateway's own and a challenge (https only, no
 * redirect, no cache, no ambient credentials, a byte cap, a time limit, a strict shape), and returns nothing it did not check. Main export: `fetchChallenge`.
 * Tested in `tests/challenge.test.ts`; the shape is the gateways' (`access-gate-gateway-core`).
 */
import type { Challenge } from './types.js'
import { gatewayOrigin, isNonce, isRecord } from './proof.js'

/** Default time limit for the challenge request; a hung gateway must not stall the caller. */
const DEFAULT_TIMEOUT_MS = 10_000
/** A challenge is a nonce and an expiry; anything larger is not a challenge. */
const MAX_CHALLENGE_BYTES = 4096

/** `<origin>/v1/challenge` for the gateway at `gatewayHost` (a path prefix is kept). */
function challengeUrl(gatewayHost: string): string {
  // Validates the URL (https, no credentials) and gives its canonical origin.
  const origin = gatewayOrigin(gatewayHost)
  // A gateway may live under a path (`https://host/gate`): keep it, minus any trailing slash.
  const prefix = new URL(gatewayHost).pathname.replace(/\/+$/, '')
  return `${origin}${prefix}/v1/challenge`
}

/** Read at most {@link MAX_CHALLENGE_BYTES} of the body, cancelling the stream past the cap. */
async function readCapped(res: Response): Promise<string> {
  // A declared length over the cap is refused before any body is read.
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_CHALLENGE_BYTES) {
    await res.body?.cancel()
    throw new Error('challenge response too large')
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  // The header can be missing or wrong, so the running total is the real limit.
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
  // Join the chunks and decode once, so a multi-byte character split across chunks is not damaged.
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
  // The time limit always applies; the caller's own signal is added to it, not instead of it.
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  // A nonce must be fresh and anonymous: never answered from a cache, never sent with ambient credentials.
  const res = await fetch(url, { signal, redirect: 'error', cache: 'no-store', credentials: 'omit' })
  // A non-2xx answer is an error; release the stream so the connection is not held.
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`challenge request failed: ${res.status}`)
  }
  const text = await readCapped(res)
  // The body is data from another host: parse, then check each field.
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('challenge response is not JSON')
  }
  const body = isRecord(data) ? data : {}
  // The nonce must have the shape a message can carry (no whitespace: it becomes one line of the signed text).
  const nonce = body.nonce
  if (typeof nonce !== 'string' || !isNonce(nonce)) throw new Error('challenge response missing a valid nonce')
  // The expiry is epoch milliseconds: a positive finite number.
  const expiresAt = body.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('challenge response has an invalid expiry')
  }
  return { nonce, expiresAt }
}
