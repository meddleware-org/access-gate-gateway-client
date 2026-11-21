/**
 * `@meddleware/access-gate-gateway-client` — the access-gate gateway wire protocol, client side.
 *
 * This file is the public surface: it only re-exports the types, the challenge fetch, the proof functions and the response contract. `isAscii`,
 * `isRecord` and the other helpers in `proof.ts` are internal and not exported here.
 *
 * Challenge fetching, the audience-bound message a wallet signs, access-proof encoding/decoding and
 * the gateways' response contract — the one contract shared with both access-gate gateways. The
 * conformance vectors both gateways test against are published as `vectors.json`. No runtime
 * dependencies. Building `access_gate` transactions and reading gates/NFTs:
 * `@meddleware/access-gate-client`.
 */

// The wire types: a challenge, a proof, the data a signed message binds, and the networks a gateway can serve.
export type { Challenge, AccessProof, AccessMessageContext, SuiNetwork } from './types.js'
// Step 1 of the protocol: ask a gateway for a challenge.
export { fetchChallenge } from './challenge.js'
// Step 2: build the message the wallet signs, sign it and encode the proof; the checks (`isNonce`, `isTransactionDigest`) are exported for UIs that validate early.
export {
  ACCESS_MESSAGE_VERSION,
  personalMessage,
  gatewayOrigin,
  encodeAccessProof,
  decodeAccessProof,
  buildAccessProof,
  isTransactionDigest,
  isNonce,
  CHALLENGE_CLOCK_SKEW_MS,
} from './proof.js'
// The shape of the wallet's signing function, so a caller can type its own.
export type { PersonalMessageSigner } from './proof.js'
// Step 3: understand the gateway's answer (statuses and conflict codes) without trusting an unknown code.
export { GATEWAY_STATUS, GATEWAY_CONFLICT_CODES, parseGatewayError } from './contract.js'
export type { GatewayConflictCode, GatewayErrorBody } from './contract.js'
