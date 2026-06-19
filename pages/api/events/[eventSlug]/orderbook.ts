import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../../../polymarket-api'
import { computeOrderBookAnalytics, createOrderBookSnapshot } from '@/orderbook-analytics'
import { cache, CacheKeys, CACHE_TTL } from '../../../../cache'
import { createSuccessResponse, createErrorResponse } from '../../../../utils'
import {
  APIResponse,
  GammaMarket,
  OrderBook,
  OrderBookAnalytics,
  PriceLevel,
  PriceSizeLevel,
  WhaleOrder,
} from '../../../../types'

// ── Grouped analytics types ──────────────────────────────────────────────────

export interface OrderBookAnalyticsGrouped {
  /** Raw L2 book snapshot */
  book: {
    tokenId: string
    timestamp: number
    bids: PriceLevel[]
    asks: PriceLevel[]
    bidLevels: number
    askLevels: number
  }

  /** Spread / pricing */
  spread: {
    bestBid: number
    bestAsk: number
    spread: number
    spreadPercent: number
    midpoint: number
    weightedMidPrice: number
    label: string
  }

  /** Market depth */
  depth: {
    bidAskImbalance: number         // -1 (all asks) to +1 (all bids)
    imbalanceLabel: string
    totalBidSize: number
    totalAskSize: number
    bidDepth5: number               // top-5 bid levels total size
    askDepth5: number
    bidDepth10: number              // top-10 bid levels total size
    askDepth10: number
    supportLevels: PriceSizeLevel[] // clustered bid price zones
    resistanceLevels: PriceSizeLevel[] // clustered ask price zones
  }

  /** Order flow (from recent trades) */
  orderFlow: {
    netOrderFlow: number            // positive = more buy pressure
    buyVolume: number
    sellVolume: number
    tradeCount: number
    avgTradeSize: number
    ordersPerMinute: number
    newOrdersPerSecond: number      // L3 equivalent
    executionSpeedSeconds: number   // avg seconds between trades
    executionSpeedTradesPerSecond: number
    flowBias: 'BUY_DOMINANT' | 'SELL_DOMINANT' | 'BALANCED'
  }

  /** Expected slippage at various sizes */
  slippage: {
    buy: {
      usd100: number
      usd500: number
      usd1000: number
      usd5000: number
    }
    sell: {
      usd100: number
      usd500: number
      usd1000: number
      usd5000: number
    }
    note: string
  }

  /** Whale / large-order detection */
  whaleActivity: {
    score: number                   // 0-100
    scoreLabel: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME'
    orders: WhaleOrder[]            // orders >2σ above mean size
    description: string
  }

  /** Spoofing & market-maker pattern detection */
  patterns: {
    spoofingScore: number           // 0-100
    spoofingRisk: 'LOW' | 'MEDIUM' | 'HIGH'
    marketMakerScore: number        // 0-100
    marketMakerPresence: 'WEAK' | 'MODERATE' | 'STRONG'
    cancellationCount: number
    cancellationVolume: number
    cancellationSuspicion: 'LOW' | 'MEDIUM' | 'HIGH'
  }

  /** Probability of next price tick */
  prediction: {
    nextTickUpProbability: number
    nextTickDownProbability: number
    bias: 'STRONGLY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONGLY_BEARISH'
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    explanation: string
  }

  /** Hidden / iceberg liquidity estimate */
  hiddenLiquidity: {
    estimate: number
    description: string
  }

  /** Volatility */
  volatility: {
    realized: number                // from recent price history (log-returns)
    implied: number                 // inferred from spread + depth
    forecast: number                // blended prediction
    regime: 'LOW_VOLATILITY' | 'MODERATE_VOLATILITY' | 'HIGH_VOLATILITY'
  }

  /** Liquidity score */
  liquidity: {
    score: number                   // 0-100
    assessment: 'THIN' | 'MODERATE' | 'GOOD' | 'EXCELLENT'
    change: number                  // % change vs previous snapshot
    trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING'
  }
}

// ── Full response ────────────────────────────────────────────────────────────

interface MarketOrderbookResult {
  marketId: string
  conditionId: string
  title: string
  question: string
  outcomes: string[]
  clobTokenIds: string[]
  active: boolean
  closed: boolean
  volume24hr: number
  volumeAll: number
  liquidity: number
  endDate: string
  tokens: TokenOrderbook[]
}

