import type { NextApiRequest, NextApiResponse } from 'next'

import { cache, CacheKeys, CACHE_TTL } from '../../cache'
import { polymarketAPI } from '../../polymarket-api'
import { computeOrderBookAnalytics, createOrderBookSnapshot } from '@/orderbook-analytics'
import { APIResponse, OrderBookAnalytics } from '../../types'
import { createErrorResponse, createSuccessResponse } from '../../utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Score a text string for keyword relevance */
function keywordScore(text: string, kw: string): number {
  const t = text.toLowerCase()
  const k = kw.toLowerCase()
  if (t === k) return 100
  if (t.startsWith(k)) return 80
  if (t.includes(k)) return 50
  let score = 0
  const words = k.split(/\s+/).filter(w => w.length > 2)
  for (const word of words) {
    if (t.includes(word)) score += 15
  }
  // Bonus: all words matched
  if (words.length > 1 && words.every(w => t.includes(w))) score += 25
  return score
}

/**
 * Probe whether a tokenId has a live orderbook (any bids or asks).
 * Returns the book if live, null if empty/closed/error.
 */
async function probeLiveBook(
  tokenId: string
): Promise<{ bids: unknown[]; asks: unknown[] } | null> {
  try {
    const book = await polymarketAPI.getOrderBook(tokenId)
    if ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0) {
      return book
    }
    return null
  } catch {
    return null
  }
}

/**
 * Walk a list of candidate tokenIds (in order) and return the first one
 * that has a live orderbook. Returns null if none found.
 */
async function findLiveToken(
  candidates: string[]
): Promise<string | null> {
  const BATCH = 3
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(id => probeLiveBook(id).then(b => b ? id : null))
    )
    const found = results.find(r => r !== null)
    if (found) return found
  }
  return null
}

