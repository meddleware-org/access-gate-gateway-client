// Generates vectors.json: the conformance vectors both nft-gate gateways test against. This
// package is the protocol's home, so the vectors live here and are published as
// `@meddleware/nft-gate-client/vectors.json`; the gateway repository vendors a copy that CI checks
// against the installed package.
//
//   node scripts/gen-vectors.mjs > vectors.json
//
// The message is assembled inline (not imported from src/) so tests can compare the library's
// output with an independent construction. Signatures are REAL Sui personal-message signatures.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1'
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1'
import { toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { p256 } from '@noble/curves/nist.js'

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))
const utf8Token = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')

// ── the signed message ───────────────────────────────────────────────────────────────────────
const VERSION = 'nft-gate:access:v2'
const message = (c) =>
  new TextEncoder().encode(
    [VERSION, `origin:${c.origin}`, `gate:${c.gateId}`, `network:${c.network}`, `nonce:${c.nonce}`, ...(c.consumeDigest ? [`consume:${c.consumeDigest}`] : [])].join('\n'),
  )
const DIGEST = '5Wq9tE4gXz8hEvFhYt8KkTJb2Pp6qXqj8cRk3xN1mYdL'
const OWNERSHIP = {
  origin: 'https://gateway.example',
  gateId: '0x' + 'a1'.repeat(32),
  network: 'testnet',
  nonce: 'GOLDEN-NONCE-123',
}
const SINGLE_USE = { ...OWNERSHIP, consumeDigest: DIGEST }
const NONCE = OWNERSHIP.nonce

// ── transaction digests ──────────────────────────────────────────────────────────────────────
// A Sui transaction digest is base58 (Bitcoin alphabet) that decodes to exactly 32 bytes. The shape alone
// (32-44 characters of the alphabet) is not enough: 43 characters can be 31 bytes and 44 can be 33, and a
// leading `1` is a zero byte. Valid digests are built from bytes with the SDK's encoder, so the generator
// does not share code with `src/`.
const bytesOf = (len, fill = 0xff, head = []) => Uint8Array.from([...head, ...new Uint8Array(len - head.length).fill(fill)])
const flip = (d, at, ch) => d.slice(0, at) + ch + d.slice(at + 1)
const txDigestValid = [
  ['golden digest (44 characters)', DIGEST],
  ['32 zero bytes: 32 leading 1s, the shortest valid digest', toBase58(new Uint8Array(32))],
  ['one leading zero byte, then 31 bytes of 0xff (44 characters)', toBase58(bytesOf(32, 0xff, [0]))],
  ['smallest value without a leading zero byte (0x01, then zeros)', toBase58(bytesOf(32, 0, [1]))],
  ['all 0xff (44 characters)', toBase58(bytesOf(32, 0xff))],
  ['43 characters that decode to 32 bytes (all z)', 'z'.repeat(43)],
].map(([name, digest]) => ({ name, digest }))
const txDigestInvalid = [
  ['empty', ''],
  ['31 characters (31 zero bytes)', '1'.repeat(31)],
  ['33 zero bytes', '1'.repeat(33)],
  ['45 characters', 'z'.repeat(45)],
  ['43 characters that decode to 31 bytes', toBase58(bytesOf(31, 0xff))],
  ['44 characters that decode to 33 bytes (all z)', 'z'.repeat(44)],
  ['32 characters that decode to 24 bytes', '2'.repeat(32)],
  ['a leading 1 adds a zero byte: 1 + 43 z decode to 33 bytes', '1' + 'z'.repeat(43)],
  ['golden digest with a 0 (not in the alphabet)', flip(DIGEST, 5, '0')],
  ['golden digest with an O (not in the alphabet)', flip(DIGEST, 5, 'O')],
  ['golden digest with an I (not in the alphabet)', flip(DIGEST, 5, 'I')],
  ['golden digest with an l (not in the alphabet)', flip(DIGEST, 5, 'l')],
  ['golden digest with a non-base58 symbol', flip(DIGEST, 5, '+')],
  ['golden digest with a non-ASCII letter', flip(DIGEST, 5, 'é')],
  ['hex-looking 64 characters', 'a'.repeat(64)],
].map(([name, digest]) => ({ name, digest }))

const messageCase = (name, context) => ({
  name,
  context,
  messageUtf8: new TextDecoder().decode(message(context)),
  messageBytesBase64: b64(message(context)),
})

