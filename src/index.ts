/**
 * `@meddleware/access-gate-gateway-client` — the access-gate gateway wire protocol, client side.
 *
 * Challenge fetching, the audience-bound message a wallet signs, access-proof encoding/decoding and
 * the gateways' response contract — the one contract shared with both access-gate gateways. The
 * conformance vectors both gateways test against are published as `vectors.json`. No runtime
 * dependencies. Building `access_gate` transactions and reading gates/NFTs:
 * `@meddleware/access-gate-client`.
 */

export type { Challenge, AccessProof, AccessMessageContext, SuiNetwork } from './types.js'
export { fetchChallenge } from './challenge.js'
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
export type { PersonalMessageSigner } from './proof.js'
export { GATEWAY_STATUS, GATEWAY_CONFLICT_CODES, parseGatewayError } from './contract.js'
export type { GatewayConflictCode, GatewayErrorBody } from './contract.js'
