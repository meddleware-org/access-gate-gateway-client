/**
 * Wire-protocol types shared by clients and the access-gate gateways. The `access_gate` object model
 * (gates, NFTs, platform config) lives in `@meddleware/access-gate-client`.
 */

/** The Sui networks a gateway can serve; part of the signed message (audience binding). */
export type SuiNetwork = 'localnet' | 'devnet' | 'testnet' | 'mainnet'

/** A server-issued, time-bound challenge the wallet signs to prove control of an address. */
export interface Challenge {
  /** Opaque nonce issued by the gateway: 1–128 characters of `A-Z a-z 0-9 . _ ~ -`. */
  nonce: string
  /** Unix epoch milliseconds after which the challenge is rejected. */
  expiresAt: number
}

/**
 * Everything the signed access message binds. A gateway rebuilds this from its OWN configuration
 * (origin, gate, network) plus the proof's nonce (and digest in single-use mode), never from the
 * token, so a signature made for one gateway, gate, network or consume cannot be replayed at another.
 */
export interface AccessMessageContext {
  /** Canonical origin of the gateway: `scheme://host[:port]`, lower-case, no path, default port omitted. */
  origin: string
  /** The guarded `Gate` object id: `0x` + 64 lower-case hex digits. */
  gateId: string
  network: SuiNetwork
  /** The challenge nonce being answered. */
  nonce: string
  /** Single-use gateways only: the base58 digest of the `consume` transaction. Omit otherwise. */
  consumeDigest?: string
}

/** The proof a client presents to a gateway to demonstrate gated access. */
export interface AccessProof {
  /** The Sui address claimed by the caller: `0x` followed by 1–64 hex digits. */
  address: string
  /** The challenge nonce that was signed. */
  nonce: string
  /** Base64 personal-message signature over {@link personalMessage}. */
  signature: string
  /**
   * For single-use gates: the digest of the on-chain `consume` transaction, so the gateway can
   * confirm the matching `AccessConsumedEvent` before allowing the request. It is part of the
   * signed message, so it cannot be swapped after signing.
   */
  consumeDigest?: string
}
