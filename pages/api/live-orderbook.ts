import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../polymarket-api'
import { computeOrderBookAnalytics, createOrderBookSnapshot } from '@/orderbook-analytics'
import { cache, CacheKeys, CACHE_TTL } from '../../cache'
import { createSuccessResponse, createErrorResponse, pLimit } from '../../utils'
import { APIResponse, GammaEvent, OrderBook, OrderBookAnalytics, CLOBPrice } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveTokenData {
  tokenId: string
  outcomeIndex: number
  outcomeName: string
  analytics: OrderBookAnalytics | null
  bookSnapshot: {
    bids: { price: number; size: number }[]
    asks: { price: number; size: number }[]
    bidLevels: number
    askLevels: number
  } | null
  hasLiveBook: boolean
}

interface LiveMarketData {
  marketId: string
  conditionId: string
  title: string
  question: string
  outcomes: string[]
  active: boolean
  closed: boolean
  volume24hr: number
  volumeAll: number
  liquidity: number
  endDate: string
  tokens: LiveTokenData[]
}

export interface LiveOrderbookResponse {
  eventSlug: string
  eventTitle: string
  eventDescription: string
  active: boolean
  closed: boolean
  computedAt: string
  resolvedVia: string
  markets: LiveMarketData[]
  summary: {
    totalMarkets: number
    activeMarkets: number
    totalTokensAnalyzed: number
    hasLiveData: boolean
    overallBidAskImbalance: number | null
    overallNextTickUp: number | null
    overallWhaleActivity: number | null
    overallLiquidityScore: number | null
    overallVolatilityForecast: number | null
  }
  tip: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a Polymarket URL to extract the event slug */
function extractSlugFromUrl(input: string): string | null {
  try {
    // Handle full URLs like https://polymarket.com/event/slug-here or /event/slug-here
    const urlPattern = /polymarket\.com\/event\/([a-z0-9-]+)/i
    const match = input.match(urlPattern)
    if (match?.[1]) return match[1]

    // Handle relative paths like /event/slug
    const pathPattern = /^\/event\/([a-z0-9-]+)/i
    const pathMatch = input.match(pathPattern)
    if (pathMatch?.[1]) return pathMatch[1]

    // Handle raw URL parsing
    const url = new URL(input.startsWith('http') ? input : `https://${input}`)
    const segments = url.pathname.split('/').filter(Boolean)
    const eventIdx = segments.indexOf('event')
    if (eventIdx >= 0 && segments[eventIdx + 1]) {
      return segments[eventIdx + 1]
    }
  } catch {
    // Not a valid URL, skip
  }
  return null
}

/** Score events by keyword relevance */
function scoreEvent(event: GammaEvent, kw: string): number {
  const k = kw.toLowerCase()
  const slug = event.slug.toLowerCase()
  const title = event.title.toLowerCase()
  const desc = (event.description ?? '').toLowerCase().slice(0, 300)

  let score = 0
  if (slug === k || slug === k.replace(/\s+/g, '-')) score += 120
  if (title.startsWith(k)) score += 90
  if (slug.includes(k.replace(/\s+/g, '-')) || slug.includes(k)) score += 70
  if (title.includes(k)) score += 55

  const words = k.split(/\s+/).filter(w => w.length > 2)
  for (const word of words) {
    if (slug.includes(word)) score += 18
    if (title.includes(word)) score += 14
    if (desc.includes(word)) score += 6
  }
  if (words.length > 1 && words.every(w => title.includes(w))) score += 30

  // Boost active events
  if (event.active && !event.closed) score += 20

  return score
}

/** Try to fetch an orderbook — returns null if the market is closed/unavailable */
async function tryFetchBook(tokenId: string): Promise<OrderBook | null> {
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



/** Analyze a single token — wraps everything in try/catch to never throw. */
async function analyzeToken(
  tokenId: string,
  outcomeIndex: number,
  outcomeName: string,
  conditionId: string
): Promise<LiveTokenData> {
  const defaultResult: LiveTokenData = {
    tokenId,
    outcomeIndex,
    outcomeName,
    analytics: null,
    bookSnapshot: null,
    hasLiveBook: false,
  }

  try {
    // ── Check caches first ─────────────────────────────────────────────────────
    const tradesCacheKey = `trades-mkt:${conditionId}`
    const priceCacheKey  = `prices-1d:${tokenId}`
    const snapshotKey    = `ob-snapshot:${tokenId}`

    const cachedTrades   = cache.get<Awaited<ReturnType<typeof polymarketAPI.getTrades>>>(tradesCacheKey)
    const cachedPrices   = cache.get<CLOBPrice[]>(priceCacheKey)

    // ✅ Short timeout race: return [] if prices-history is too slow (volatility falls back to 0)
    const PRICE_TIMEOUT_MS = 3_000
    const priceHistoryPromise = cachedPrices
      ? Promise.resolve(cachedPrices)
      : Promise.race([
          polymarketAPI.getPriceHistory({ tokenId, interval: '1h', fidelity: 10 }),
          new Promise<CLOBPrice[]>(resolve => setTimeout(() => resolve([]), PRICE_TIMEOUT_MS))
        ])

    // ✅ Use allSettled so a timeout on trades/prices doesn't kill the whole token
    const [bookResult, tradesResult, priceResult] = await Promise.allSettled([
      tryFetchBook(tokenId),
      cachedTrades ? Promise.resolve(cachedTrades) : polymarketAPI.getTrades({ market: conditionId, limit: 100 }),
      priceHistoryPromise,
    ])

    const book         = bookResult.status   === 'fulfilled' ? bookResult.value   : null
    const trades       = tradesResult.status === 'fulfilled' ? tradesResult.value : []
    const priceHistory = priceResult.status  === 'fulfilled' ? priceResult.value  : []

    // Cache whatever succeeded
    if (tradesResult.status === 'fulfilled' && !cachedTrades) {
      cache.set(tradesCacheKey, trades, 30_000)
    }
    if (priceResult.status === 'fulfilled' && !cachedPrices) {
      cache.set(priceCacheKey, priceHistory, 30_000)
    }

    if (!book) {
      return defaultResult
    }

    const previousSnapshot = cache.get<ReturnType<typeof createOrderBookSnapshot>>(snapshotKey)
    const analytics = computeOrderBookAnalytics(book, trades, priceHistory, previousSnapshot)
    cache.set(snapshotKey, createOrderBookSnapshot(book), 600_000)

    return {
      tokenId,
      outcomeIndex,
      outcomeName,
      analytics,
      bookSnapshot: {
        bids: book.bids.slice(0, 20),
        asks: book.asks.slice(0, 20),
        bidLevels: book.bids.length,
        askLevels: book.asks.length,
      },
      hasLiveBook: true,
    }
  } catch (err) {
    console.error(`[analyzeToken] Error analyzing token ${tokenId}:`, err)
    return defaultResult
  }
}

// ── Resolve slug ──────────────────────────────────────────────────────────────

async function resolveToSlug(
  qParam: string | undefined,
  slugParam: string | undefined,
  urlParam: string | undefined
): Promise<{ slug: string; resolvedVia: string } | { error: string }> {
  // Mode 1: Raw slug
  if (slugParam) {
    return { slug: slugParam, resolvedVia: `slug:${slugParam}` }
  }

  // Mode 2: Full URL (parse slug out of it)
  if (urlParam) {
    const extracted = extractSlugFromUrl(urlParam)
    if (extracted) return { slug: extracted, resolvedVia: `url:${extracted}` }
    // Maybe urlParam is itself a bare slug (no slashes, no dots)
    if (/^[a-z0-9-]+$/.test(urlParam)) {
      return { slug: urlParam, resolvedVia: `slug:${urlParam}` }
    }
    return { error: `Could not extract an event slug from URL: "${urlParam}". Expected format: https://polymarket.com/event/event-slug` }
  }

  // Mode 3: Keyword search
  if (qParam) {
    const kw = qParam.trim()

    const [activeResult, closedResult] = await Promise.allSettled([
      polymarketAPI.getEvents({ limit: 200, active: true, closed: false, orderBy: 'volumeAll', ascending: false }),
      polymarketAPI.getEvents({ limit: 100, closed: true, orderBy: 'volumeAll', ascending: false }),
    ])

    const allEvents: GammaEvent[] = []
    if (activeResult.status === 'fulfilled') allEvents.push(...activeResult.value.events)
    if (closedResult.status === 'fulfilled') allEvents.push(...closedResult.value.events)

    const scored = allEvents
      .map(e => ({ event: e, score: scoreEvent(e, kw) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      return {
        error: `No events found for "${kw}". Try /api/search?q=${encodeURIComponent(kw)} for suggestions.`,
      }
    }

    const best = scored[0].event
    return { slug: best.slug, resolvedVia: `search:${best.slug}` }
  }

  return {
    error:
      'Provide one of: ?q=<search term>, ?slug=<event-slug>, or ?url=<polymarket.com/event/...>. ' +
      'Examples: ?q=bitcoin, ?slug=will-bitcoin-hit-150k, ?url=https://polymarket.com/event/will-trump-win-2024',
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/live-orderbook
 *
 * Unified real-time orderbook analytics for ANY Polymarket event.
 * Accepts events by search keyword, slug, or full Polymarket URL.
 *
 * Query params:
 *   ?q=<keyword>          — e.g. "bitcoin", "US election", "NBA finals"
 *   ?slug=<event-slug>    — e.g. "will-bitcoin-hit-150k"
 *   ?url=<full-url>       — e.g. "https://polymarket.com/event/will-trump-win-2024"
 *   ?markets=<n>          — max markets to analyze (default 3, max 6)
 *
 * Returns 15+ analytics per active token:
 *   bid/ask imbalance, market depth, order flow, cancellations,
 *   new orders per second, execution speed, hidden liquidity,
 *   whale activity, spoofing patterns, market maker behavior,
 *   support/resistance, next tick probability, slippage, liquidity, volatility
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<LiveOrderbookResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  // CORS + caching headers — allow stale-while-revalidate to serve cached
  // responses instantly while a fresh fetch runs in the background
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=5')

  const maxMarkets = Math.min(50, Math.max(1, Number.parseInt((req.query.markets as string) || '50', 10)))

  // Resolve to an event slug
  const resolved = await resolveToSlug(
    req.query.q as string | undefined,
    req.query.slug as string | undefined,
    req.query.url as string | undefined
  )

  if ('error' in resolved) {
    return res.status(400).json(createErrorResponse(resolved.error))
  }

  const { slug, resolvedVia } = resolved

  // Check cache (short TTL for real-time feel)
  const cacheKey = `live-ob:${slug}:m${maxMarkets}`
  const cached = cache.get<LiveOrderbookResponse>(cacheKey)
  if (cached) {
    return res.status(200).json(createSuccessResponse(cached))
  }

  try {
    // Resolve event
    const event = await polymarketAPI.getEvent(slug)
    if (!event) {
      return res.status(404).json(
        createErrorResponse(
          `Event "${slug}" not found. Use /api/search?q=<keyword> to find valid event slugs.`
        )
      )
    }

    const markets = (event.groupedMarkets ?? []).slice(0, maxMarkets)
    if (markets.length === 0) {
      return res.status(404).json(
        createErrorResponse(`Event "${event.title}" has no tradeable markets.`)
      )
    }

    // Build flat task list: each task = one token analysis
    type TokenTask = { market: typeof markets[0]; tokenId: string; idx: number }
    const tokenTasks: TokenTask[] = []
    for (const market of markets) {
      const tokenIds = (market.clobTokenIds ?? []).slice(0, 4)
      tokenIds.forEach((tokenId, idx) => tokenTasks.push({ market, tokenId, idx }))
    }

    // Run with max 5 concurrent CLOB requests across all tokens
    const tokenResults = await pLimit(
      tokenTasks.map(({ market, tokenId, idx }) => () =>
        analyzeToken(
          tokenId,
          idx,
          market.outcomes?.[idx] ?? `Outcome ${idx}`,
          market.conditionId || market.id
        )
      ),
      5 // max 5 concurrent CLOB requests
    )

    // Reassemble into per-market structure, wrapping each in try/catch for safety
    const marketResults: LiveMarketData[] = markets.map((market) => {
      try {
        const tokens = tokenResults.filter((_, i) =>
          tokenTasks[i].market.id === market.id
        )
        return {
          marketId: market.id,
          conditionId: market.conditionId,
          title: market.title,
          question: market.question,
          outcomes: market.outcomes ?? [],
          active: market.active,
          closed: market.closed,
          volume24hr: market.volume24hr ?? 0,
          volumeAll: market.volumeAll ?? 0,
          liquidity: market.liquidity ?? 0,
          endDate: market.endDate,
          tokens,
        }
      } catch (err) {
        console.warn(`[live-orderbook] market ${market.id} failed:`, err)
        return {
          marketId: market.id,
          conditionId: market.conditionId,
          title: market.title,
          question: market.question,
          outcomes: market.outcomes ?? [],
          active: market.active,
          closed: market.closed,
          volume24hr: 0,
          volumeAll: 0,
          liquidity: 0,
          endDate: market.endDate,
          tokens: [],
        }
      }
    })

    // ── Build summary ──────────────────────────────────────────────────────
    const allTokens = marketResults.flatMap(m => m.tokens)
    const liveTokens = allTokens.filter(t => t.hasLiveBook && t.analytics)
    const totalTokensAnalyzed = liveTokens.length
    const hasLiveData = totalTokensAnalyzed > 0

    const avgOf = (fn: (a: OrderBookAnalytics) => number): number | null => {
      if (liveTokens.length === 0) return null
      return liveTokens.reduce((s, t) => s + fn(t.analytics!), 0) / liveTokens.length
    }

    const activeMarkets = marketResults.filter(m => m.active && !m.closed).length

    const response: LiveOrderbookResponse = {
      eventSlug: event.slug,
      eventTitle: event.title,
      eventDescription: event.description ?? '',
      active: event.active,
      closed: event.closed,
      computedAt: new Date().toISOString(),
      resolvedVia,
      markets: marketResults,
      summary: {
        totalMarkets: markets.length,
        activeMarkets,
        totalTokensAnalyzed,
        hasLiveData,
        overallBidAskImbalance: avgOf(a => a.bidAskImbalance),
        overallNextTickUp: avgOf(a => a.nextTickUpProbability),
        overallWhaleActivity: avgOf(a => a.whaleActivity),
        overallLiquidityScore: avgOf(a => a.liquidityScore),
        overallVolatilityForecast: avgOf(a => a.volatilityForecast),
      },
      tip: hasLiveData
        ? `Live data for ${totalTokensAnalyzed} token(s). Each market's tokens[] has full analytics.`
        : `Event found but all ${markets.length} market(s) are closed — no live CLOB orderbooks available.`,
    }

    // Cache for 1 second — prevents CLOB API hammering during rapid UI polls
    cache.set(cacheKey, response, 1_000)

    return res.status(200).json(createSuccessResponse(response))
  } catch (error) {
    console.error(`[live-orderbook/${slug}] Error:`, error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
