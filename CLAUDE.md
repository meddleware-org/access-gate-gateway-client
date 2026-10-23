# CLAUDE.md — @meddleware/access-gate-gateway-client

## Invariants

- **Declaration-only build step.** Ships TypeScript source as the runtime (`default` export condition) and emits `.d.ts` declarations into `dist/` via `tsconfig.build.json` (`emitDeclarationOnly: true`). `prepublishOnly` runs the build automatically before every `npm publish`. The `types` export condition points at `dist/index.d.ts` so consumers don't require TypeScript to process raw `.ts` source from node_modules. Do not add a full transpile step or change the `default` export to point at `dist/`.
- **Client-side only.** This package builds and signs access proofs. It never verifies them — verification is the gateway's responsibility. Do not add signature verification logic here.
- **Wire format is shared.** The `nft-gate:access:v2` audience-bound personal message and the base64(JSON) proof token encoding are verified by both the Rust gateway and the Cloudflare Workers gateway. Any change to these in `proof.ts` is a breaking change that requires a coordinated update to both gateway implementations in `meddleware-org/access-gate-gateway`. `vectors.json` is generated (`npm run gen:vectors`, from `scripts/gen-vectors.mjs`, which builds the message independently of `src/`) and published; regenerate it with every protocol change and keep `npm run check:vectors` clean. It also carries `txDigest` (the consume-digest rule) and `responses` (status and body per gateway outcome): `access-gate-gateway/core`, `access-gate-gateway/gateway-workers` and the Rust Worker harness each map every `responses` outcome to a stimulus, so a new outcome needs all three.
- **Wire protocol only.** Challenge, signed message and proof token — nothing else. `access_gate` builders and reads live in `@meddleware/access-gate-client`; do not add them back here.
- **No hardcoded contract addresses.** Nothing here knows a package or gate ID.
- **No secrets.** Auth tokens, keypairs, and wallet signers are caller-supplied at runtime. Never hardcode credentials.
- **0BSD licence.** Do not change the licence.
- **No runtime dependencies.** Keep it that way: the gateways import this package directly.

---

## Deferred documentation — NOT for the `docs.` website (planned here per Part 0.4)

> Captured for the future **`dev.meddleware.co.uk`** subdomain; excluded from the user-facing
> `docs.` site. The Access Gate user docs cover buying/using passes, not building against the SDK.

### `dev.` — developer integration (to write later)

- **Full SDK reference** (TypeDoc target — ships `.d.ts`): the challenge/proof helpers.
- **Wire-protocol spec:** the `nft-gate:access:v2` personal message and base64(JSON) proof
  token encoding — the canonical contract shared with **both** gateway implementations
  (`meddleware-org/access-gate-gateway`). This is the authoritative schema for the docs-site Access Gate
  reference and for anyone verifying proofs.
