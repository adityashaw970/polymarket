import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../../../polymarket-api'
import { computeOrderBookAnalytics, createOrderBookSnapshot } from '@/orderbook-analytics'
import { cache } from '../../../../cache'
import { createSuccessResponse, createErrorResponse, pLimit } from '../../../../utils'
import { APIResponse, GammaEvent, GammaMarket, OrderBookAnalytics } from '../../../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a URL slug like "san-francisco-giants" → "san francisco giants" */
function slugToWords(slug: string): string {
  return slug.replace(/-/g, ' ').trim()
}

/** Deduplicate events by slug (Gamma API can return the same event twice) */
function dedupeEvents(events: GammaEvent[]): GammaEvent[] {
  const seen = new Set<string>()
  return events.filter(e => {
    if (seen.has(e.slug)) return false
    seen.add(e.slug)
    return true
  })
}

// ── Orderbook analytics helper ────────────────────────────────────────────────

async function fetchOrderbookAnalytics(
  market: GammaMarket
): Promise<OrderBookAnalytics | null> {
  if (!market.clobTokenIds || market.clobTokenIds.length === 0) return null

  const tokenId = market.clobTokenIds[0]
  const timeoutMs = 5_000
  let timer: NodeJS.Timeout | undefined

  try {
    const fetchPromise = Promise.all([
      polymarketAPI.getOrderBook(tokenId),
      polymarketAPI.getTrades({ market: market.conditionId || market.id, limit: 200 }),
      polymarketAPI.getPriceHistory({ tokenId, interval: '1d' }),
    ])

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    })

    const [book, trades, priceHistory] = await Promise.race([fetchPromise, timeoutPromise])
    if (timer) clearTimeout(timer)

    const snapshotKey = `ob-snapshot:${tokenId}`
    const previousSnapshot = cache.get<ReturnType<typeof createOrderBookSnapshot>>(snapshotKey)

    const analytics = computeOrderBookAnalytics(book, trades, priceHistory, previousSnapshot)

    // Store snapshot for next diff
    cache.set(snapshotKey, createOrderBookSnapshot(book), 600_000)

    return analytics
  } catch {
    if (timer) clearTimeout(timer)
    return null
  }
}

function scoreEvent(e: GammaEvent, teamWords: string, sportWords: string): number {
  let score = 0
  const slug = e.slug.toLowerCase()
  const title = e.title.toLowerCase()
  const desc = (e.description ?? '').toLowerCase()

  const teamKw = teamWords.toLowerCase()
  const sportKw = sportWords.toLowerCase()
  const teamKwWords = teamKw.split(/\s+/).filter(w => w.length > 2)

  // Team-specific scoring (highest priority)
  if (slug === teamKw || slug === teamKw.replace(/\s+/g, '-')) score += 200
  if (title.startsWith(teamKw)) score += 150
  if (slug.includes(teamKw.replace(/\s+/g, '-'))) score += 100
  if (title.includes(teamKw)) score += 80

  // Individual team word matches (e.g. "lakers", "giants")
  for (const word of teamKwWords) {
    if (slug.includes(word)) score += 40
    if (title.includes(word)) score += 30
    if (desc.includes(word)) score += 8
  }
  // All team words matched bonus
  if (teamKwWords.length > 1 && teamKwWords.every(w => title.includes(w) || slug.includes(w))) {
    score += 50
  }

  // Sport context (lower weight — just a tiebreaker)
  if (slug.includes(sportKw) || title.includes(sportKw)) score += 10

  // Active markets are preferred
  if (e.active && !e.closed) score += 20

  // Volume bonus (log-scaled)
  if (e.volumeAll > 0) score += Math.min(30, Math.log10(e.volumeAll + 1) * 5)

  return score
}

// ── Response shape ────────────────────────────────────────────────────────────

interface MarketWithAnalytics {
  marketId: string
  title: string
  question: string
  outcomes: string[]
  active: boolean
  closed: boolean
  volume24hr: number
  volumeAll: number
  liquidity: number
  endDate: string
  clobTokenIds: string[]
  orderbookAnalytics: OrderBookAnalytics | null
  orderbookAnalyticsGrouped: OrderBookAnalyticsGrouped | null
}

interface OrderBookAnalyticsGrouped {
  spread: {
    bestBid: number
    bestAsk: number
    spread: number
    spreadPercent: number
    midpoint: number
    weightedMidPrice: number
  }
  depth: {
    bidAskImbalance: number
    totalBidSize: number
    totalAskSize: number
    bidDepth5: number
    askDepth5: number
    bidDepth10: number
    askDepth10: number
    bidLevels: number
    askLevels: number
    supportLevels: unknown[]
    resistanceLevels: unknown[]
  }
  orderFlow: {
    netOrderFlow: number
    buyVolume: number
    sellVolume: number
    tradeCount: number
    avgTradeSize: number
    ordersPerMinute: number
    newOrdersPerSecond: number
    executionSpeedSeconds: number
    executionSpeedTradesPerSecond: number
  }
  slippage: {
    buy: { usd100: number; usd500: number; usd1000: number; usd5000: number }
    sell: { usd100: number; usd500: number; usd1000: number; usd5000: number }
    description: string
  }
  whaleActivity: {
    score: number
    orders: unknown[]
    description: string
  }
  patterns: {
    spoofingScore: number
    marketMakerScore: number
    spoofingRisk: string
    marketMakerPresence: string
  }
  prediction: {
    nextTickUpProbability: number
    nextTickDownProbability: number
    bias: string
    confidence: string
  }
  volatility: {
    realized: number
    implied: number
    forecast: number
    regime: string
  }
  liquidity: {
    score: number
    change: number
    hiddenLiquidityEstimate: number
    assessment: string
  }
  cancellations: {
    count: number
    volume: number
    suspicionLevel: string
  }
}

