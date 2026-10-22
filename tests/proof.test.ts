import { describe, it, expect, vi } from 'vitest'
import {
  ACCESS_MESSAGE_VERSION,
  personalMessage,
  gatewayOrigin,
  encodeAccessProof,
  decodeAccessProof,
  buildAccessProof,
  isTransactionDigest,
  isNonce,
  CHALLENGE_CLOCK_SKEW_MS,
} from '../src/proof.js'
import type { AccessMessageContext } from '../src/types.js'

const DIGEST = '5Wq9tE4gXz8hEvFhYt8KkTJb2Pp6qXqj8cRk3xN1mYdL'
const CTX: AccessMessageContext = {
  origin: 'https://gateway.example',
  gateId: '0x' + 'a1'.repeat(32),
  network: 'testnet',
  nonce: 'GOLDEN-NONCE-123',
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)

describe('personalMessage', () => {
  it('is the documented multi-line ASCII message', () => {
    expect(text(personalMessage(CTX))).toBe(
      [ACCESS_MESSAGE_VERSION, 'origin:https://gateway.example', `gate:${CTX.gateId}`, 'network:testnet', 'nonce:GOLDEN-NONCE-123'].join('\n'),
    )
  })

  it('appends the consume line for single-use gateways only', () => {
    expect(text(personalMessage({ ...CTX, consumeDigest: DIGEST })).split('\n').at(-1)).toBe(`consume:${DIGEST}`)
    expect(text(personalMessage(CTX))).not.toContain('consume')
  })

  it('refuses non-canonical fields, which also blocks line injection', () => {
    for (const bad of [
      { origin: 'http://gateway.example' },
      { origin: 'https://Gateway.example' },
      { origin: 'https://gateway.example/' },
      { gateId: '0x1' },
      { gateId: '0x' + 'A1'.repeat(32) },
      { network: 'testnet2' as never },
      { nonce: 'n\nconsume:x' },
      { nonce: '' },
      { consumeDigest: 'DIGEST-1' },
    ]) {
      expect(() => personalMessage({ ...CTX, ...bad })).toThrow()
    }
  })
})

