import type { NextApiRequest, NextApiResponse } from 'next'

import { cache, CacheKeys, CACHE_TTL } from '../../../../cache'
import { polymarketAPI } from '../../../../polymarket-api'
import { computeOrderBookAnalytics, createOrderBookSnapshot } from '@/orderbook-analytics'
import { SmartMoneyDetector, SmartMoneyScorer } from '../../../../smart-money-scorer'
import {
  APIResponse,
  EnrichedMarketHolder,
  EventAnalysisResponse,
  EventOutcomeMetrics,
  GammaMarket,
  HolderTrade,
  LeaderboardUser,
  OrderBookAnalytics,
  SmartMoneySignal,
  SmartMoneyTrader,
  SmartMoneyTraderPosition,
} from '../../../../types'
import { createErrorResponse, createSuccessResponse, batchMap, daysAgo } from '../../../../utils'

function toTraderPosition(
  wallet: string,
  position: {
    size: number
    avgPrice: number
    currentValue: number
    cashPnl: number
  },
  totalTrades: number,
  buyCount: number,
  sellCount: number,
  averageTradeSize: number,
  entryPrice: number,
  entryTimestamp: number,
  score: number,
  username?: string,
  displayName?: string
): SmartMoneyTraderPosition {
  return {
    wallet,
    username,
    displayName,
    smartMoneyScore: score,
    position,
    tradingPattern: {
      totalTrades,
      buySells: buyCount / Math.max(1, sellCount),
      averageTradeSize,
      entryPrice,
      entryTimestamp,
    },
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<EventAnalysisResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  try {
    const { eventSlug } = req.query
    if (!eventSlug || typeof eventSlug !== 'string') {
      return res.status(400).json(createErrorResponse('Missing eventSlug parameter'))
    }

    const limit = Math.max(1, Number.parseInt((req.query.limit as string) || '10', 10))
    const cacheKey = CacheKeys.event(eventSlug)
    const cachedResult = cache.get<EventAnalysisResponse>(cacheKey)
    if (cachedResult) {
      return res.status(200).json(createSuccessResponse(cachedResult))
    }

    // Fetch event and any markets that share the same slug
    const [eventResult, marketsResult] = await Promise.all([
      polymarketAPI.getEvent(eventSlug),
      polymarketAPI.getMarkets({ limit: 100, slug: eventSlug }),
    ])

    // getEvent() returns null when the slug doesn't exist in the Gamma API.
    if (!eventResult) {
      return res.status(404).json(
        createErrorResponse(
          `Event slug "${eventSlug}" was not found in the Polymarket Gamma API. ` +
          `Use /api/events/browse to see active events and their correct slugs.`
        )
      )
    }

    const event = eventResult

    // Strategy: use markets embedded IN the event (from raw.markets, now in event.groupedMarkets)
    // because market slugs may differ from the event slug.
    // Fall back to a separate slug-matched getMarkets() call if embedded list is empty.
    const embeddedMarkets = event.groupedMarkets ?? []
    const separateMarkets = marketsResult.markets
    const markets = embeddedMarkets.length > 0 ? embeddedMarkets : separateMarkets

    if (markets.length === 0) {
      return res.status(404).json(
        createErrorResponse(
          `Event "${event.title}" was found but has no tradeable markets. ` +
          `It may be resolved or not yet active.`
        )
      )
    }

    const outcomeMetrics: EventOutcomeMetrics[] = await batchMap(
      markets,
      async (market: GammaMarket) => {
        const holders = await polymarketAPI.getMarketHolders({
          marketId: market.conditionId || market.id,
          limit: 100,
          sortBy: 'value',
        })

        const topHolders = holders.slice(0, 5)

        // Fetch prices for all clob token IDs of this market
        const tokenPrices: Record<string, number> = {}
        if (market.clobTokenIds && market.clobTokenIds.length > 0) {
          await Promise.all(
            market.clobTokenIds.map(async (tokenId) => {
              try {
                const clobPrice = await polymarketAPI.getPrice(tokenId)
                tokenPrices[tokenId] = clobPrice.price
              } catch {
                tokenPrices[tokenId] = 0.5
              }
            })
          )
        }

        const getHolderOutcomePrice = (outcomeStr: string): number => {
          if (tokenPrices[outcomeStr] !== undefined) {
            return tokenPrices[outcomeStr]
          }
          const index = Number.parseInt(outcomeStr, 10)
          if (Number.isFinite(index) && market.clobTokenIds && market.clobTokenIds[index]) {
            const tokenId = market.clobTokenIds[index]
            return tokenPrices[tokenId] ?? 0.5
          }
          return 0.5
        }

        // Enrich holders with exact trade data (buy/sell prices, shares, P&L)
        const enrichedHolders: EnrichedMarketHolder[] = await batchMap(
          holders.slice(0, 20),
          async (holder) => {
            try {
              const holderTrades = await polymarketAPI.getTrades({
                user: holder.proxyWallet,
                market: market.conditionId || market.id,
                limit: 200,
              })

              const buyTrades = holderTrades.filter(t => t.side === 'BUY')
              const sellTrades = holderTrades.filter(t => t.side === 'SELL')

              const totalBought = buyTrades.reduce((sum, t) => sum + t.sharesTraded, 0)
              const totalSold = sellTrades.reduce((sum, t) => sum + t.sharesTraded, 0)

              const avgBuyPrice = buyTrades.length > 0
                ? buyTrades.reduce((sum, t) => sum + t.pricePerShare * t.sharesTraded, 0) / Math.max(1, totalBought)
                : 0
              const avgSellPrice = sellTrades.length > 0
                ? sellTrades.reduce((sum, t) => sum + t.pricePerShare * t.sharesTraded, 0) / Math.max(1, totalSold)
                : 0

              const netShares = totalBought - totalSold
              const totalSellRevenue = sellTrades.reduce((sum, t) => sum + t.totalCost, 0)
              const realizedPnl = totalSellRevenue - (totalSold * avgBuyPrice)
              const currentPrice = getHolderOutcomePrice(holder.outcome)
              const unrealizedPnl = netShares * (currentPrice - avgBuyPrice)

              const timestamps = holderTrades.map(t => t.timestamp).filter(t => t > 0)
              const firstTradeAt = timestamps.length > 0 ? Math.min(...timestamps) : 0
              const lastTradeAt = timestamps.length > 0 ? Math.max(...timestamps) : 0

              const trades: HolderTrade[] = holderTrades.map(t => ({
                side: t.side,
                shares: t.sharesTraded,
                price: t.pricePerShare,
                cost: t.totalCost,
                timestamp: t.timestamp,
                hashId: t.hashId,
              }))

              return {
                ...holder,
                avgBuyPrice,
                avgSellPrice,
                totalBought,
                totalSold,
                netShares,
                unrealizedPnl,
                realizedPnl,
                tradeCount: holderTrades.length,
                firstTradeAt,
                lastTradeAt,
                trades,
              } as EnrichedMarketHolder
            } catch {
              return {
                ...holder,
                avgBuyPrice: 0,
                avgSellPrice: 0,
                totalBought: holder.size,
                totalSold: 0,
                netShares: holder.size,
                unrealizedPnl: 0,
                realizedPnl: 0,
                tradeCount: 0,
                firstTradeAt: 0,
                lastTradeAt: 0,
                trades: [],
              } as EnrichedMarketHolder
            }
          },
          4
        )

        // Smart money analysis for holders
        const smartMoneyHolders: SmartMoneyTraderPosition[] = await batchMap(
          holders.slice(0, limit),
          async (holder) => {
            const traderTrades = await polymarketAPI.getTrades({
              user: holder.proxyWallet,
              market: market.conditionId || market.id,
              limit: 100,
            })

            const uniqueMarkets = new Set(traderTrades.map((trade) => trade.marketId))
            const rawJoined = traderTrades.length > 0 ? Math.min(...traderTrades.map((trade) => trade.timestamp)) : 0
            const joinedAt = rawJoined > 0 ? (rawJoined < 1e12 ? rawJoined * 1000 : rawJoined) : Date.now()
            const leaderboardLikeTrader: LeaderboardUser = {
              proxyWallet: holder.proxyWallet,
              userUsername: holder.userUsername || holder.userDisplayName,
              userDisplayName: holder.userDisplayName || holder.userUsername,
              rank: 0,
              pnl: holder.cashPnl,
              volume: traderTrades.reduce((sum, trade) => sum + trade.totalCost, 0),
              predictionsCount: uniqueMarkets.size || traderTrades.length,
              largestTrade: traderTrades.length > 0 ? Math.max(...traderTrades.map((trade) => trade.totalCost)) : 0,
              joinedAt,
              joinedDaysAgo: daysAgo(joinedAt),
            }

            const score = SmartMoneyScorer.calculateSmartMoneyScore(leaderboardLikeTrader, traderTrades, [])
            const buyTrades = traderTrades.filter((trade) => trade.side === 'BUY')
            const sellTrades = traderTrades.filter((trade) => trade.side === 'SELL')
            const averageTradeSize =
              traderTrades.length > 0
                ? traderTrades.reduce((sum, trade) => sum + trade.sharesTraded, 0) / traderTrades.length
                : 0

            return toTraderPosition(
              holder.proxyWallet,
              {
                size: holder.size,
                avgPrice: holder.averagePrice,
                currentValue: holder.size * (getHolderOutcomePrice(holder.outcome) || holder.currentPrice),
                cashPnl: holder.cashPnl,
              },
              traderTrades.length,
              buyTrades.length,
              sellTrades.length,
              averageTradeSize,
              buyTrades.length > 0 ? buyTrades.reduce((sum, trade) => sum + trade.pricePerShare, 0) / buyTrades.length : 0.5,
              joinedAt,
              score.totalScore,
              holder.userUsername,
              holder.userDisplayName
            )
          },
          4
        )

        // Fetch orderbook analytics for each market's token
        let orderBookAnalytics: OrderBookAnalytics | undefined = undefined
        if (market.clobTokenIds && market.clobTokenIds.length > 0) {
          try {
            const tokenId = market.clobTokenIds[0]
            const [book, marketTrades, priceHistory] = await Promise.all([
              polymarketAPI.getOrderBook(tokenId),
              polymarketAPI.getTrades({ market: market.conditionId || market.id, limit: 200 }),
              polymarketAPI.getPriceHistory({ tokenId, interval: '1h', fidelity: 10 }),
            ])

            const snapshotKey = `ob-snapshot:${tokenId}`
            const previousSnapshot = cache.get<ReturnType<typeof createOrderBookSnapshot>>(snapshotKey)

            orderBookAnalytics = computeOrderBookAnalytics(book, marketTrades, priceHistory, previousSnapshot)

            const currentSnapshot = createOrderBookSnapshot(book)
            cache.set(snapshotKey, currentSnapshot, 600000)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.log(`[Orderbook Analytics] Skipped for market ${market.id}: ${msg}`)
          }
        }

        const marketPrice = market.clobTokenIds && market.clobTokenIds[0] && tokenPrices[market.clobTokenIds[0]] !== undefined
          ? tokenPrices[market.clobTokenIds[0]]
          : (market.volume24hr > 0 ? Math.min(1, Math.max(0, market.liquidity / Math.max(1, market.volumeAll || 1))) : 0.5)

        return {
          eventSlug,
          eventTitle: event.title,
          marketId: market.id,
          outcome: market.outcomes?.[0] || market.title,
          price: marketPrice,
          volume24hr: market.volume24hr,
          totalHolders: holders.length,
          topHolders,
          smartMoneyHolders,
          enrichedHolders,
          orderBookAnalytics,
        }
      },
      4
    )

    const allSignals: SmartMoneySignal[] = []

    for (const market of markets.slice(0, 5)) {
      try {
        const trades = await polymarketAPI.getTrades({
          market: market.conditionId || market.id,
          limit: 500,
        })

        const tradesByTrader = new Map<string, typeof trades>()
        trades.forEach((trade) => {
          if (!trade.proxyWallet) return
          if (!tradesByTrader.has(trade.proxyWallet)) {
            tradesByTrader.set(trade.proxyWallet, [])
          }
          tradesByTrader.get(trade.proxyWallet)!.push(trade)
        })

        const topTraders = Array.from(tradesByTrader.entries())
          .sort(([, a], [, b]) => b.reduce((sum, trade) => sum + trade.totalCost, 0) - a.reduce((sum, trade) => sum + trade.totalCost, 0))
          .slice(0, 10)

        for (const [wallet, traderTrades] of topTraders) {
          const totalCost = traderTrades.reduce((sum, trade) => sum + trade.totalCost, 0)
          const buyCost = traderTrades.filter(t => t.side === 'BUY').reduce((s,t) => s + t.totalCost, 0)
          const sellRevenue = traderTrades.filter(t => t.side === 'SELL').reduce((s,t) => s + t.totalCost, 0)
          const totalPnl = sellRevenue - buyCost
          const predictionsCount = new Set(traderTrades.map((trade) => trade.marketId)).size || traderTrades.length
          const rawJoinedAt = traderTrades.length > 0 ? Math.min(...traderTrades.map((trade) => trade.timestamp)) : 0
          const joinedAt = rawJoinedAt > 0 ? (rawJoinedAt < 1e12 ? rawJoinedAt * 1000 : rawJoinedAt) : Date.now()
          const joinedDaysAgo = daysAgo(joinedAt)
          const trader: SmartMoneyTrader = {
            proxyWallet: wallet,
            userUsername: traderTrades[0]?.userUsername,
            userDisplayName: traderTrades[0]?.userUsername,
            rank: 0,
            pnl: totalPnl,
            volume: totalCost,
            predictionsCount,
            largestTrade: traderTrades.length > 0 ? Math.max(...traderTrades.map((trade) => trade.totalCost)) : 0,
            joinedAt,
            joinedDaysAgo,
            smartMoneyScore: {
              totalScore: 0,
              efficiency: 0,
              timing: 0,
              conviction: 0,
              consistency: 0,
              explanation: '',
            },
            profitPerPrediction: totalPnl / Math.max(1, predictionsCount),
            winRate: 0,
            avgTradeSize:
              traderTrades.length > 0
                ? traderTrades.reduce((sum, trade) => sum + trade.sharesTraded, 0) / traderTrades.length
                : 0,
            largeTradesCount: traderTrades.filter((trade) => trade.sharesTraded > 1000).length,
            earlyEntryCount: traderTrades.filter((trade) => trade.side === 'BUY' && trade.pricePerShare < 0.3).length,
            highConvictionCount: traderTrades.filter((trade) => trade.side === 'BUY').length,
            riskScore: 0,
          }

          const signals = SmartMoneyDetector.generateSmartMoneySignals(trader, traderTrades, [market.id])
          allSignals.push(...signals)
        }
      } catch (error) {
        console.error('Signal generation error:', error)
      }
    }

    const response: EventAnalysisResponse = {
      event,
      markets,
      smartMoneySignals: allSignals.sort((a, b) => b.confidence - a.confidence).slice(0, 10),
      outcomeMetrics,
    }

    cache.set(cacheKey, response, CACHE_TTL.MARKET_DATA)
    return res.status(200).json(createSuccessResponse(response))
  } catch (error) {
    console.error('Event analysis error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