const personalMessageRejects = [
  ['non-canonical origin: http on a non-loopback host', { ...OWNERSHIP, origin: 'http://gateway.example' }],
  ['non-canonical origin: upper-case host', { ...OWNERSHIP, origin: 'https://Gateway.example' }],
  ['non-canonical origin: trailing slash', { ...OWNERSHIP, origin: 'https://gateway.example/' }],
  ['non-canonical origin: default port', { ...OWNERSHIP, origin: 'https://gateway.example:443' }],
  ['non-canonical origin: credentials', { ...OWNERSHIP, origin: 'https://user@gateway.example' }],
  ['gate id: upper-case hex', { ...OWNERSHIP, gateId: '0x' + 'A1'.repeat(32) }],
  ['gate id: short', { ...OWNERSHIP, gateId: '0x1' }],
  ['network: unknown', { ...OWNERSHIP, network: 'testnet2' }],
  ['nonce: contains a newline (line injection)', { ...OWNERSHIP, nonce: 'n\nconsume:abc' }],
  ['nonce: contains a space', { ...OWNERSHIP, nonce: 'a b' }],
  ['nonce: empty', { ...OWNERSHIP, nonce: '' }],
  ['nonce: 129 characters', { ...OWNERSHIP, nonce: 'a'.repeat(129) }],
  ['consume digest: not base58', { ...OWNERSHIP, consumeDigest: 'DIGEST-1' }],
  ['consume digest: 43 characters that decode to 31 bytes', { ...OWNERSHIP, consumeDigest: toBase58(bytesOf(31, 0xff)) }],
  ['consume digest: 44 characters that decode to 33 bytes', { ...OWNERSHIP, consumeDigest: 'z'.repeat(44) }],
].map(([name, context]) => ({ name, context }))

// ── proof tokens ─────────────────────────────────────────────────────────────────────────────
const token = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
// Raw-token helpers for the base64 / UTF-8 / JSON layer vectors below. A canonical `proof` JSON, extended
// with one unknown key where a vector needs a length that leaves base64 padding.
const PROOF_JSON = JSON.stringify({ address: '0x1', nonce: 'n', signature: 'AAAA' })
const withUnknownKey = (valueJson) => `${PROOF_JSON.slice(0, -1)},"k":${valueJson}}`
const rawToken = (bytes) => Buffer.from(bytes).toString('base64')
const stripPadding = (t) => (t.endsWith('=') ? t.replace(/=+$/, '') : fail('vector needs padded base64'))
const insertAt = (t, at, ch) => t.slice(0, at) + ch + t.slice(at)
const urlSafe = (t) => (/[+/]/.test(t) ? t.replace(/\+/g, '-').replace(/\//g, '_') : fail('vector needs + or / in the base64'))
function withTrailingBits(t) {
  // Set the lowest bit of the last data symbol: decodes to the same bytes in a lenient decoder, but the
  // symbol is not the canonical encoding of them.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const body = t.replace(/=+$/, '')
  if (body.length === t.length) fail('vector needs padded base64')
  const last = ALPHABET.indexOf(body.at(-1))
  if (last & 1) fail('last symbol already has its low bit set')
  return body.slice(0, -1) + ALPHABET[last | 1] + t.slice(body.length)
}
function fail(why) {
  throw new Error(why)
}
const proofDecodeRejects = [
  ['oversized', 'A'.repeat(4097)],
  ['non-ASCII nonce', utf8Token({ address: '0x1', nonce: 'nönce', signature: 'AAAA' })],
  ['non-ASCII address', utf8Token({ address: '0xé1', nonce: 'n', signature: 'AAAA' })],
  ['empty address', token({ address: '', nonce: 'n', signature: 'AAAA' })],
  ['address without 0x', token({ address: '1234', nonce: 'n', signature: 'AAAA' })],
  ['address not hex', token({ address: '0xzz', nonce: 'n', signature: 'AAAA' })],
  ['address longer than 64 hex digits', token({ address: '0x' + '1'.repeat(65), nonce: 'n', signature: 'AAAA' })],
  ['empty nonce', token({ address: '0x1', nonce: '', signature: 'AAAA' })],
  ['nonce with a space', token({ address: '0x1', nonce: 'a b', signature: 'AAAA' })],
  ['empty signature', token({ address: '0x1', nonce: 'n', signature: '' })],
  ['signature not base64', token({ address: '0x1', nonce: 'n', signature: '***' })],
  ['consume digest not base58', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: 'DIGEST-1' })],
  ['consume digest empty', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: '' })],
  ['consume digest not a string', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: 7 })],
  ['consume digest decodes to 31 bytes (43 characters)', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: toBase58(bytesOf(31, 0xff)) })],
  ['consume digest decodes to 33 bytes (44 characters)', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: 'z'.repeat(44) })],
  ['consume digest with a leading 1 that makes it 33 bytes', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: '1' + 'z'.repeat(43) })],
  ['consume digest with a 0 (not in the base58 alphabet)', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: flip(DIGEST, 5, '0') })],
  ['consume digest with an l (not in the base58 alphabet)', token({ address: '0x1', nonce: 'n', signature: 'AAAA', consumeDigest: flip(DIGEST, 5, 'l') })],
  ['JSON array', token(['0x1'])],
  ['JSON null', token(null)],
  // The base64 / UTF-8 / JSON layers underneath the field grammar. The Rust gateway refuses each of these
  // (canonical padded standard base64, `trim()` at the ends only, strict UTF-8, serde_json's parser), so
  // every decoder must; each one carries an otherwise valid proof, so only that layer can be the reason.
  ['unpadded base64', stripPadding(rawToken(withUnknownKey('"a"')))],
  ['whitespace inside the token', insertAt(rawToken(PROOF_JSON), 8, '\n')],
  ['padding in the middle of the token', insertAt(rawToken(PROOF_JSON), 8, '=')],
  ['more padding than base64 allows', rawToken(withUnknownKey('"a"')) + '='],
  ['non-zero trailing bits in the last base64 symbol', withTrailingBits(rawToken(withUnknownKey('"a"')))],
  ['URL-safe base64 alphabet', urlSafe(rawToken(withUnknownKey('"~~~???>>>"')))],
  ['invalid UTF-8 inside an unknown key', rawToken(Buffer.concat([Buffer.from('{"address":"0x1","nonce":"n","signature":"AAAA","'), Buffer.from([0xff, 0xfe]), Buffer.from('":1}')]))],
  ['UTF-8 byte-order mark before the JSON', rawToken(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(PROOF_JSON)]))],
  ['unpaired surrogate escape in an unknown key', rawToken(`${PROOF_JSON.slice(0, -1)},"\\ud800":1}`)],
  ['number out of range in an unknown value', rawToken(withUnknownKey('1e999'))],
  ['JSON nested 128 levels deep', rawToken(withUnknownKey(`${'['.repeat(127)}${']'.repeat(127)}`))],
].map(([name, tok]) => ({ name, token: tok }))