describe('gatewayOrigin', () => {
  it('canonicalises, and allows http on loopback only', () => {
    expect(gatewayOrigin('https://Gateway.example:443/relay/?x=1#y')).toBe('https://gateway.example')
    expect(gatewayOrigin('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787')
    expect(() => gatewayOrigin('http://gateway.example')).toThrow(/https/)
    expect(() => gatewayOrigin('https://user:pw@gateway.example')).toThrow(/credentials/)
    expect(() => gatewayOrigin('gateway.example')).toThrow(/invalid gateway URL/)
  })

  it('never echoes the input in an error (it may carry userinfo)', () => {
    for (const secret of ['http://user:s3cret@gateway.example', 'ftp://user:s3cret@gateway.example', 'https://user:s3cret@gateway.example', 'user:s3cret@']) {
      let message = ''
      try {
        gatewayOrigin(secret)
      } catch (e) {
        message = (e as Error).message
      }
      expect(message).not.toBe('')
      expect(message).not.toContain('s3cret')
      expect(message).not.toContain('gateway.example')
    }
  })
})

describe('access proof token', () => {
  const proof = { address: '0xabc', nonce: 'GOLDEN-NONCE-123', signature: 'U0lHTkFUVVJF' }

  it('round-trips, with and without a consume digest', () => {
    expect(decodeAccessProof(encodeAccessProof(proof))).toEqual(proof)
    const single = { ...proof, consumeDigest: DIGEST }
    expect(decodeAccessProof(encodeAccessProof(single))).toEqual(single)
  })

  it('is btoa(JSON) with the documented key order', () => {
    expect(encodeAccessProof(proof)).toBe(btoa(JSON.stringify(proof)))
  })

  it('applies the same rules when encoding as when decoding', () => {
    for (const bad of [
      { ...proof, address: '' },
      { ...proof, address: 'abc' },
      { ...proof, nonce: 'a b' },
      { ...proof, nonce: 'nönce' },
      { ...proof, signature: '***' },
      { ...proof, consumeDigest: 'DIGEST-1' },
    ]) {
      expect(() => encodeAccessProof(bad)).toThrow()
    }
  })

  it('rejects malformed tokens', () => {
    expect(() => decodeAccessProof('not-base64-json!!')).toThrow()
    expect(() => decodeAccessProof(btoa(JSON.stringify({ address: '0x1' })))).toThrow(/malformed/)
    expect(() => decodeAccessProof(btoa('null'))).toThrow(/malformed/)
    expect(() => decodeAccessProof(btoa('[]'))).toThrow(/malformed/)
    expect(() => decodeAccessProof('A'.repeat(4097))).toThrow(/too large/)
  })
})

describe('decodeAccessProof is strict (the same decisions as the Rust gateway)', () => {
  const json = (extra = '') => `{"address":"0x1","nonce":"n","signature":"AAAA"${extra}}`
  const b64 = (v: string | number[]) => Buffer.from(typeof v === 'string' ? v : Uint8Array.from(v)).toString('base64')
  const proof = { address: '0x1', nonce: 'n', signature: 'AAAA' }

  it('accepts canonical padded base64 of every length class', () => {
    // The bare object (51 bytes) needs no padding, `,"k":"a"` (59) one `=`, `,"k":12` (58) two.
    for (const [extra, padding] of [['', ''], [',"k":"a"', '='], [',"k":12', '==']] as const) {
      const token = b64(json(extra))
      expect(token.endsWith('=') ? token.slice(token.indexOf('=')) : '').toBe(padding)
      expect(decodeAccessProof(token)).toEqual(proof)
    }
  })

  it('refuses an unpadded token', () => {
    const token = b64(json(',"k":"a"'))
    expect(token.endsWith('=')).toBe(true)
    expect(() => decodeAccessProof(token.replace(/=+$/, ''))).toThrow(/canonical padded base64/)
  })

  it('refuses whitespace and padding inside the token, but ignores whitespace at either end', () => {
    const token = b64(json())
    for (const ws of [' ', '\n', '\r\n', '\t']) {
      expect(() => decodeAccessProof(token.slice(0, 8) + ws + token.slice(8))).toThrow()
    }
    expect(() => decodeAccessProof(token.slice(0, 8) + '=' + token.slice(8))).toThrow()
    // Rust's `trim()` strips Unicode White_Space at the ends: U+0085 yes, U+FEFF no.
    expect(decodeAccessProof(` \n\t${token}\u0085\u3000\r\n`)).toEqual(proof)
    expect(() => decodeAccessProof(`\ufeff${token}`)).toThrow()
    expect(() => decodeAccessProof(`${token}\u200b`)).toThrow()
  })

  it('refuses non-zero trailing bits, excess padding and the URL-safe alphabet', () => {
    const token = b64(json(',"k":"a"'))
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const body = token.replace(/=+$/, '')
    const dirty = body.slice(0, -1) + alphabet[alphabet.indexOf(body.at(-1) ?? '') | 1] + token.slice(body.length)
    expect(dirty).not.toBe(token)
    expect(() => decodeAccessProof(dirty)).toThrow(/canonical padded base64/)
    expect(() => decodeAccessProof(`${token}=`)).toThrow()
    const urlSafe = b64(json(',"k":"~~~???>>>"'))
    expect(urlSafe).toMatch(/[+/]/)
    expect(decodeAccessProof(urlSafe)).toEqual(proof)
    expect(() => decodeAccessProof(urlSafe.replace(/\+/g, '-').replace(/\//g, '_'))).toThrow()
  })

  it('refuses invalid UTF-8 even inside an unknown key, and a byte-order mark', () => {
    const prefix = [...Buffer.from('{"address":"0x1","nonce":"n","signature":"AAAA","')]
    for (const bad of [[0xff, 0xfe], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xc3]]) {
      expect(() => decodeAccessProof(b64([...prefix, ...bad, ...Buffer.from('":1}')]))).toThrow(/UTF-8/)
    }
    expect(() => decodeAccessProof(b64([0xef, 0xbb, 0xbf, ...Buffer.from(json())]))).toThrow()
    expect(decodeAccessProof(b64(json(',"héllo 😀":"é"')))).toEqual(proof)
  })

  it('refuses what serde_json refuses inside ignored keys and values', () => {
    // Unpaired surrogate escapes, including in a value a later duplicate key overwrites.
    for (const extra of [',"\\ud800":1', ',"k":"\\udc00"', ',"k":"\\ud800\\u0041"', ',"k":"\\ud800a"', ',"k":"\\ud800","k":1']) {
      expect(() => decodeAccessProof(b64(json(extra)))).toThrow(/surrogate/)
    }
    expect(decodeAccessProof(b64(json(',"k":"\\ud83d\\ude00"')))).toEqual(proof)
    expect(decodeAccessProof(b64(json(',"k":"\\\\ud800"')))).toEqual(proof)
    // A number that overflows to infinity, but not one that underflows or a big integer.
    for (const extra of [',"k":1e999', ',"k":-1e999', ',"k":1e999,"k":1']) {
      expect(() => decodeAccessProof(b64(json(extra)))).toThrow(/out of range/)
    }
    expect(decodeAccessProof(b64(json(',"k":[1e-999,123456789012345678901234567890,-0.5e3,true,false,null]')))).toEqual(proof)
  })

  it('allows JSON nested 127 levels (the top-level object counts) and refuses 128', () => {
    const nested = (levels: number) => json(`,"k":${'['.repeat(levels)}${']'.repeat(levels)}`)
    expect(decodeAccessProof(b64(nested(126)))).toEqual(proof)
    expect(() => decodeAccessProof(b64(nested(127)))).toThrow(/nested/)
    // Brackets inside strings do not count.
    expect(decodeAccessProof(b64(json(`,"k":"${'['.repeat(300)}"`)))).toEqual(proof)
  })

  it('round-trips every token encodeAccessProof emits (all padding classes, the largest field sizes)', () => {
    for (let nonceLength = 1; nonceLength <= 128; nonceLength++) {
      const p = { address: '0x' + 'a'.repeat(1 + (nonceLength % 64)), nonce: 'n'.repeat(nonceLength), signature: 'A'.repeat(Math.min(1024, 1 + nonceLength * 8)) }
      expect(decodeAccessProof(encodeAccessProof(p))).toEqual(p)
    }
    const largest = { address: '0x' + 'f'.repeat(64), nonce: 'n'.repeat(128), signature: 'A'.repeat(1024) + '==', consumeDigest: DIGEST.padEnd(44, '1') }
    const token = encodeAccessProof(largest)
    expect(token.length).toBeLessThanOrEqual(4096)
    expect(decodeAccessProof(token)).toEqual(largest)
  })
})

describe('buildAccessProof', () => {
  const challenge = { nonce: 'xyz', expiresAt: Date.now() + 1000 }
  const base = { address: '0xabc', challenge, gateway: 'https://gateway.example/', gateId: CTX.gateId, network: 'testnet' as const }

  it('signs the audience-bound message and returns the token', async () => {
    const sign = vi.fn(async (message: Uint8Array) => {
      expect(text(message)).toBe(text(personalMessage({ ...CTX, nonce: 'xyz' })))
      return { signature: 'QkFTRTY0' }
    })
    const token = await buildAccessProof({ ...base, sign })
    expect(sign).toHaveBeenCalledOnce()
    expect(decodeAccessProof(token)).toEqual({ address: '0xabc', nonce: 'xyz', signature: 'QkFTRTY0' })
  })

  it('binds the consume digest into both the message and the proof', async () => {
    const sign = vi.fn(async (message: Uint8Array) => {
      expect(text(message).endsWith(`\nconsume:${DIGEST}`)).toBe(true)
      return { signature: 'QkFTRTY0' }
    })
    const token = await buildAccessProof({ ...base, sign, consumeDigest: DIGEST })
    expect(decodeAccessProof(token).consumeDigest).toBe(DIGEST)
  })

  it('refuses malformed inputs before asking the wallet to sign', async () => {
    const sign = vi.fn(async () => ({ signature: 'QQ==' }))
    for (const bad of [{ consumeDigest: 'digest1' }, { gateId: '0x1' }, { gateway: 'http://gateway.example' }]) {
      await expect(buildAccessProof({ ...base, sign, ...bad })).rejects.toThrow()
    }
    expect(sign).not.toHaveBeenCalled()
  })
})

describe('buildAccessProof never prompts the wallet for a proof that cannot work (F14)', () => {
  const base = { address: '0xabc', challenge: { nonce: 'xyz', expiresAt: Date.now() + 60_000 }, gateway: 'https://gateway.example/', gateId: CTX.gateId, network: 'testnet' as const }
  const signer = () => vi.fn(async () => ({ signature: 'QkFTRTY0' }))

  it('refuses a malformed address before the prompt', async () => {
    const sign = signer()
    for (const address of ['', 'abc', '0x', '0xzz', '0x' + '1'.repeat(65), '0xé1', ' 0xabc']) {
      await expect(buildAccessProof({ ...base, sign, address })).rejects.toThrow(/address|ASCII/)
    }
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses an expired challenge before the prompt, with a documented skew allowance', async () => {
    const sign = signer()
    const at = (expiresAt: number) => ({ ...base, sign, challenge: { nonce: 'xyz', expiresAt } })
    await expect(buildAccessProof(at(Date.now() - CHALLENGE_CLOCK_SKEW_MS - 5_000))).rejects.toThrow(/expired/)
    await expect(buildAccessProof(at(1))).rejects.toThrow(/expired/)
    for (const expiresAt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(buildAccessProof(at(expiresAt))).rejects.toThrow(/expiry/)
    }
    expect(sign).not.toHaveBeenCalled()
    // Just expired by the local clock, within the skew: the gateway's clock decides, so it still signs.
    await expect(buildAccessProof(at(Date.now() - CHALLENGE_CLOCK_SKEW_MS + 5_000))).resolves.toEqual(expect.any(String))
    expect(sign).toHaveBeenCalledOnce()
  })

  it('allows a 30 second skew and no more', () => {
    expect(CHALLENGE_CLOCK_SKEW_MS).toBe(30_000)
  })

  it('does not echo the address or the expiry in the error', async () => {
    const sign = signer()
    const bad = '0xSECRET-ADDRESS'
    const message = await buildAccessProof({ ...base, sign, address: bad }).then(
      () => '',
      (e: Error) => e.message,
    )
    expect(message).toMatch(/address/)
    expect(message).not.toContain('SECRET')
  })
})

describe('shape predicates', () => {
  it('isTransactionDigest accepts base58 digests only', () => {
    expect(isTransactionDigest(DIGEST)).toBe(true)
    expect(isTransactionDigest('0OIl'.repeat(10))).toBe(false)
    expect(isTransactionDigest('')).toBe(false)
  })
  it('isTransactionDigest requires exactly 32 decoded bytes (F18)', () => {
    expect(isTransactionDigest('1'.repeat(32))).toBe(true) // 32 zero bytes
    expect(isTransactionDigest('1'.repeat(31))).toBe(false)
    expect(isTransactionDigest('1'.repeat(33))).toBe(false)
    expect(isTransactionDigest('z'.repeat(43))).toBe(true) // 58^43 - 1 fits in 32 bytes
    expect(isTransactionDigest('z'.repeat(44))).toBe(false) // 33 bytes
    expect(isTransactionDigest('z'.repeat(45))).toBe(false)
    expect(isTransactionDigest('1' + 'z'.repeat(43))).toBe(false) // a leading 1 is a zero byte: 33 bytes
    expect(isTransactionDigest('1' + 'z'.repeat(42))).toBe(true) // 1 zero byte + 31 bytes
    for (const ch of ['0', 'O', 'I', 'l']) expect(isTransactionDigest(DIGEST.slice(0, 5) + ch + DIGEST.slice(6))).toBe(false)
  })
  it('isNonce accepts the challenge alphabet only', () => {
    expect(isNonce('aZ09._~-')).toBe(true)
    for (const bad of ['', 'a b', 'a\nb', 'nönce', 'a'.repeat(129)]) expect(isNonce(bad)).toBe(false)
  })
})
