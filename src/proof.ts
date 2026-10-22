import type { AccessMessageContext, AccessProof, Challenge, SuiNetwork } from './types.js'

/** First line of every signed access message; a signature made for another purpose or version never matches. */
export const ACCESS_MESSAGE_VERSION = 'nft-gate:access:v2'

const NETWORKS: readonly SuiNetwork[] = ['localnet', 'devnet', 'testnet', 'mainnet']
/** Characters a gateway may put in a nonce; no whitespace, so a nonce cannot add a line to the message. */
const NONCE = /^[A-Za-z0-9._~-]{1,128}$/
const GATE_ID = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{1,64}$/
/** Standard base64 with optional padding; a Sui signature is well under 1 KiB. */
const SIGNATURE = /^[A-Za-z0-9+/]{1,1024}={0,2}$/
/**
 * Cheap prefilter for a Sui transaction digest: 32–44 characters of the base58 alphabet (no `0 O I l`).
 * 32 bytes encode to at most 44 characters, and to as few as 32 (each leading zero byte is one `1`).
 * The real rule is the decoded length ({@link isTransactionDigest}).
 */
const TX_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
/** A Sui transaction digest is a 32-byte hash. */
const TX_DIGEST_BYTES = 32
/**
 * How far past `expiresAt` (milliseconds) a challenge is still presented to the wallet. The gateway's
 * clock decides expiry, and this client's may run a little ahead of it, so a challenge that only just
 * expired by the local clock is not refused here. Anything older cannot be accepted and is refused
 * before the wallet prompt.
 */
export const CHALLENGE_CLOCK_SKEW_MS = 30_000
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * The number of bytes the base58 string `s` decodes to (the Bitcoin alphabet; every leading `1` is one
 * zero byte), or -1 if `s` holds a character outside the alphabet. Dependency-free; at most 44 characters
 * are ever decoded here, so the quadratic loop is bounded.
 */
function base58DecodedLength(s: string): number {
  let zeros = 0
  while (zeros < s.length && s.charAt(zeros) === '1') zeros++
  const magnitude: number[] = [] // big-endian, no leading zero byte
  for (let i = zeros; i < s.length; i++) {
    let carry = BASE58_ALPHABET.indexOf(s.charAt(i))
    if (carry < 0) return -1
    for (let j = magnitude.length - 1; j >= 0; j--) {
      carry += (magnitude[j] ?? 0) * 58
      magnitude[j] = carry & 0xff
      carry >>= 8
    }
    for (; carry > 0; carry >>= 8) magnitude.unshift(carry & 0xff)
  }
  return zeros + magnitude.length
}

/**
 * True iff `s` is a Sui transaction digest: base58 (Bitcoin alphabet) that decodes to exactly 32 bytes.
 * A 43-character string can decode to 31 bytes and a 44-character one to 33, so the shape alone is not
 * enough; a leading `1` stands for a zero byte. Mirrored by `is_tx_digest` in `nft-gate-core`.
 */
export function isTransactionDigest(s: string): boolean {
  return TX_DIGEST.test(s) && base58DecodedLength(s) === TX_DIGEST_BYTES
}

/** True iff every character is ASCII (code point ≤ 0x7F). Internal: not re-exported from the index. */
export function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false
  }
  return true
}

/** True iff `x` is a plain JSON object (not null, not an array). Internal: not re-exported from the index. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** True if `s` is a nonce a gateway may issue (see {@link Challenge.nonce}). */
export function isNonce(s: string): boolean {
  return NONCE.test(s)
}

/**
 * The canonical origin of a gateway URL: what is signed and what a gateway configures. `https` only
 * (`http` for a loopback host), no credentials, no path, query or fragment beyond what `URL` drops,
 * default port omitted, host lower-cased.
 *
 * @throws {Error} if `gateway` is not such a URL.
 */