// ── signatures ───────────────────────────────────────────────────────────────────────────────
const edKp = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
const k1Kp = Secp256k1Keypair.fromSecretKey(new Uint8Array(32).fill(9))
const r1Kp = Secp256r1Keypair.fromSecretKey(new Uint8Array(32).fill(11))

async function vec(scheme, kp, context) {
  const address = kp.toSuiAddress()
  const { signature } = await kp.signPersonalMessage(message(context))
  const proof = { address, nonce: context.nonce, signature, ...(context.consumeDigest ? { consumeDigest: context.consumeDigest } : {}) }
  return { scheme, address, context, signature, proofToken: token(proof), expect: true }
}

const edSig = (await edKp.signPersonalMessage(message(OWNERSHIP))).signature
const edSigSingle = (await edKp.signPersonalMessage(message(SINGLE_USE))).signature
const k1Sig = (await k1Kp.signPersonalMessage(message(OWNERSHIP))).signature
const r1Sig = (await r1Kp.signPersonalMessage(message(OWNERSHIP))).signature

// A valid signature presented against a message rebuilt from a different audience must fail.
const mismatch = (name, address, signature, context) => ({ case: name, address, signature, context, expect: false })
const audienceMismatch = [
  mismatch('wrong origin', edKp.toSuiAddress(), edSig, { ...OWNERSHIP, origin: 'https://other.example' }),
  mismatch('wrong gate', edKp.toSuiAddress(), edSig, { ...OWNERSHIP, gateId: '0x' + 'b2'.repeat(32) }),
  mismatch('wrong network', edKp.toSuiAddress(), edSig, { ...OWNERSHIP, network: 'mainnet' }),
  mismatch('wrong nonce', edKp.toSuiAddress(), edSig, { ...OWNERSHIP, nonce: 'GOLDEN-NONCE-124' }),
  mismatch('gateway is single-use but the signature has no consume line', edKp.toSuiAddress(), edSig, SINGLE_USE),
  mismatch('gateway is not single-use but the signature has a consume line', edKp.toSuiAddress(), edSigSingle, OWNERSHIP),
  mismatch('single-use: wrong consume digest', edKp.toSuiAddress(), edSigSingle, { ...SINGLE_USE, consumeDigest: '9' + DIGEST.slice(1) }),
  mismatch('v1 message (no audience) is refused', edKp.toSuiAddress(), (await edKp.signPersonalMessage(new TextEncoder().encode(`nft-gate:access:${NONCE}`))).signature, OWNERSHIP),
]

