// Self-test of the published conformance vectors: the library and an independent verifier (the Sui
// SDK) must agree with every case. The gateways run the same file against their own implementations.
import { describe, it, expect } from 'vitest'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { isValidTransactionDigest } from '@mysten/sui/utils'
import vectors from '../vectors.json' with { type: 'json' }
import { personalMessage, decodeAccessProof, encodeAccessProof, isTransactionDigest } from '../src/proof.js'
import { GATEWAY_CONFLICT_CODES, GATEWAY_STATUS, parseGatewayError } from '../src/contract.js'
import type { AccessMessageContext } from '../src/types.js'

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const msg = (c: unknown) => personalMessage(c as AccessMessageContext)

async function verifies(address: string, signature: string, context: unknown): Promise<boolean> {
  try {
    await verifyPersonalMessageSignature(msg(context), signature, { address })
    return true
  } catch {
    return false
  }
}

describe('vectors.json', () => {
  it('names the protocol version the library implements', () => {
    expect(vectors.version).toBe('nft-gate:access:v2')
  })

  it.each(vectors.personalMessage.cases)('personalMessage: $name', (c) => {
    expect(new TextDecoder().decode(msg(c.context))).toBe(c.messageUtf8)
    expect(b64(msg(c.context))).toBe(c.messageBytesBase64)
  })

  it.each(vectors.personalMessageRejects)('personalMessage refuses: $name', (c) => {
    expect(() => msg(c.context)).toThrow()
  })

  it('proofDecode', () => {
    expect(decodeAccessProof(vectors.proofDecode.token)).toEqual(vectors.proofDecode.expect)
  })

  it.each(vectors.proofDecodeRejects.cases)('proofDecode refuses: $name', (c) => {
    expect(() => decodeAccessProof(c.token)).toThrow()
  })

  it.each(vectors.signatures)('signature verifies: $scheme', async (v) => {
    expect(await verifies(v.address, v.signature, v.context)).toBe(true)
    expect(decodeAccessProof(v.proofToken).signature).toBe(v.signature)
    expect(encodeAccessProof(decodeAccessProof(v.proofToken))).toBe(v.proofToken)
  })

  it.each(vectors.audienceMismatch)('audience mismatch is refused: $case', async (v) => {
    expect(await verifies(v.address, v.signature, v.context)).toBe(false)
  })

  it.each(vectors.negativeSignatures)('negative signature is refused: $case', async (v) => {
    expect(await verifies(v.address, v.signature, v.context)).toBe(false)
  })
})

describe('vectors.json: txDigest (base58 that decodes to exactly 32 bytes)', () => {
  it.each(vectors.txDigest.valid)('accepts: $name', (c) => {
    expect(isTransactionDigest(c.digest)).toBe(true)
    expect(isValidTransactionDigest(c.digest)).toBe(true) // the Sui SDK, as the independent rule
    expect(() => personalMessage({ ...ctx(), consumeDigest: c.digest })).not.toThrow()
  })

  it.each(vectors.txDigest.invalid)('refuses: $name', (c) => {
    expect(isTransactionDigest(c.digest)).toBe(false)
    expect(isValidTransactionDigest(c.digest)).toBe(false)
    expect(() => personalMessage({ ...ctx(), consumeDigest: c.digest })).toThrow(/digest/)
  })

  it('covers the 43, 44 and 45 character edges and every alphabet exclusion', () => {
    const lengths = (xs: { digest: string }[]) => new Set(xs.map((x) => x.digest.length))
    for (const n of [32, 43, 44]) expect(lengths(vectors.txDigest.valid).has(n)).toBe(true)
    for (const n of [31, 33, 43, 44, 45]) expect(lengths(vectors.txDigest.invalid).has(n)).toBe(true)
    const names = vectors.txDigest.invalid.map((c) => c.name).join('|')
    for (const ch of ['0', 'O', 'I', 'l']) expect(names).toContain(` ${ch} `)
  })

  function ctx(): AccessMessageContext {
    return vectors.personalMessage.cases[0]!.context as AccessMessageContext
  }
})

describe('vectors.json: responses (the gateway answers, pinned for every implementation)', () => {
  const { statuses, conflictCodes, cases } = vectors.responses

  it('lists exactly GATEWAY_STATUS and GATEWAY_CONFLICT_CODES', () => {
    expect(statuses).toEqual(GATEWAY_STATUS)
    expect(conflictCodes).toEqual([...GATEWAY_CONFLICT_CODES])
  })

  it('names every outcome once', () => {
    const names = cases.map((c) => c.outcome)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(cases)('$outcome: a status the contract defines and a body parseGatewayError reads back', (c) => {
    expect(Object.values(GATEWAY_STATUS)).toContain(c.status)
    const body = 'code' in c ? { error: c.error, code: c.code } : { error: c.error }
    expect(parseGatewayError(body)).toEqual(body)
    // A code only ever rides on a 409 conflict, and every conflict carries one.
    expect('code' in c).toBe(c.status === GATEWAY_STATUS.conflict)
  })

  it('keeps a store outage and a commit failure apart from a conflict', () => {
    const by = (o: string) => cases.find((c) => c.outcome === o)!
    expect(by('state-unavailable').status).toBe(GATEWAY_STATUS.stateUnavailable)
    expect(by('commit-failed').status).toBe(GATEWAY_STATUS.badGateway)
    expect(by('lease-lost').status).toBe(GATEWAY_STATUS.badGateway)
    expect(by('loop-detected').status).toBe(508)
  })
})