export function gatewayOrigin(gateway: string): string {
  let url: URL
  try {
    url = new URL(gateway)
  } catch {
    // The input is deliberately not echoed: a URL may carry userinfo, and error texts reach logs.
    throw new Error('invalid gateway URL')
  }
  const loopback = LOOPBACK_HOSTS.includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('gateway URL must use https (http is allowed for a loopback host only)')
  }
  if (url.username || url.password) throw new Error('gateway URL must not carry credentials')
  return url.origin
}

function requireContext(ctx: AccessMessageContext): void {
  if (gatewayOriginOrNull(ctx.origin) !== ctx.origin) throw new Error('origin is not a canonical gateway origin')
  if (!GATE_ID.test(ctx.gateId)) throw new Error('gateId must be 0x followed by 64 lower-case hex digits')
  if (!NETWORKS.includes(ctx.network)) throw new Error(`network must be one of ${NETWORKS.join(', ')}`)
  if (!NONCE.test(ctx.nonce)) throw new Error('nonce is not a valid challenge nonce')
  if (ctx.consumeDigest !== undefined && !isTransactionDigest(ctx.consumeDigest)) {
    throw new Error('consumeDigest is not a base58 Sui transaction digest')
  }
}

function gatewayOriginOrNull(s: string): string | null {
  try {
    return gatewayOrigin(s)
  } catch {
    return null
  }
}

/**
 * The exact bytes a wallet signs (as a personal message) to answer a challenge. Both the client
 * (signing) and the gateway (verifying) MUST derive the message identically; the gateway builds it
 * from its own origin, gate and network. ASCII, one `key:value` line each, so a wallet can show it:
 *
 * ```text
 * nft-gate:access:v2
 * origin:<origin>
 * gate:<gate id>
 * network:<network>
 * nonce:<nonce>
 * consume:<digest>        (single-use gateways only)
 * ```
 *
 * @throws {Error} if a field is not in its canonical form (which also prevents line injection).
 */
export function personalMessage(ctx: AccessMessageContext): Uint8Array {
  requireContext(ctx)
  const lines = [ACCESS_MESSAGE_VERSION, `origin:${ctx.origin}`, `gate:${ctx.gateId}`, `network:${ctx.network}`, `nonce:${ctx.nonce}`]
  if (ctx.consumeDigest !== undefined) lines.push(`consume:${ctx.consumeDigest}`)
  return new TextEncoder().encode(lines.join('\n'))
}

// UTF-8-safe base64. The naive `btoa(str)` operates on Latin-1 and throws/corrupts on any code
// point > 0xFF, so we round-trip through UTF-8 bytes first. For pure-ASCII payloads (the only kind
// this wire format carries — see the ASCII contract below) the output is byte-identical to `btoa`.
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * Whitespace the Rust gateway's `str::trim` removes from either end of a token (Unicode `White_Space`).
 * Listed explicitly because `String.prototype.trim` differs (it also strips U+FEFF, not U+0085).
 */
const EDGE_WHITESPACE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+'
const TOKEN_EDGE_WHITESPACE = new RegExp(`^${EDGE_WHITESPACE}|${EDGE_WHITESPACE}$`, 'g')
/** Fatal (a malformed sequence throws instead of becoming U+FFFD) and BOM-preserving (a BOM is not JSON). */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Strict decode, the same decisions as the Rust gateway's `BASE64_STANDARD.decode` plus a fatal UTF-8
 * decode: canonical padded standard base64 only (no unpadded token, no inner whitespace, no URL-safe
 * alphabet, no non-zero trailing bits), then well-formed UTF-8. `atob` alone is lenient on all of these.
 */
function fromBase64(s: string): string {
  let bin: string
  try {
    bin = atob(s)
  } catch {
    throw new Error('access proof token is not base64')
  }
  // `btoa` emits canonical padded base64, so equality rejects everything `atob` forgave.
  if (btoa(bin) !== s) throw new Error('access proof token is not canonical padded base64')
  try {
    return STRICT_UTF8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    throw new Error('access proof token is not valid UTF-8')
  }
}

