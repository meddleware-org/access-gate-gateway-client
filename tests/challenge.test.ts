/**
 * Tests for fetching a challenge (`src/challenge.ts`): the response is parsed strictly (camelCase `expiresAt`, a valid nonce), the request is hardened (https
 * only, no redirect, no cache, no credentials, a time limit and a byte cap) and the redirect refusal is proved against a real HTTP server, not only a stub.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fetchChallenge } from '../src/challenge.js'

// Undo every spy after each test; the stubbed globals are removed where a test needs the real `fetch`.
afterEach(() => vi.restoreAllMocks())

describe('fetchChallenge', () => {
  // `fetch` is stubbed with `vi.stubGlobal`, so no request leaves the machine.
  it('parses camelCase expiresAt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ nonce: 'abc', expiresAt: 123 }), { status: 200 })),
    )
    expect(await fetchChallenge('https://gw.example')).toEqual({ nonce: 'abc', expiresAt: 123 })
  })

  it('strips a trailing slash', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ nonce: 'n2', expiresAt: 456 }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    expect(await fetchChallenge('https://gw.example/')).toEqual({ nonce: 'n2', expiresAt: 456 })
    expect(spy).toHaveBeenCalledWith('https://gw.example/v1/challenge', expect.anything())
  })

  // The Rust gateways emit camelCase; a different spelling means the contract changed and must fail loudly.
  it('does not accept snake_case expires_at', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nonce: 'n2', expires_at: 456 }), { status: 200 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/expiry/)
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/503/)
  })

  it('throws when nonce is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ expiresAt: 1 }), { status: 200 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
  })

  it('refuses a body that is not a JSON object', async () => {
    // JSON that parses but is not an object: each must be refused as having no nonce.
    for (const body of [null, [], 'nonce', 7, [{ nonce: 'n', expiresAt: 1 }]]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
      await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
    }
  })
})

describe('fetchChallenge hardening', () => {
  // A fetch stub that answers 200 with the given JSON.
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

  // A gateway may be served under a path; the query and fragment are not part of its identity.
  it('keeps a path prefix and drops query and fragment', async () => {
    const spy = ok({ nonce: 'n', expiresAt: 1 })
    vi.stubGlobal('fetch', spy)
    await fetchChallenge('https://gw.example/relay/?x=1#y')
    expect(spy).toHaveBeenCalledWith('https://gw.example/relay/v1/challenge', expect.anything())
  })

  it('refuses a plain-http or malformed host, but allows http on loopback', async () => {
    vi.stubGlobal('fetch', ok({ nonce: 'n', expiresAt: 1 }))
    await expect(fetchChallenge('http://gw.example')).rejects.toThrow(/https/)
    await expect(fetchChallenge('gw.example')).rejects.toThrow(/invalid gateway URL/)
    await expect(fetchChallenge('http://127.0.0.1:8787')).resolves.toEqual({ nonce: 'n', expiresAt: 1 })
  })

  // The stub never answers until the signal aborts, which is what a hung gateway looks like.
  it('always passes an abort signal, and times out a hung gateway', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
      ),
    )
    await expect(fetchChallenge('https://gw.example', { timeoutMs: 20 })).rejects.toThrow(/timed out|abort/i)
  })

  it("honours the caller's signal", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
      ),
    )
    // Abort after the request has started.
    const ctl = new AbortController()
    const p = fetchChallenge('https://gw.example', { signal: ctl.signal })
    ctl.abort()
    await expect(p).rejects.toThrow(/aborted/)
  })

  // One rejection per way a body can be wrong: too big, not JSON, a bad nonce (empty, with a space, non-ASCII), a bad expiry (string, zero, negative, null).
  it('rejects oversized, non-JSON and badly typed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(5000), { status: 200 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/too large/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/not JSON/)
    vi.stubGlobal('fetch', ok({ nonce: '', expiresAt: 1 }))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
    vi.stubGlobal('fetch', ok({ nonce: 'a b', expiresAt: 1 }))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
    vi.stubGlobal('fetch', ok({ nonce: 'nönce', expiresAt: 1 }))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
    vi.stubGlobal('fetch', ok({ nonce: 'n', expiresAt: '1' }))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/expiry/)
    for (const expiresAt of [0, -1, null]) {
      vi.stubGlobal('fetch', ok({ nonce: 'n', expiresAt }))
      await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/expiry/)
    }
    vi.stubGlobal('fetch', ok(null))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/nonce/)
  })

  it('refuses redirects and caps a streamed body without a content-length', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ nonce: 'n', expiresAt: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await fetchChallenge('https://gw.example')
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'error' }))
    // An endless body with no Content-Length: only the running byte count can stop it.
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        ctl.enqueue(new TextEncoder().encode('x'.repeat(1024)))
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })))
    await expect(fetchChallenge('https://gw.example')).rejects.toThrow(/too large/)
  })
})

// F11 of the audit: a nonce must be fresh and anonymous, so the request options are asserted as a set.
describe('fetchChallenge request options (F11)', () => {
  it('never uses an HTTP cache and sends no ambient credentials', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ nonce: 'n', expiresAt: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await fetchChallenge('https://gw.example')
    expect(spy).toHaveBeenCalledOnce()
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', redirect: 'error' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchChallenge against a real HTTP server', () => {
  beforeEach(() => vi.unstubAllGlobals()) // the real fetch, not an earlier test's stub

  /** Start a local HTTP server on a free port; `hits` records every request it receives, so a test can prove a URL was never contacted. */
  async function serve(handler: Parameters<typeof createServer>[1]) {
    // `GET /path` for each request, in order.
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`)
      handler?.(req, res)
    })
    // Port 0 asks the system for a free one; loopback only.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { url, hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
  }

  it('answers a challenge over real HTTP', async () => {
    const s = await serve((_req, res) => res.setHeader('content-type', 'application/json').end(JSON.stringify({ nonce: 'real', expiresAt: 5 })))
    try {
      expect(await fetchChallenge(s.url)).toEqual({ nonce: 'real', expiresAt: 5 })
      expect(s.hits).toEqual(['GET /v1/challenge'])
    } finally {
      await s.close()
    }
  })

  it('rejects a 302 and never follows it', async () => {
    const s = await serve((req, res) => {
      if (req.url === '/v1/challenge') return res.writeHead(302, { location: '/elsewhere' }).end()
      res.setHeader('content-type', 'application/json').end(JSON.stringify({ nonce: 'stolen', expiresAt: 5 }))
    })
    try {
      await expect(fetchChallenge(s.url)).rejects.toThrow()
      expect(s.hits).toEqual(['GET /v1/challenge']) // the redirect target was never requested
    } finally {
      await s.close()
    }
  })

  it('rejects a 301 to another origin without contacting it', async () => {
    // The redirect target: a second server that must never be contacted.
    const other = await serve((_req, res) => res.end(JSON.stringify({ nonce: 'x', expiresAt: 1 })))
    const s = await serve((_req, res) => res.writeHead(301, { location: `${other.url}/v1/challenge` }).end())
    try {
      await expect(fetchChallenge(s.url)).rejects.toThrow()
      expect(other.hits).toEqual([])
    } finally {
      await s.close()
      await other.close()
    }
  })
})