// ── negative + ZIP-215 vectors (over the ownership message) ──────────────────────────────────
const suiAddress = (flag, pk) => '0x' + Buffer.from(blake2b(Uint8Array.from([flag, ...pk]), { dkLen: 32 })).toString('hex')
const bigToBytes32 = (n) => Uint8Array.from(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'))
const bytesToBig = (b) => BigInt('0x' + Buffer.from(b).toString('hex'))
function highS(sigB64, order) {
  const raw = fromB64(sigB64)
  raw.set(bigToBytes32(order - bytesToBig(raw.subarray(33, 65))), 33)
  return b64(raw)
}
function ed25519NonCanonicalS(sigB64) {
  const raw = fromB64(sigB64)
  const L = 2n ** 252n + 27742317777372353535851937790883648493n
  const s = bytesToBig(Uint8Array.from(raw.subarray(33, 65)).reverse()) + L
  raw.set(bigToBytes32(s).reverse(), 33)
  return b64(raw)
}
const withFlag = (sigB64, flag) => { const raw = fromB64(sigB64); raw[0] = flag; return b64(raw) }
async function wrongIntent(kp) {
  const m = message(OWNERSHIP)
  // Intent scope 0 (TransactionData) instead of 3 (PersonalMessage), over the same BCS-wrapped bytes.
  const digest = blake2b(Uint8Array.from([0, 0, 0, ...uleb(m.length), ...m]), { dkLen: 32 })
  const sig = await kp.sign(digest)
  return b64(Uint8Array.from([0x00, ...sig, ...kp.getPublicKey().toRawBytes()]))
}
function uleb(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n); return out }

const negative = (name, address, signature) => ({ case: name, address, context: OWNERSHIP, signature, expect: false })
const negativeSignatures = [
  negative('secp256k1 high-S', k1Kp.toSuiAddress(), highS(k1Sig, secp256k1.Point.CURVE().n)),
  negative('secp256r1 high-S', r1Kp.toSuiAddress(), highS(r1Sig, p256.Point.CURVE().n)),
  negative('ed25519 non-canonical s (s + L)', edKp.toSuiAddress(), ed25519NonCanonicalS(edSig)),
  negative('ed25519 wrong intent (TransactionData)', edKp.toSuiAddress(), await wrongIntent(edKp)),
  negative('ed25519 truncated', edKp.toSuiAddress(), b64(fromB64(edSig).subarray(0, 96))),
  negative('flag 0x03 multisig (fails closed)', edKp.toSuiAddress(), withFlag(edSig, 0x03)),
  negative('flag 0x05 zkLogin (fails closed)', edKp.toSuiAddress(), withFlag(edSig, 0x05)),
  negative('flag 0x06 passkey (fails closed)', edKp.toSuiAddress(), withFlag(edSig, 0x06)),
]

const identity = new Uint8Array(32)
identity[0] = 1
const zip215 = {
  description:
    'ed25519 small-order public key (identity), R = identity, s = 0: valid under ZIP-215 (the rule Sui validators apply) for any message, invalid under strict RFC 8032.',
  address: suiAddress(0x00, identity),
  context: OWNERSHIP,
  signature: b64(Uint8Array.from([0x00, ...identity, ...new Uint8Array(32), ...identity])),
  expect: true,
}