/** serde_json's default recursion limit: a document nested 128 levels deep (the top-level object counts) is refused. */
const MAX_JSON_DEPTH = 127
const JSON_NUMBER_START = /[-0-9]/
const JSON_NUMBER_CHAR = /[-+.0-9eE]/
const UNICODE_ESCAPE = /^u[0-9a-fA-F]{4}/

/**
 * The Rust decoder refuses three things `JSON.parse` accepts, all inside keys or values this package
 * ignores and some in values a later duplicate key overwrites (so a reviver could not see them):
 * nesting past serde_json's recursion limit, an unpaired surrogate `\uD800` escape, and a number that
 * overflows to infinity (`1e999`). This lexical pass over text that already parsed refuses them too.
 *
 * @throws {Error} if `text` (valid JSON) holds one of the three.
 */
function requireJsonLikeRust(text: string): void {
  let depth = 0
  let inString = false
  let highSurrogate = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      let unit = -1
      if (c === '\\') {
        const escape = UNICODE_ESCAPE.exec(text.slice(i + 1, i + 6))
        if (escape) {
          unit = parseInt(escape[0].slice(1), 16)
          i += 5
        } else i++
      } else if (c === '"') inString = false
      const high = unit >= 0xd800 && unit <= 0xdbff
      const low = unit >= 0xdc00 && unit <= 0xdfff
      // A high surrogate must be followed at once by a low one, and a low one needs a high one before it.
      if ((highSurrogate && !low) || (low && !highSurrogate)) throw new Error('access proof JSON holds an unpaired surrogate escape')
      highSurrogate = high
    } else if (c === '"') inString = true
    else if (c === '{' || c === '[') {
      if (++depth > MAX_JSON_DEPTH) throw new Error('access proof JSON is nested too deeply')
    } else if (c === '}' || c === ']') depth--
    else if (c !== undefined && JSON_NUMBER_START.test(c)) {
      let end = i + 1
      while (end < text.length && JSON_NUMBER_CHAR.test(text[end] ?? '')) end++
      if (!Number.isFinite(Number(text.slice(i, end)))) throw new Error('access proof JSON holds a number out of range')
      i = end - 1
    }
  }
}

function requireAddress(address: string): void {
  if (!ADDRESS.test(address)) throw new Error('address must be 0x followed by 1-64 hex digits')
}

/** Every rule a proof must satisfy, applied identically when encoding and decoding. */
function requireProofShape(p: Record<string, unknown>): AccessProof {
  if (typeof p.address !== 'string' || typeof p.nonce !== 'string' || typeof p.signature !== 'string') {
    throw new Error('malformed access proof')
  }
  if (!isAscii(p.address) || !isAscii(p.nonce) || !isAscii(p.signature)) throw new Error('non-ASCII field in access proof')
  requireAddress(p.address)
  if (!NONCE.test(p.nonce)) throw new Error('nonce is not a valid challenge nonce')
  if (!SIGNATURE.test(p.signature)) throw new Error('signature is not base64')
  const proof: AccessProof = { address: p.address, nonce: p.nonce, signature: p.signature }
  if (p.consumeDigest !== undefined) {
    if (typeof p.consumeDigest !== 'string' || !isTransactionDigest(p.consumeDigest)) {
      throw new Error('consumeDigest is not a base58 Sui transaction digest')
    }
    proof.consumeDigest = p.consumeDigest
  }
  return proof
}

/**
 * Encode a proof as the compact Bearer token carried in the relay auth header.
 *
 * @throws {Error} if a field breaks the same rules {@link decodeAccessProof} enforces, so a token this
 *   emits is one every gateway accepts.
 */
export function encodeAccessProof(proof: AccessProof): string {
  return toBase64(JSON.stringify(requireProofShape({ ...proof })))
}