function groupAnalytics(a: OrderBookAnalytics): OrderBookAnalyticsGrouped {
  // Spoofing risk label
  const spoofRisk =
    a.spoofingScore >= 70 ? 'HIGH' :
    a.spoofingScore >= 40 ? 'MEDIUM' : 'LOW'

  // Market maker presence
  const mmPresence =
    a.marketMakerScore >= 70 ? 'STRONG' :
    a.marketMakerScore >= 40 ? 'MODERATE' : 'WEAK'

  // Price direction bias
  const upProb = a.nextTickUpProbability
  const bias = upProb > 0.6 ? 'BULLISH' : upProb < 0.4 ? 'BEARISH' : 'NEUTRAL'
  const conf = Math.abs(upProb - 0.5) > 0.15 ? 'HIGH' : Math.abs(upProb - 0.5) > 0.07 ? 'MEDIUM' : 'LOW'

  // Volatility regime
  const volRegime =
    a.volatilityForecast > 10 ? 'HIGH_VOLATILITY' :
    a.volatilityForecast > 4 ? 'MODERATE_VOLATILITY' : 'LOW_VOLATILITY'

  // Liquidity assessment
  const liqAssess =
    a.liquidityScore >= 70 ? 'EXCELLENT' :
    a.liquidityScore >= 50 ? 'GOOD' :
    a.liquidityScore >= 30 ? 'MODERATE' : 'THIN'

  // Cancellation suspicion
  const cancelSuspicion =
    a.cancellationCount >= 10 ? 'HIGH' :
    a.cancellationCount >= 3 ? 'MEDIUM' : 'LOW'

  return {
    spread: {
      bestBid: a.bestBid,
      bestAsk: a.bestAsk,
      spread: a.spread,
      spreadPercent: a.spreadPercent,
      midpoint: a.midpoint,
      weightedMidPrice: a.weightedMidPrice,
    },
    depth: {
      bidAskImbalance: a.bidAskImbalance,
      totalBidSize: a.totalBidSize,
      totalAskSize: a.totalAskSize,
      bidDepth5: a.bidDepth5,
      askDepth5: a.askDepth5,
      bidDepth10: a.bidDepth10,
      askDepth10: a.askDepth10,
      bidLevels: a.bidLevels,
      askLevels: a.askLevels,
      supportLevels: a.supportLevels,
      resistanceLevels: a.resistanceLevels,
    },
    orderFlow: {
      netOrderFlow: a.netOrderFlow,
      buyVolume: a.buyVolume,
      sellVolume: a.sellVolume,
      tradeCount: a.tradeCount,
      avgTradeSize: a.avgTradeSize,
      ordersPerMinute: a.ordersPerMinute,
      newOrdersPerSecond: a.newOrdersPerSecond,
      executionSpeedSeconds: a.executionSpeedSeconds,
      executionSpeedTradesPerSecond: a.executionSpeedTradesPerSecond,
    },
    slippage: {
      buy: {
        usd100: a.slippage100,
        usd500: a.slippage500,
        usd1000: a.slippage1000,
        usd5000: a.slippage5000,
      },
      sell: {
        usd100: a.sellSlippage100,
        usd500: a.sellSlippage500,
        usd1000: a.sellSlippage1000,
        usd5000: a.sellSlippage5000,
      },
      description: 'Slippage % relative to best price when walking the book',
    },
    whaleActivity: {
      score: a.whaleActivity,
      orders: a.whaleOrders,
      description: 'Orders >2 standard deviations above mean size',
    },
    patterns: {
      spoofingScore: a.spoofingScore,
      marketMakerScore: a.marketMakerScore,
      spoofingRisk: spoofRisk,
      marketMakerPresence: mmPresence,
    },
    prediction: {
      nextTickUpProbability: a.nextTickUpProbability,
      nextTickDownProbability: a.nextTickDownProbability,
      bias,
      confidence: conf,
    },
    volatility: {
      realized: a.realizedVolatility,
      implied: a.impliedVolatility,
      forecast: a.volatilityForecast,
      regime: volRegime,
    },
    liquidity: {
      score: a.liquidityScore,
      change: a.liquidityChange,
      hiddenLiquidityEstimate: a.hiddenLiquidityEstimate,
      assessment: liqAssess,
    },
    cancellations: {
      count: a.cancellationCount,
      volume: a.cancellationVolume,
      suspicionLevel: cancelSuspicion,
    },
  }
}