// ── gateway responses ────────────────────────────────────────────────────────────────────────
// What every gateway answers for each outcome: the status and the `{ error, code? }` body of
// `src/contract.ts`. `outcome` is a closed set of names; each implementation maps every name to a
// stimulus of its own (a decision, a store result, a request) and asserts the answer, and fails on a name
// it does not know. Error texts are part of the contract: both gateways emit exactly these.
const STATUS = {
  missingProof: 401,
  denied: 403,
  methodNotAllowed: 405,
  conflict: 409,
  bodyTooLarge: 413,
  rateLimited: 429,
  badGateway: 502,
  stateUnavailable: 503,
  gatewayTimeout: 504,
  loopDetected: 508,
}
const response = (outcome, status, error, code) => ({ outcome, status, error, ...(code ? { code } : {}) })
const responses = {
  description:
    'The gateways\' answer for each outcome: HTTP status and the JSON body { error, code? } (`code` only on a 409 conflict). `statuses` is GATEWAY_STATUS, `conflictCodes` is GATEWAY_CONFLICT_CODES, and each case names an `outcome` every implementation must be able to produce and then answer exactly so. Upstream transport faults (413, 504, an upstream 502) are not listed: they depend on the upstream, not on the protocol.',
  statuses: STATUS,
  conflictCodes: ['redeemed', 'leased'],
  cases: [
    response('missing-proof', 401, 'missing access proof'),
    response('bad-proof', 403, 'malformed access proof'),
    response('bad-signature', 403, 'signature does not recover address'),
    response('nonce-invalid', 403, 'challenge nonce invalid, expired, or already used'),
    response('not-owner', 403, 'address does not hold the required access NFT'),
    response('consume-missing', 403, 'no matching single-use consume for this address'),
    response('gate-paused', 403, 'the gate is paused'),
    response('chain-error', 502, 'on-chain verification failed'),
    response('state-unavailable', 503, 'gateway state unavailable'),
    response('rate-limited', 429, 'rate limit exceeded'),
    response('method-not-allowed', 405, 'method not allowed'),
    response('loop-detected', 508, 'loop detected'),
    response('consume-redeemed', 409, 'this consume has already been redeemed for an upload', 'redeemed'),
    response('consume-leased', 409, 'an upload for this consume is already in progress', 'leased'),
    response('commit-failed', 502, 'redemption commit failed'),
    response('lease-lost', 502, 'redemption lease lost'),
  ],
}

const out = {
  description:
    'Conformance vectors shared by the nft-gate gateways and clients (protocol nft-gate:access:v2). `personalMessage.cases` are the exact signed bytes for a context; `personalMessageRejects` are contexts no implementation may sign or accept; `signatures` are real Sui personal-message signatures that must verify against the message rebuilt from `context`; `audienceMismatch` are valid signatures whose verifier-side context differs in one bound field and must be refused; `negativeSignatures` must be refused; `zip215` pins ed25519 to ZIP-215 (Sui\'s rule); `proofDecode*` pin the token grammar; `txDigest` pins the consume digest rule (base58 that decodes to exactly 32 bytes); `responses` pins the status and error body each gateway answers per outcome; `addressNormalization` pins canonical addresses. Regenerate with: node scripts/gen-vectors.mjs > vectors.json',
  version: VERSION,
  personalMessage: { cases: [messageCase('ownership gateway', OWNERSHIP), messageCase('single-use gateway', SINGLE_USE)] },
  personalMessageRejects,
  proofDecode: { token: token({ address: '0x1', nonce: 'n', signature: 'AAAA' }), expect: { address: '0x1', nonce: 'n', signature: 'AAAA' } },
  proofDecodeRejects: {
    description: 'Tokens every decoder must reject before verification: size, ASCII, the field grammar, and the base64 (canonical padded standard alphabet, no inner whitespace), UTF-8 (strict, no BOM) and JSON (nesting depth 127, no unpaired surrogate escape, no overflowing number) layers underneath it.',
    cases: proofDecodeRejects,
  },
  txDigest: {
    description: 'A Sui transaction digest is base58 (Bitcoin alphabet: no 0 O I l) that decodes to exactly 32 bytes; a leading 1 is a zero byte. Every implementation accepts `valid` and refuses `invalid`.',
    valid: txDigestValid,
    invalid: txDigestInvalid,
  },
  responses,
  addressNormalization: {
    description:
      'Both gateways canonicalise the proof address before comparing to on-chain owners: strip 0x, lower-case, zero-pad to 64 hex, re-prefix 0x.',
    cases: [
      { input: '0x1', expected: '0x' + '0'.repeat(63) + '1' },
      { input: '0xABCDEF', expected: '0x' + '0'.repeat(58) + 'abcdef' },
      { input: '0x' + '0'.repeat(61) + '123', expected: '0x' + '0'.repeat(61) + '123' },
    ],
  },
  signatures: [
    await vec('ed25519', edKp, OWNERSHIP),
    await vec('secp256k1', k1Kp, OWNERSHIP),
    await vec('secp256r1', r1Kp, OWNERSHIP),
    await vec('ed25519 single-use', edKp, SINGLE_USE),
  ],
  audienceMismatch,
  negativeSignatures,
  zip215,
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