/** Maximum encoded token length (bytes). Prevents a multi-MB blob from saturating `atob`/`JSON.parse`. */
const MAX_TOKEN_BYTES = 4096

/**
 * Decode a proof token produced by {@link encodeAccessProof}. Throws on malformed input.
 *
 * Both gateways apply the same rules (the shared vectors pin them): at most 4096 characters, a
 * `0x` + 1–64 hex address, a challenge-shaped nonce, a base64 signature, and — when present — a
 * base58 transaction digest. `address` is emitted verbatim; canonicalisation is owned gateway-side.
 *
 * @throws {Error} if the token is oversized, not base64/JSON, or any field breaks those rules.
 */
export function decodeAccessProof(token: string): AccessProof {
  if (token.length > MAX_TOKEN_BYTES) {
    throw new Error(`access proof token too large (${token.length} > ${MAX_TOKEN_BYTES})`)
  }
  const text = fromBase64(token.replace(TOKEN_EDGE_WHITESPACE, ''))
  const raw: unknown = JSON.parse(text)
  requireJsonLikeRust(text)
  if (!isRecord(raw)) throw new Error('malformed access proof')
  return requireProofShape(raw)
}

/** A wallet-provided personal-message signer (e.g. wallet-standard `sui:signPersonalMessage`). */
export type PersonalMessageSigner = (message: Uint8Array) => Promise<{ signature: string }>

/**
 * Sign a challenge and assemble the encoded access-proof token to hand to the gateway as its auth
 * bearer (e.g. an upload-relay client's auth-token option, an `Authorization` header).
 *
 * The signed message binds the gateway's origin, the gate, the network and — for a single-use
 * gateway — the consume digest, so the token is useless anywhere else. Pass `consumeDigest` exactly
 * when the gateway runs single-use (it rebuilds the message the same way).
 *
 * Everything a gateway would refuse is checked BEFORE the wallet is asked to sign, so the user is
 * never prompted for a proof that cannot work: the gateway URL, gate, network, nonce, consume digest,
 * the `address` (`0x` + 1–64 hex digits, as {@link encodeAccessProof} requires) and the challenge's
 * expiry. A challenge counts as expired once `Date.now()` is more than {@link CHALLENGE_CLOCK_SKEW_MS}
 * past `expiresAt`; the gateway's clock stays the authority. Only the signature the wallet returns is
 * checked afterwards.
 *
 * @throws {Error} if an input is not in its canonical form, the challenge has expired, or the wallet
 *   signer rejects or fails.
 */
export async function buildAccessProof(opts: {
  address: string
  challenge: Challenge
  sign: PersonalMessageSigner
  /** The gateway URL the challenge was fetched from (the same string given to `fetchChallenge`). */
  gateway: string
  /** The `Gate` the gateway guards (`0x` + 64 lower-case hex). */
  gateId: string
  network: SuiNetwork
  /** Single-use gateways only: the `consume` transaction digest. */
  consumeDigest?: string
}): Promise<string> {
  requireAddress(opts.address)
  if (!isAscii(opts.address)) throw new Error('non-ASCII field in access proof')
  if (!Number.isFinite(opts.challenge.expiresAt) || opts.challenge.expiresAt <= 0) {
    throw new Error('challenge has an invalid expiry')
  }
  if (Date.now() > opts.challenge.expiresAt + CHALLENGE_CLOCK_SKEW_MS) throw new Error('challenge has expired')
  const message = personalMessage({
    origin: gatewayOrigin(opts.gateway),
    gateId: opts.gateId,
    network: opts.network,
    nonce: opts.challenge.nonce,
    consumeDigest: opts.consumeDigest,
  })
  const { signature } = await opts.sign(message)
  const proof: AccessProof = { address: opts.address, nonce: opts.challenge.nonce, signature }
  if (opts.consumeDigest !== undefined) proof.consumeDigest = opts.consumeDigest
  return encodeAccessProof(proof)
}
