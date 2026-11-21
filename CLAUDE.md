# CLAUDE.md — @meddleware/access-gate-gateway-client

## Invariants

- **Declaration-only build step.** Ships TypeScript source as the runtime (`default` export condition) and emits `.d.ts` declarations into `dist/` via `tsconfig.build.json` (`emitDeclarationOnly: true`). `prepublishOnly` runs the build automatically before every `npm publish`. The `types` export condition points at `dist/index.d.ts` so consumers don't require TypeScript to process raw `.ts` source from node_modules. Do not add a full transpile step or change the `default` export to point at `dist/`.
- **Client-side only.** This package builds and signs access proofs. It never verifies them — verification is the gateway's responsibility. Do not add signature verification logic here.
- **Wire format is shared.** The `access-gate-gateway:access:v3` audience-bound personal message and the base64(JSON) proof token encoding are verified by both the Rust gateway and the Cloudflare Workers gateway. Any change to these in `proof.ts` is a breaking change that requires a coordinated update to both gateway implementations in `meddleware-org/access-gate-gateway`. `vectors.json` is generated (`npm run gen:vectors`, from `scripts/gen-vectors.mjs`, which builds the message independently of `src/`) and published; regenerate it with every protocol change and keep `npm run check:vectors` clean. It also carries `txDigest` (the consume-digest rule) and `responses` (status and body per gateway outcome): `access-gate-gateway/core`, `access-gate-gateway/gateway-workers` and the Rust Worker harness each map every `responses` outcome to a stimulus, so a new outcome needs all three.
- **Wire protocol only.** Challenge, signed message and proof token — nothing else. `access_gate` builders and reads live in `@meddleware/access-gate-client`; do not add them back here.
- **No hardcoded contract addresses.** Nothing here knows a package or gate ID.
- **No secrets.** Auth tokens, keypairs, and wallet signers are caller-supplied at runtime. Never hardcode credentials.
- **0BSD licence.** Do not change the licence.
- **No runtime dependencies.** Keep it that way: the gateways import this package directly.

## Layout and commands

Targets: Node.js >= 24, browsers, workerd. Public entry is `src/index.ts`; the `./vectors.json` subpath is also exported.

```text
src/
  types.ts      Challenge, AccessProof, AccessMessageContext, SuiNetwork
  challenge.ts  fetchChallenge
  proof.ts      personalMessage, buildAccessProof, encode/decodeAccessProof, gatewayOrigin, isNonce, isTransactionDigest
  contract.ts   gateway response contract (statuses, conflict codes, parseGatewayError)
scripts/gen-vectors.mjs   generates vectors.json
tests/                    vitest unit tests, incl. vectors.json verified with an independent verifier (@mysten/sui)
```

## Commands

```bash
npm ci && npm run type-check && npm run lint && npm test && npm run build   # the core of what the `check` CI job runs
npm run check:vectors                                                       # vectors.json equals what scripts/gen-vectors.mjs produces (npm run gen:vectors rewrites it)
npm audit --audit-level=high                                                # the dependency check (this repo does not use mw-audit-gate)
```

Release: bump `version`, push, tag `v<version>`; `npm-publish.yml` re-runs the checks on the tagged commit and publishes with npm trusted publishing.

---

## Deferred documentation — NOT for the `docs.` website (planned here per Part 0.4)

> Captured for the future **`meddleware.dev`** subdomain; excluded from the user-facing
> `docs.` site. The Access Gate user docs cover buying/using passes, not building against the SDK.

### `dev.` — developer integration (to write later)

- **Full SDK reference** (TypeDoc target — ships `.d.ts`): the challenge/proof helpers.
- **Wire-protocol spec:** the `access-gate-gateway:access:v3` personal message and base64(JSON) proof
  token encoding — the canonical contract shared with **both** gateway implementations
  (`meddleware-org/access-gate-gateway`). This is the authoritative schema for the docs-site Access Gate
  reference and for anyone verifying proofs.

## Gotchas

- **`vectors.json` is generated and published.** Edit `scripts/gen-vectors.mjs`, run `npm run gen:vectors`, and commit both: the gateways (Workers and Rust) test against this
  file, and a Rust gateway keeps a vendored copy that CI compares with the installed package. The generator holds three fixed *test* keypairs; they guard nothing.
- **The decoder must stay as strict as the Rust gateway's.** A token one side accepts and the other refuses is a gap; add a vector (a `proofDecodeRejects` case) with the change.
- **Every check in `buildAccessProof` runs before the wallet prompt on purpose.** Do not move one after the signature: a person must never be asked to sign a proof that cannot work.
- **There is no `mw-audit-gate`.** This repository does not depend on `@meddleware/frontend-config`; CI runs `npm audit --audit-level=high`.
- **`engines` says Node 24.** CI runs the tests on 24 as well as 26 (`node24-compat`); do not use a newer built-in without raising the floor.

## Related

- The audit: [`docs/audit/access-gate-gateway-client-audit.md`](docs/audit/access-gate-gateway-client-audit.md).
- How to propose a change: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Consumers: `access-gate-gateway` (`gateway-workers` at `^0.0.22`, `worker` at exactly `0.0.22`), `walrus-storage-client`, `docs-site` and `dev-site` (all `^0.0.22`); release them after
  this package. The chain reads and the builders: `access-gate-client`.

## Interoperability

- [docs/INTEROP.md](docs/INTEROP.md): the standards this project speaks, what is planned, where to extend it, and what proves each claim.
