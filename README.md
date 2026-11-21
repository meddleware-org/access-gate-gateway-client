# @meddleware/access-gate-gateway-client

[![License: 0BSD](https://img.shields.io/badge/License-0BSD-blue.svg)](LICENSE)

The client side of the [access-gate-gateway](https://github.com/meddleware-org/access-gate-gateway) wire protocol: fetch a
challenge, derive the exact personal message a wallet signs, and encode the access proof a gateway
verifies. Browser-safe, Node-friendly, **no runtime dependencies**.

Building `access_gate` transactions (purchase, consume, gate admin) and reading gates, passes and the
platform configuration: [`@meddleware/access-gate-client`](https://github.com/meddleware-org/access-gate-client).

## Install

```bash
npm install @meddleware/access-gate-gateway-client
```

## Usage

```ts
import { fetchChallenge, buildAccessProof } from '@meddleware/access-gate-gateway-client'

// Single-use gates: first execute an access_gate `consume` (access-gate-client) and keep its digest.
const challenge = await fetchChallenge(gateway)
const token = await buildAccessProof({ address, challenge, sign, gateway, gateId, network: 'testnet', consumeDigest })
// send `token` as `Authorization: Bearer <token>` to the gateway / relay
```

## API

| Export | Purpose |
| --- | --- |
| `fetchChallenge(gateway, opts?)` | `GET /v1/challenge` → `{ nonce, expiresAt }`; https only (loopback http allowed), no redirects, `cache: 'no-store'`, `credentials: 'omit'`, 4 KiB body cap, aborts after `opts.timeoutMs` (10 s) or on `opts.signal` |
| `personalMessage(context)` | the exact bytes the wallet signs (see below); throws on any non-canonical field |
| `buildAccessProof({ address, challenge, sign, gateway, gateId, network, consumeDigest? })` | sign the audience-bound message and return the Bearer token; refuses a malformed address or an expired challenge (30 s clock-skew allowance, `CHALLENGE_CLOCK_SKEW_MS`) before the wallet prompt |
| `encodeAccessProof(proof)` / `decodeAccessProof(token)` | base64(JSON) token ↔ `AccessProof`; both enforce the same field grammar; the decoder also enforces a 4 KiB cap and strict base64 / UTF-8 / JSON (see below) |
| `gatewayOrigin(url)`, `isNonce(s)`, `isTransactionDigest(s)` | canonical origin; nonce check; transaction digest check (base58 that decodes to exactly 32 bytes) |
| `GATEWAY_STATUS`, `GATEWAY_CONFLICT_CODES`, `parseGatewayError(body)` | the gateways' response contract (`409` carries `code: redeemed \| leased`); the status and error text per outcome are pinned in `vectors.json` `responses` |
| types `Challenge`, `AccessProof`, `AccessMessageContext`, `SuiNetwork`, `PersonalMessageSigner` | wire types |
| `@meddleware/access-gate-gateway-client/vectors.json` | the shared conformance vectors |

## Wire protocol

- **Challenge**: `{ nonce: string, expiresAt: number }` (nonce: 1-128 characters of `A-Z a-z 0-9 . _ ~ -`)
- **Signed message** (ASCII, one `key:value` line each):

  ```text
  access-gate-gateway:access:v3
  origin:<canonical origin>
  gate:<0x + 64 lower-case hex>
  network:<localnet|devnet|testnet|mainnet>
  nonce:<nonce>
  consume:<base58 digest>      (single-use gateways only; 32 bytes once decoded)
  ```

  The gateway rebuilds it from its own origin, gate and network, so a signature is useless at any
  other gateway, gate, network or consume.
- **Proof token**: `base64(JSON { address, nonce, signature, consumeDigest? })`, fixed field order. The
  decoder is strict and refuses what the Rust gateway refuses: canonical **padded** standard base64
  (no unpadded token, no inner whitespace, no URL-safe alphabet, no non-zero trailing bits), well-formed
  UTF-8 without a byte-order mark, and JSON nested at most 127 levels with no unpaired surrogate escape and
  no number that overflows (`1e999`). Only whitespace at either end of the token is ignored.

Both gateways in [access-gate-gateway](https://github.com/meddleware-org/access-gate-gateway) verify exactly this format;
`vectors.json` pins it, including the consume-digest rule (`txDigest`) and the status and body each gateway answers per outcome (`responses`) (`npm run gen:vectors` regenerates it, `npm run check:vectors` checks it is current).

## Development

The package ships its TypeScript source plus a declaration-only build, and has no runtime dependencies. The checks, all run in CI on every push (`.github/workflows/node-ci.yml`;
the tests also run on Node 24, the minimum in `engines`):

```bash
npm ci                           # install exactly the lockfile
npm run type-check               # tsc over src/ and tests/
npm run lint                     # eslint (typescript-eslint recommended)
npm test                         # 159 offline unit tests, including the self-test of vectors.json against the Sui SDK's verifier
npm run check:vectors            # vectors.json is what scripts/gen-vectors.mjs produces
npm run build                    # emits .d.ts into dist/ (also run by prepublishOnly)
npm audit --audit-level=high     # the dependency check
```

How to propose a change: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[0BSD](LICENSE)

## Open standards

What this project speaks, what is planned and where you can extend it: [docs/INTEROP.md](docs/INTEROP.md).