interface TeamsResponse {
  sport: string
  team: string
  query: string
  eventsFound: number
  events: Array<{
    slug: string
    title: string
    description: string
    active: boolean
    closed: boolean
    volume24hr: number
    volumeAll: number
    liquidity: number
    endDate: string
    analysisUrl: string
    orderbookUrl: string
    markets: MarketWithAnalytics[]
  }>
  hint: string
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/teams/[sport]/[team]
 *
 * Resolves any sport/team combination to matching Polymarket events and returns
 * full L2/L3 orderbook analytics for each market.
 *
 * Examples:
 *   /api/teams/mlb/san-francisco-giants
 *   /api/teams/nba/lakers
 *   /api/teams/nfl/chiefs
 *   /api/teams/politics/us-election
 *   /api/teams/crypto/bitcoin
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<TeamsResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  const { sport, team } = req.query as { sport: string; team: string }

  if (!sport || !team) {
    return res.status(400).json(createErrorResponse('Missing sport or team parameter'))
  }

  const sportWords = slugToWords(sport)
  const teamWords = slugToWords(team)
  // Build a compound query: "san francisco giants mlb" gives best results
  const query = `${teamWords} ${sportWords}`.trim()

  const withAnalytics = req.query.analytics !== 'false'

  try {
    // ── 1. Multi-strategy event search with relevance scoring ──────────────

    const teamKw = teamWords.toLowerCase()
    const sportKw = sportWords.toLowerCase()
    const teamKwWords = teamKw.split(/\s+/).filter(w => w.length > 2)

    // Fetch active events + closed events in parallel
    const [activeResult, closedResult] = await Promise.allSettled([
      polymarketAPI.getEvents({ limit: 200, active: true, closed: false, orderBy: 'volumeAll', ascending: false }),
      polymarketAPI.getEvents({ limit: 100, closed: true, orderBy: 'volumeAll', ascending: false }),
    ])

    const allBrowsed: GammaEvent[] = []
    if (activeResult.status === 'fulfilled') allBrowsed.push(...activeResult.value.events)
    if (closedResult.status === 'fulfilled') allBrowsed.push(...closedResult.value.events)

    // Score and filter
    const scored = allBrowsed
      .map(e => ({ event: e, score: scoreEvent(e, teamWords, sportWords) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    const events = dedupeEvents(scored.map(({ event }) => event))

    if (events.length === 0) {
      return res.status(200).json(
        createSuccessResponse({
          sport: sportWords,
          team: teamWords,
          query,
          eventsFound: 0,
          events: [],
          hint:
            `No Polymarket markets found for "${query}". ` +
            `This team may not have any current or recent markets. ` +
            `Try /api/search?q=${encodeURIComponent(teamWords)} or ` +
            `/api/events/browse?q=${encodeURIComponent(teamWords)} to browse all events.`,
        })
      )
    }

    // ── 2. For each event, fetch markets + optional orderbook analytics ────

    const enrichedEvents = await Promise.all(
      events.slice(0, 5).map(async (event) => {
        const markets = event.groupedMarkets ?? []

        const marketsWithAnalytics: MarketWithAnalytics[] = await pLimit(
          markets.slice(0, 6).map((market) => async () => {
            const analytics = withAnalytics
              ? await fetchOrderbookAnalytics(market)
              : null

            return {
              marketId: market.id,
              title: market.title,
              question: market.question,
              outcomes: market.outcomes,
              active: market.active,
              closed: market.closed,
              volume24hr: market.volume24hr,
              volumeAll: market.volumeAll,
              liquidity: market.liquidity,
              endDate: market.endDate,
              clobTokenIds: market.clobTokenIds,
              orderbookAnalytics: analytics,
              orderbookAnalyticsGrouped: analytics ? groupAnalytics(analytics) : null,
            }
          }),
          3
        )

        return {
          slug: event.slug,
          title: event.title,
          description: event.description,
          active: event.active,
          closed: event.closed,
          volume24hr: event.volume24hr,
          volumeAll: event.volumeAll,
          liquidity: event.liquidity,
          endDate: event.endDate,
          analysisUrl: `/api/events/${event.slug}/analysis`,
          orderbookUrl: `/api/events/${event.slug}/orderbook`,
          markets: marketsWithAnalytics,
        }
      })
    )

    return res.status(200).json(
      createSuccessResponse({
        sport: sportWords,
        team: teamWords,
        query,
        eventsFound: events.length,
        events: enrichedEvents,
        hint:
          `Found ${events.length} event(s) for "${query}". ` +
          `Use ?analytics=false to skip orderbook computation for faster results. ` +
          `Each market includes full L2/L3 analytics: bid/ask imbalance, depth, ` +
          `order flow, whale detection, spoofing patterns, slippage, and volatility.`,
      })
    )
  } catch (error) {
    console.error(`[teams/${sport}/${team}] Error:`, error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
