import type { NextApiRequest, NextApiResponse } from 'next'

import { cache, CacheKeys, CACHE_TTL } from '../../../cache'
import { polymarketAPI } from '../../../polymarket-api'
import { SmartMoneyScorer } from '../../../smart-money-scorer'
import { APIResponse, EventOutcomeMetrics, LeaderboardUser, SmartMoneyTrader, TraderActivityResponse, UserProfile } from '../../../types'
import {
  aggregateTraderMetrics,
  createErrorResponse,
  createSuccessResponse,
  isValidWalletAddress,
  daysAgo,
} from '../../../utils'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<TraderActivityResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  try {
    const { wallet } = req.query

    if (!wallet || typeof wallet !== 'string' || !isValidWalletAddress(wallet)) {
      return res.status(400).json(createErrorResponse('Invalid wallet address'))
    }

    const cacheKey = CacheKeys.traderActivity(wallet)
    const cachedResult = cache.get<TraderActivityResponse>(cacheKey)
    if (cachedResult) {
      return res.status(200).json(createSuccessResponse(cachedResult))
    }

    const timePeriod = ((req.query.timePeriod as string) || '30d') as
      | '1d'
      | '7d'
      | '30d'
      | '90d'
      | 'all'
      | 'DAY'
      | 'WEEK'
      | 'MONTH'
      | 'ALL'

    // Fetch profile from cache or in parallel — avoids a blocking sequential call
    const profileCacheKey = CacheKeys.profile(wallet)
    const cachedProfile   = cache.get<UserProfile>(profileCacheKey)

    const [leaderboard, positions, trades, activity, freshProfile] = await Promise.all([
      polymarketAPI.getLeaderboard({ limit: 100, user: wallet, timePeriod }),
      polymarketAPI.getPositions({ user: wallet, limit: 200 }),
      polymarketAPI.getTrades({ user: wallet, limit: 200 }),
      polymarketAPI.getActivity({ user: wallet, limit: 100 }),
      cachedProfile ? Promise.resolve(null) : polymarketAPI.getProfile(wallet),
    ])

    const profile = cachedProfile ?? freshProfile
    if (freshProfile) cache.set(profileCacheKey, freshProfile, 5 * 60 * 1000)

    let traderData = leaderboard.find((entry) => entry.proxyWallet.toLowerCase() === wallet.toLowerCase())

    const predictionsCount = new Set(trades.map((trade) => trade.marketId)).size || trades.length

    // Derive join date from profile (fetched in parallel) or earliest trade already in memory
    const rawMin = trades.length > 0 ? Math.min(...trades.map((t) => t.timestamp)) : 0
    const joinedAt = (profile?.createdAt && profile.createdAt > 0)
      ? profile.createdAt
      : rawMin > 0
        ? (rawMin < 1e12 ? rawMin * 1000 : rawMin)
        : Date.now()
    const joinedDaysAgo = daysAgo(joinedAt)
    const largestTrade = trades.length > 0 ? Math.max(...trades.map((trade) => trade.totalCost)) : 0

    if (!traderData) {
      // Fallback row if user is not in the fetched leaderboard
      traderData = {
        proxyWallet: wallet,
        userUsername: profile?.username || undefined,
        userDisplayName: profile?.displayName || undefined,
        profileImage: profile?.profileImage || undefined,
        rank: 0,
        pnl: profile?.pnl || positions.reduce((sum, p) => sum + p.cashPnl, 0),
        volume: profile?.volume || trades.reduce((sum, t) => sum + t.totalCost, 0),
        predictionsCount,
        largestTrade,
        joinedAt,
        joinedDaysAgo,
      }
    }

    const scoringUser: LeaderboardUser = {
      ...traderData,
      predictionsCount,
      joinedAt,
      joinedDaysAgo,
      largestTrade,
    }

    const metrics = aggregateTraderMetrics(scoringUser, trades, positions)
    const smartMoneyScore = SmartMoneyScorer.calculateSmartMoneyScore(scoringUser, trades, positions)

    const highConvictionMarkets = new Set(
      trades
        .filter((trade) => trade.side === 'BUY')
        .map((trade) => trade.marketId)
    ).size
    const buyCount = trades.filter((trade) => trade.side === 'BUY').length
    const sellCount = trades.filter((trade) => trade.side === 'SELL').length

    smartMoneyScore.explanation =
      `${buyCount} buys / ${sellCount} sells, ` +
      `${predictionsCount} markets, ` +
      `${joinedDaysAgo} days since first activity`

    const enrichedTrader: SmartMoneyTrader = {
      ...traderData,
      predictionsCount,
      joinedAt,
      joinedDaysAgo,
      largestTrade,
      smartMoneyScore,
      winRate: metrics.winRate,
      avgTradeSize: metrics.avgTradeSize,
      largeTradesCount: metrics.largeTradesCount,
      profitPerPrediction: metrics.profitPerPrediction,
      earlyEntryCount: metrics.earlyEntryCount,
      highConvictionCount: highConvictionMarkets,
      riskScore: metrics.riskScore,
      userUsername: profile?.username || profile?.displayName || traderData.userUsername || traderData.userDisplayName || wallet.slice(0, 8),
      userDisplayName: profile?.displayName || profile?.username || traderData.userDisplayName || traderData.userUsername,
      profileImage: profile?.profileImage || traderData.profileImage,
    }

    const groupedPositions = positions.map((position) => {
      const marketTrades = trades.filter((trade) => trade.marketId === position.marketId)
      const buyTrades = marketTrades.filter((trade) => trade.side === 'BUY')
      const sellTrades = marketTrades.filter((trade) => trade.side === 'SELL')
      const totalTrades = marketTrades.length

      const outcomeMetric: EventOutcomeMetrics = {
        eventSlug: position.marketId,
        eventTitle: position.marketTitle,
        marketId: position.marketId,
        outcome: position.outcome,
        price: position.price,
        volume24hr: 0,
        totalHolders: 0,
        topHolders: [],
        smartMoneyHolders: [
          {
            wallet,
            username: enrichedTrader.userUsername,
            displayName: enrichedTrader.userDisplayName,
            smartMoneyScore: enrichedTrader.smartMoneyScore.totalScore,
            position: {
              size: position.size,
              avgPrice: position.avgPrice,
              currentValue: position.currentValue,
              cashPnl: position.cashPnl,
            },
            tradingPattern: {
              totalTrades,
              buySells: buyTrades.length / Math.max(1, sellTrades.length),
              averageTradeSize: totalTrades > 0 ? marketTrades.reduce((sum, trade) => sum + trade.sharesTraded, 0) / totalTrades : 0,
              entryPrice: position.avgPrice,
              entryTimestamp: totalTrades > 0 ? Math.min(...marketTrades.map((trade) => trade.timestamp)) : joinedAt,
            },
          },
        ],
      }

      return outcomeMetric
    })

    const response: TraderActivityResponse = {
      trader: enrichedTrader,
      recentTrades: trades.slice(0, 50),
      recentActivity: activity.slice(0, 50),
      positions: positions.slice(0, 50),
      marketHoldings: groupedPositions,
    }

    // Cache for 2 minutes — trader data doesn't change that fast
    cache.set(cacheKey, response, 2 * 60 * 1000)
    return res.status(200).json(createSuccessResponse(response))
  } catch (error) {
    console.error('Trader analysis error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
