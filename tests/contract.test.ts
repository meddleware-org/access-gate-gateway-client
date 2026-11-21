/**
 * Tests for the gateway response contract (`src/contract.ts`): a gateway error body is read only when it has the shape and a known code, an unknown code
 * is dropped (never trusted), and the statuses the Rust gateways emit are in the table.
 */
import { describe, it, expect } from 'vitest'
import { GATEWAY_STATUS, parseGatewayError } from '../src/contract.js'

describe('parseGatewayError', () => {
  it('reads an error with a known conflict code', () => {
    expect(parseGatewayError({ error: 'already redeemed', code: 'redeemed' })).toEqual({ error: 'already redeemed', code: 'redeemed' })
    expect(parseGatewayError({ error: 'busy', code: 'leased' })).toEqual({ error: 'busy', code: 'leased' })
  })
  // A client must switch only on codes it knows: an unknown code survives as a plain error, and a body that is not an error at all is `null`.
  it('drops unknown codes and rejects non-error bodies', () => {
    expect(parseGatewayError({ error: 'x', code: 'surprise' })).toEqual({ error: 'x' })
    for (const bad of [null, 'x', 7, [], {}, { error: 1 }, { code: 'redeemed' }, [{ error: 'x' }]]) expect(parseGatewayError(bad)).toBeNull()
    expect(parseGatewayError({ error: 'x', code: 7 })).toEqual({ error: 'x' })
  })
  // A broken state store must never look like "this consume was already used" (409): a client would stop retrying a request that could succeed.
  it('keeps a store outage distinct from a conflict', () => {
    expect(GATEWAY_STATUS.stateUnavailable).not.toBe(GATEWAY_STATUS.conflict)
  })
  it('defines the statuses the gateways answer, including 405 and 508', () => {
    expect(GATEWAY_STATUS.methodNotAllowed).toBe(405)
    expect(GATEWAY_STATUS.loopDetected).toBe(508)
  })
})