/** Resolve a human-readable query/slug to a CLOB tokenId */
async function resolveTokenId(
  tokenIdParam: string | undefined,
  slugParam: string | undefined,
  qParam: string | undefined
): Promise<{ tokenId: string; resolvedVia: string } | { error: string }> {
  // Mode 1: raw tokenId provided
  if (tokenIdParam) {
    return { tokenId: tokenIdParam, resolvedVia: 'tokenId' }
  }

  // Mode 2: event slug provided
  if (slugParam) {
    const event = await polymarketAPI.getEvent(slugParam)
    if (!event) {
      return {
        error:
          `Event slug "${slugParam}" not found. ` +
          `Use /api/events/browse or /api/search?q=<term> to discover valid slugs.`,
      }
    }
    // Collect all token IDs across all markets in this event
    const allTokenIds: string[] = []
    for (const market of event.groupedMarkets ?? []) {
      for (const tid of market.clobTokenIds ?? []) {
        if (tid) allTokenIds.push(tid)
      }
    }
    if (allTokenIds.length === 0) {
      return { error: `Event "${event.title}" has no tradeable CLOB markets yet.` }
    }
    // Pick first live token (non-empty book), fall back to first token
    const liveTokenId = await findLiveToken(allTokenIds)
    const tokenId = liveTokenId ?? allTokenIds[0]
    return { tokenId, resolvedVia: `slug:${slugParam}` }
  }

  // Mode 3: plain-text search query
  if (qParam) {
    const kw = qParam.trim()

    // Fetch top active events by volume, then score by keyword relevance
    const { events } = await polymarketAPI.getEvents({
      limit: 200,
      active: true,
      closed: false,
      orderBy: 'volumeAll',
      ascending: false,
    })

    // Also search closed events in case the topic only has historical markets
    const closedResult = await polymarketAPI.getEvents({
      limit: 100,
      closed: true,
      orderBy: 'volumeAll',
      ascending: false,
    }).catch(() => ({ events: [] }))

    const allEvents = [...events, ...closedResult.events]

    const scored = allEvents
      .map(e => {
        const matchScore =
          keywordScore(e.slug, kw) * 1.5 +  // slug match = strongest signal
          keywordScore(e.title, kw) +
          keywordScore(e.description.slice(0, 300), kw) * 0.5
        
        return {
          event: e,
          score: matchScore > 0 ? matchScore + (e.active && !e.closed ? 15 : 0) : 0,
        }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10) // top-10 candidates

    if (scored.length === 0) {
      return {
        error:
          `No events found for "${kw}". ` +
          `Try /api/search?q=${encodeURIComponent(kw)} to browse all events.`,
      }
    }


    // Collect all candidate tokenIds in rank order
    const candidateTokenIds: Array<{ tokenId: string; eventSlug: string }> = []
    for (const { event } of scored) {
      for (const market of event.groupedMarkets ?? []) {
        for (const tid of market.clobTokenIds ?? []) {
          if (tid) candidateTokenIds.push({ tokenId: tid, eventSlug: event.slug })
        }
      }
    }

    if (candidateTokenIds.length === 0) {
      return {
        error:
          `Events found for "${kw}" but none have live CLOB markets. ` +
          `Use /api/search?q=${encodeURIComponent(kw)} to see available events.`,
      }
    }

    // Walk candidates and pick first one with a live (non-empty) orderbook
    const liveTokenId = await findLiveToken(
      candidateTokenIds.map(c => c.tokenId)
    )

    if (!liveTokenId) {
      // All candidates probed — none have live orderbooks right now
      const exampleSlug = scored[0]?.event?.slug ?? ''
      return {
        error:
          `All markets matching "${kw}" have no live orderbooks right now ` +
          `(they may be closed or not yet active on CLOB). ` +
          `Try /api/events/${exampleSlug}/orderbook for historical analysis, ` +
          `or /api/search?q=${encodeURIComponent(kw)} to find related active events.`,
      }
    }

    const matchedEntry = candidateTokenIds.find(c => c.tokenId === liveTokenId)!
    return {
      tokenId: liveTokenId,
      resolvedVia: `search:${matchedEntry.eventSlug}`,
    }
  }

  return {
    error:
      'Provide one of: ?tokenId=<hex>, ?slug=<eventSlug>, or ?q=<search term>. ' +
      'Example: /api/orderbook?q=bitcoin, /api/orderbook?slug=will-bitcoin-hit-100k, ' +
      '/api/orderbook?tokenId=0xabc...',
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/orderbook
 *
 * Fetch full L2/L3 orderbook analytics for a single CLOB token.
 * Supports three lookup modes:
 *
 *   ?tokenId=<hex>        — raw CLOB token ID (hex string from clobTokenIds)
 *   ?slug=<eventSlug>     — Polymarket event slug (auto-picks first market/token)
 *   ?q=<search query>     — plain-text search (e.g. "bitcoin", "US election", "Giants")
 *
 * Examples:
 *   /api/orderbook?q=bitcoin
 *   /api/orderbook?q=san francisco giants
 *   /api/orderbook?slug=will-bitcoin-hit-100k-in-2025
 *   /api/orderbook?tokenId=71321045679252212594626385532706912750332728571942532289631379312455583992563
 *
 * For multi-market events with full L2/L3 breakdown use:
 *   /api/events/{slug}/orderbook
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<OrderBookAnalytics & { resolvedVia?: string }>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  try {
    const resolved = await resolveTokenId(
      req.query.tokenId as string | undefined,
      req.query.slug as string | undefined,
      req.query.q as string | undefined
    )

    if ('error' in resolved) {
      return res.status(400).json(createErrorResponse(resolved.error))
    }

    const { tokenId, resolvedVia } = resolved

    const cacheKey = CacheKeys.orderbookAnalytics(tokenId)
    const cachedResult = cache.get<OrderBookAnalytics>(cacheKey)
    if (cachedResult) {
      return res.status(200).json(
        createSuccessResponse({ ...cachedResult, resolvedVia })
      )
    }

    // Fetch orderbook, recent trades, and price history in parallel
    const [bookRes, tradesRes, pricesRes] = await Promise.allSettled([
      polymarketAPI.getOrderBook(tokenId),
      polymarketAPI.getTrades({ market: tokenId, limit: 200 }),
      polymarketAPI.getPriceHistory({ tokenId, interval: '1d' }),
    ])

    const book = bookRes.status === 'fulfilled' ? bookRes.value : null
    if (!book) {
      return res.status(503).json(createErrorResponse('Orderbook unavailable'))
    }
    const trades = tradesRes.status === 'fulfilled' ? tradesRes.value : []
    const priceHistory = pricesRes.status === 'fulfilled' ? pricesRes.value : []

    // Get previous snapshot for change detection
    const snapshotKey = `ob-snapshot:${tokenId}`
    const previousSnapshot = cache.get<ReturnType<typeof createOrderBookSnapshot>>(snapshotKey)

    // Compute analytics
    const analytics = computeOrderBookAnalytics(book, trades, priceHistory, previousSnapshot)

    // Store current snapshot for next comparison
    const currentSnapshot = createOrderBookSnapshot(book)
    cache.set(snapshotKey, currentSnapshot, 600_000) // 10 min

    // Cache analytics
    cache.set(cacheKey, analytics, CACHE_TTL.PRICE_DATA)

    return res.status(200).json(
      createSuccessResponse({ ...analytics, resolvedVia })
    )
  } catch (error) {
    console.error('Orderbook analytics error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}

