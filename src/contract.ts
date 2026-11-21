/**
 * @file The gateways' response contract, the other half of the wire protocol (both gateways emit exactly
 * this). Every gateway failure is a JSON body `{ "error": <short text> }`, with a machine-readable
 * `code` where a client can react precisely.
 *
 * Role: one list of the statuses a gateway uses and the only two conflict codes, so a client reacts to what it knows and ignores the rest. The Rust gateways
 * emit exactly these (`access-gate-gateway-core`); `tests/contract.test.ts` pins the table.
 */

/** Statuses a gateway uses. */
export const GATEWAY_STATUS = {
  /** No access proof on a gated path. */
  missingProof: 401,
  /** The proof was refused (bad signature, expired nonce, no usable pass, gate paused, no consume). */
  denied: 403,
  /** The method is not forwarded (or not allowed on a public path). */
  methodNotAllowed: 405,
  /** A single-use consume conflicts: see {@link GatewayConflictCode}. */
  conflict: 409,
  /** The request body exceeds the gateway's cap. */
  bodyTooLarge: 413,
  /** Too many requests from this client (the gateway's own limit). */
  rateLimited: 429,
  /** The upstream or the chain lookup failed. */
  badGateway: 502,
  /** The gateway's own state store is unavailable (never reported as a conflict). */
  stateUnavailable: 503,
  /** The upstream did not answer in time. */
  gatewayTimeout: 504,
  /** The request already carries this gateway's `Via` marker: it looped back through the gateway. */
  loopDetected: 508,
} as const

/** `redeemed`: the consume already paid for an upload. `leased`: an upload for it is in progress. */
export const GATEWAY_CONFLICT_CODES = ['redeemed', 'leased'] as const
/** One of the conflict codes (derived from the list, so the two cannot disagree). */
export type GatewayConflictCode = (typeof GATEWAY_CONFLICT_CODES)[number]

/** The error body every gateway failure carries. */
export interface GatewayErrorBody {
  /** A short human-readable reason; not for a program to switch on. */
  error: string
  /** A machine-readable code, present only for a conflict this version knows. */
  code?: GatewayConflictCode
}

/**
 * Parse a gateway error body, or `null` if `body` is not one. Unknown codes are dropped, never
 * trusted, so a client switches only on codes this version knows.
 */
export function parseGatewayError(body: unknown): GatewayErrorBody | null {
  // Anything that is not an object (a string, null, a number) is not an error body.
  if (typeof body !== 'object' || body === null) return null
  // `in` checks keep the reads typed as `unknown`: the body is data from a server.
  const error: unknown = 'error' in body ? body.error : undefined
  const code: unknown = 'code' in body ? body.code : undefined
  // The message must be a string; without it there is nothing to show.
  if (typeof error !== 'string') return null
  // An unknown code is dropped (not forwarded), so a client never switches on a value it was not written for.
  return isConflictCode(code) ? { error, code } : { error }
}

/** True if `code` is one of the conflict codes this version knows (a plain `includes` would not narrow the type). */
function isConflictCode(code: unknown): code is GatewayConflictCode {
  return GATEWAY_CONFLICT_CODES.some((known) => known === code)
}
