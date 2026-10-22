import { describe, it, expect } from 'vitest'
import { GATEWAY_STATUS, parseGatewayError } from '../src/contract.js'

describe('parseGatewayError', () => {
  it('reads an error with a known conflict code', () => {
    expect(parseGatewayError({ error: 'already redeemed', code: 'redeemed' })).toEqual({ error: 'already redeemed', code: 'redeemed' })
    expect(parseGatewayError({ error: 'busy', code: 'leased' })).toEqual({ error: 'busy', code: 'leased' })
  })
  it('drops unknown codes and rejects non-error bodies', () => {
    expect(parseGatewayError({ error: 'x', code: 'surprise' })).toEqual({ error: 'x' })
    for (const bad of [null, 'x', 7, [], {}, { error: 1 }, { code: 'redeemed' }, [{ error: 'x' }]]) expect(parseGatewayError(bad)).toBeNull()
    expect(parseGatewayError({ error: 'x', code: 7 })).toEqual({ error: 'x' })
  })
  it('keeps a store outage distinct from a conflict', () => {
    expect(GATEWAY_STATUS.stateUnavailable).not.toBe(GATEWAY_STATUS.conflict)
  })
  it('defines the statuses the gateways answer, including 405 and 508', () => {
    expect(GATEWAY_STATUS.methodNotAllowed).toBe(405)
    expect(GATEWAY_STATUS.loopDetected).toBe(508)
  })
})