interface TokenOrderbook {
  tokenId: string
  outcomeIndex: number
  raw: OrderBookAnalytics
  grouped: OrderBookAnalyticsGrouped
}

interface EventOrderbookResponse {
  eventSlug: string
  eventTitle: string
  eventDescription: string
  active: boolean
  closed: boolean
  computedAt: string
  markets: MarketOrderbookResult[]
  summary: {
    totalMarkets: number
    totalTokensAnalyzed: number
    overallBias: string
    highestWhaleActivity: number
    avgLiquidityScore: number
    avgSpread: number
    tip: string
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelImbalance(imbalance: number): string {
  if (imbalance > 0.5) return 'HEAVILY_BID_DOMINATED'
  if (imbalance > 0.2) return 'BID_DOMINATED'
  if (imbalance > 0.05) return 'SLIGHTLY_BID_HEAVY'
  if (imbalance < -0.5) return 'HEAVILY_ASK_DOMINATED'
  if (imbalance < -0.2) return 'ASK_DOMINATED'
  if (imbalance < -0.05) return 'SLIGHTLY_ASK_HEAVY'
  return 'BALANCED'
}

function labelSpread(spread: number, midpoint: number): string {
  const pct = midpoint > 0 ? (spread / midpoint) * 100 : 0
  if (pct < 1) return 'VERY_TIGHT'
  if (pct < 3) return 'TIGHT'
  if (pct < 7) return 'NORMAL'
  if (pct < 15) return 'WIDE'
  return 'VERY_WIDE'
}

function labelWhaleScore(score: number): 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' {
  if (score === 0) return 'NONE'
  if (score < 20) return 'LOW'
  if (score < 50) return 'MODERATE'
  if (score < 75) return 'HIGH'
  return 'EXTREME'
}

function labelBias(up: number): 'STRONGLY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONGLY_BEARISH' {
  if (up >= 0.75) return 'STRONGLY_BULLISH'
  if (up >= 0.6) return 'BULLISH'
  if (up <= 0.25) return 'STRONGLY_BEARISH'
  if (up <= 0.4) return 'BEARISH'
  return 'NEUTRAL'
}

function labelConfidence(up: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  const delta = Math.abs(up - 0.5)
  if (delta > 0.2) return 'HIGH'
  if (delta > 0.1) return 'MEDIUM'
  return 'LOW'
}

function buildExplanation(up: number, imbalance: number, netFlow: number): string {
  const parts: string[] = []
  if (imbalance > 0.1) parts.push(`bid-side pressure (imbalance ${(imbalance * 100).toFixed(1)}%)`)
  else if (imbalance < -0.1) parts.push(`ask-side pressure (imbalance ${(imbalance * 100).toFixed(1)}%)`)
  if (netFlow > 0) parts.push(`positive net order flow (+${netFlow.toFixed(0)} USD)`)
  else if (netFlow < 0) parts.push(`negative net order flow (${netFlow.toFixed(0)} USD)`)
  if (parts.length === 0) return 'Balanced order book with no clear directional signal'
  const dir = up > 0.5 ? 'upward' : 'downward'
  return `${dir.charAt(0).toUpperCase() + dir.slice(1)} bias driven by ${parts.join(' and ')}`
}

function groupAnalytics(a: OrderBookAnalytics, book: OrderBook): OrderBookAnalyticsGrouped {
  const upProb = a.nextTickUpProbability

  const liqChange = a.liquidityChange
  const liqTrend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' =
    liqChange > 5 ? 'IMPROVING' : liqChange < -5 ? 'DETERIORATING' : 'STABLE'

  return {
    book: {
      tokenId: book.tokenId,
      timestamp: book.timestamp,
      bids: book.bids,
      asks: book.asks,
      bidLevels: book.bids.length,
      askLevels: book.asks.length,
    },
    spread: {
      bestBid: a.bestBid,
      bestAsk: a.bestAsk,
      spread: a.spread,
      spreadPercent: a.spreadPercent,
      midpoint: a.midpoint,
      weightedMidPrice: a.weightedMidPrice,
      label: labelSpread(a.spread, a.midpoint),
    },
    depth: {
      bidAskImbalance: a.bidAskImbalance,
      imbalanceLabel: labelImbalance(a.bidAskImbalance),
      totalBidSize: a.totalBidSize,
      totalAskSize: a.totalAskSize,
      bidDepth5: a.bidDepth5,
      askDepth5: a.askDepth5,
      bidDepth10: a.bidDepth10,
      askDepth10: a.askDepth10,
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
      flowBias:
        a.netOrderFlow > 100 ? 'BUY_DOMINANT' :
        a.netOrderFlow < -100 ? 'SELL_DOMINANT' : 'BALANCED',
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
      note: 'Slippage % = cost above best price when walking the order book for that USD size',
    },
    whaleActivity: {
      score: a.whaleActivity,
      scoreLabel: labelWhaleScore(a.whaleActivity),
      orders: a.whaleOrders,
      description:
        a.whaleOrders.length > 0
          ? `${a.whaleOrders.length} whale order(s) detected (>2σ above mean trade size). ` +
            `Largest: ${a.whaleOrders[0]?.size?.toFixed(0)} shares @ ${a.whaleOrders[0]?.price?.toFixed(4)}`
          : 'No significant whale orders detected in recent trades',
    },
    patterns: {
      spoofingScore: a.spoofingScore,
      spoofingRisk:
        a.spoofingScore >= 70 ? 'HIGH' :
        a.spoofingScore >= 40 ? 'MEDIUM' : 'LOW',
      marketMakerScore: a.marketMakerScore,
      marketMakerPresence:
        a.marketMakerScore >= 70 ? 'STRONG' :
        a.marketMakerScore >= 40 ? 'MODERATE' : 'WEAK',
      cancellationCount: a.cancellationCount,
      cancellationVolume: a.cancellationVolume,
      cancellationSuspicion:
        a.cancellationCount >= 10 ? 'HIGH' :
        a.cancellationCount >= 3 ? 'MEDIUM' : 'LOW',
    },
    prediction: {
      nextTickUpProbability: upProb,
      nextTickDownProbability: a.nextTickDownProbability,
      bias: labelBias(upProb),
      confidence: labelConfidence(upProb),
      explanation: buildExplanation(upProb, a.bidAskImbalance, a.netOrderFlow),
    },
    hiddenLiquidity: {
      estimate: a.hiddenLiquidityEstimate,
      description:
        a.hiddenLiquidityEstimate > 0
          ? `Estimated ${a.hiddenLiquidityEstimate.toFixed(0)} hidden shares — ` +
            `executed volume exceeded visible book depth, suggesting iceberg orders`
          : 'No evidence of significant hidden (iceberg) liquidity',
    },
    volatility: {
      realized: a.realizedVolatility,
      implied: a.impliedVolatility,
      forecast: a.volatilityForecast,
      regime:
        a.volatilityForecast > 10 ? 'HIGH_VOLATILITY' :
        a.volatilityForecast > 4 ? 'MODERATE_VOLATILITY' : 'LOW_VOLATILITY',
    },
    liquidity: {
      score: a.liquidityScore,
      assessment:
        a.liquidityScore >= 70 ? 'EXCELLENT' :
        a.liquidityScore >= 50 ? 'GOOD' :
        a.liquidityScore >= 30 ? 'MODERATE' : 'THIN',
      change: a.liquidityChange,
      trend: liqTrend,
    },
  }
}

// ── Main market orderbook fetch ───────────────────────────────────────────────

async function analyzeMarket(market: GammaMarket): Promise<TokenOrderbook[]> {
  if (!market.clobTokenIds || market.clobTokenIds.length === 0) return []

  return Promise.all(
    market.clobTokenIds.map(async (tokenId, idx) => {
      const snapshotKey = `ob-snapshot:${tokenId}`
      const previousSnapshot = cache.get<ReturnType<typeof createOrderBookSnapshot>>(snapshotKey)

      const [book, trades, priceHistory] = await Promise.all([
        polymarketAPI.getOrderBook(tokenId),
        polymarketAPI.getTrades({ market: market.conditionId || market.id, limit: 200 }),
        polymarketAPI.getPriceHistory({ tokenId, interval: '1d' }),
      ])

      const raw = computeOrderBookAnalytics(book, trades, priceHistory, previousSnapshot)
      const grouped = groupAnalytics(raw, book)

      // Save snapshot for next diff
      cache.set(snapshotKey, createOrderBookSnapshot(book), 600_000)

      return {
        tokenId,
        outcomeIndex: idx,
        raw,
        grouped,
      }
    })
  )
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/events/[eventSlug]/orderbook
 *
 * Returns full Level-2 / Level-3 orderbook analytics for every market within
 * a Polymarket event. Works for any event category: sports, politics, crypto,
 * entertainment, science — anything.
 *
 * Metrics computed:
 *   • Bid/Ask imbalance           • Market depth (5 + 10 levels)
 *   • Order flow (net, buy/sell)  • Cancellations
 *   • New orders per second       • Execution speed
 *   • Hidden / iceberg liquidity  • Whale activity
 *   • Spoofing patterns           • Market maker behavior
 *   • Support & resistance        • Next-tick up/down probability
 *   • Expected slippage ($100–$5k) • Liquidity score + trend
 *   • Volatility (realized + implied + forecast)
 *
 * Parameters:
 *   ?markets=1  — number of markets to analyze per event (default 3, max 6)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<EventOrderbookResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  const { eventSlug } = req.query
  if (!eventSlug || typeof eventSlug !== 'string') {
    return res.status(400).json(createErrorResponse('Missing eventSlug parameter'))
  }

  const maxMarkets = Math.min(6, Math.max(1,
    Number.parseInt((req.query.markets as string) || '3', 10)
  ))

  // Cache key
  const cacheKey = `ob-event:${eventSlug}:m${maxMarkets}`
  const cached = cache.get<EventOrderbookResponse>(cacheKey)
  if (cached) {
    return res.status(200).json(createSuccessResponse(cached))
  }

  try {
    // Resolve event
    const event = await polymarketAPI.getEvent(eventSlug)
    if (!event) {
      return res.status(404).json(
        createErrorResponse(
          `Event slug "${eventSlug}" not found. ` +
          `Use /api/events/browse or /api/search?q=<keyword> to discover correct slugs.`
        )
      )
    }

    const markets = (event.groupedMarkets ?? []).slice(0, maxMarkets)
    if (markets.length === 0) {
      return res.status(404).json(
        createErrorResponse(
          `Event "${event.title}" has no tradeable markets yet.`
        )
      )
    }

    // Analyze each market (each token = one outcome)
    const marketResults: MarketOrderbookResult[] = await Promise.all(
      markets.map(async (market) => {
        let tokens: TokenOrderbook[] = []
        try {
          tokens = await analyzeMarket(market)
        } catch (err) {
          console.warn(`[orderbook] Skipped market ${market.id}:`, err)
        }

        return {
          marketId: market.id,
          conditionId: market.conditionId,
          title: market.title,
          question: market.question,
          outcomes: market.outcomes,
          clobTokenIds: market.clobTokenIds,
          active: market.active,
          closed: market.closed,
          volume24hr: market.volume24hr,
          volumeAll: market.volumeAll,
          liquidity: market.liquidity,
          endDate: market.endDate,
          tokens,
        }
      })
    )

    // ── Summary metrics ───────────────────────────────────────────────────
    const allTokens = marketResults.flatMap(m => m.tokens)
    const totalTokens = allTokens.length

    const avgLiquidityScore = totalTokens > 0
      ? allTokens.reduce((s, t) => s + t.raw.liquidityScore, 0) / totalTokens
      : 0

    const avgSpread = totalTokens > 0
      ? allTokens.reduce((s, t) => s + t.raw.spread, 0) / totalTokens
      : 0

    const highestWhale = allTokens.reduce((m, t) => Math.max(m, t.raw.whaleActivity), 0)

    // Dominant bias across all tokens
    const avgUpProb = totalTokens > 0
      ? allTokens.reduce((s, t) => s + t.raw.nextTickUpProbability, 0) / totalTokens
      : 0.5
    const overallBias = labelBias(avgUpProb)

    const response: EventOrderbookResponse = {
      eventSlug,
      eventTitle: event.title,
      eventDescription: event.description,
      active: event.active,
      closed: event.closed,
      computedAt: new Date().toISOString(),
      markets: marketResults,
      summary: {
        totalMarkets: markets.length,
        totalTokensAnalyzed: totalTokens,
        overallBias,
        highestWhaleActivity: highestWhale,
        avgLiquidityScore: Math.round(avgLiquidityScore),
        avgSpread: Number(avgSpread.toFixed(4)),
        tip:
          `Each token in "markets[].tokens[]" contains a "grouped" object with all ` +
          `L2/L3 metrics organized by category (spread, depth, orderFlow, slippage, ` +
          `whaleActivity, patterns, prediction, hiddenLiquidity, volatility, liquidity).`,
      },
    }

    cache.set(cacheKey, response, CACHE_TTL.PRICE_DATA)
    return res.status(200).json(createSuccessResponse(response))
  } catch (error) {
    console.error(`[orderbook/${eventSlug}] Error:`, error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
