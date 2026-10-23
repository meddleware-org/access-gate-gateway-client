# Security Policy

## Scope

This policy covers security issues in the `@meddleware/access-gate-gateway-client` package source
(`src/**`) — the access-proof builder/encoder/decoder (`src/proof.ts`) and the challenge helper.
`access_gate` transaction builders and reads are `@meddleware/access-gate-client` (its own policy).

It does not cover:

- The access-gate gateways that **verify** proofs (see that repo's `SECURITY.md`) — this client
  builds and signs proofs but verifies nothing
- The `access-gate-sui` on-chain package (see that repo's `SECURITY.md`)
- The caller-supplied wallet/signer and gateway host (both injected)

## Security model (invariants)

These invariants are load-bearing. A report demonstrating that any is violated is in scope and
treated as high severity:

1. **The client never verifies and never decides.** `decodeAccessProof` only structurally parses;
   all signature/ownership authorization happens server-side in the gateway.
2. **The client never holds private keys.** Signing is delegated to a caller-supplied signer.
3. **The wire format is versioned, audience-bound and mirrored.** The signed message is
   `nft-gate:access:v2` plus the gateway origin, gate id, network, nonce and (single-use) consume
   digest, and the proof token is `base64(JSON{address,nonce,signature,consumeDigest?})` with fixed
   field order, decoded strictly (canonical padded base64, strict UTF-8, the JSON limits serde_json applies)
   so both gateways reach identical decisions (the consume digest is base58 that decodes to exactly 32 bytes; the response status and error body per outcome are pinned too); both are pinned by the published `vectors.json`, which both gateway implementations
   test against. Any change is a breaking change requiring lockstep updates to the gateways and the
   vectors.
4. **No protocol addresses or secrets are hardcoded** in shipped source, and there are no runtime
   dependencies.
5. **Parsing is pollution-safe.** `decodeAccessProof` copies only known fields into a fresh object;
   no attacker key reaches a prototype.

> Note on address canonicalization: the proof `address` field is emitted **verbatim** from the
> caller (not normalized). Gateways must normalize both the proof address and the on-chain sender
> before comparison. See the corpus audit's cross-reference (access-gate-gateway F1 / access-gate-gateway-client F1).

## Supported versions

Only the latest published npm version receives security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities by emailing **<security@meddleware.co.uk>**. Include:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof-of-concept (if available)
- The package version or commit SHA you tested against

You will receive an acknowledgement within **3 business days** and a resolution plan within
**14 days** for confirmed issues. Critical issues (CVSS ≥ 9.0) are prioritised for same-day
acknowledgement.

## Disclosure

Once a fix is released, a security advisory will be published on the GitHub repository. Reporters
may be credited by name unless they prefer to remain anonymous.
