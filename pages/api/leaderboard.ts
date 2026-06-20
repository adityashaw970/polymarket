import type { NextApiRequest, NextApiResponse } from 'next'

import { cache, CacheKeys, CACHE_TTL } from '../../cache'
import { DEFAULT_FILTERS } from '../../constants'
import { polymarketAPI } from '../../polymarket-api'
import { SmartMoneyScorer, TraderRanker } from '../../smart-money-scorer'
import { APIResponse, LeaderboardUser, PaginatedResponse, SmartMoneyTrader, UserProfile } from '../../types'
import {
  aggregateTraderMetrics,
  createErrorResponse,
  createSuccessResponse,
  daysAgo,
  batchMap,
} from '../../utils'

interface LeaderboardQuery {
  limit?: string
  offset?: string
  category?: string
  timePeriod?: string
  sortBy?: string
  minScore?: string
  minPnL?: string
  minPredictions?: string
  maxPredictions?: string
  maxJoinedDaysAgo?: string
}

const DEFAULT_LIMIT = 50
const DEFAULT_OFFSET = 0

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<PaginatedResponse<SmartMoneyTrader>>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  try {
    const query = req.query as LeaderboardQuery

    const limit = Math.min(toInt(query.limit, DEFAULT_LIMIT), 500)
    const offset = Math.max(0, toInt(query.offset, DEFAULT_OFFSET))
    const sortBy = (query.sortBy || 'smartScore') as
      | 'smartScore'
      | 'pnl'
      | 'profitPerPrediction'
      | 'winRate'
      | 'consistency'
      | 'predictionsCount'
      | 'joinedDaysAgo'
      | 'volume'
      | 'riskScore'

    const minScore = toInt(query.minScore, DEFAULT_FILTERS.MIN_SMART_SCORE)
    const minPnL = toInt(query.minPnL, DEFAULT_FILTERS.MIN_PNL)
    const minPredictions = query.minPredictions ? toInt(query.minPredictions, DEFAULT_FILTERS.MIN_PREDICTIONS) : undefined
    const maxPredictions = query.maxPredictions ? toInt(query.maxPredictions, 999999) : undefined
    const maxJoinedDaysAgo = query.maxJoinedDaysAgo ? toInt(query.maxJoinedDaysAgo, 999999) : undefined

    // Cache key includes ALL filter params so different filter combos cache independently
    const cacheKey = `leaderboard:${query.category || 'OVERALL'}:${query.timePeriod || '30d'}:${limit}:${offset}:${sortBy}:${minScore}:${minPnL}:${minPredictions ?? 'x'}:${maxPredictions ?? 'x'}`

    const cachedResult = cache.get<PaginatedResponse<SmartMoneyTrader>>(cacheKey)
    if (cachedResult) {
      res.setHeader('X-Cache', 'HIT')
      return res.status(200).json(createSuccessResponse(cachedResult))
    }

    // Fetch 2 pages (100 users) — ample for a useful leaderboard without excessive API calls
    const FETCH_USERS = 100
    const leaderboardResult: LeaderboardUser[] = []
    const leaderboardPages = Math.ceil(FETCH_USERS / 50)
    for (let page = 0; page < leaderboardPages; page += 1) {
      const pageData = await polymarketAPI.getLeaderboard({
        limit: 50,
        offset: page * 50,
        timePeriod:
          (query.timePeriod as '1d' | '7d' | '30d' | '90d' | 'all' | 'DAY' | 'WEEK' | 'MONTH' | 'ALL') ||
          '30d',
        orderBy: 'PNL',
        category: query.category || 'OVERALL',
      })

      leaderboardResult.push(...pageData)

      if (pageData.length < 50) {
        break
      }
    }

    // Process users in larger concurrent batches of 15 for faster throughput
    const smartMoneyTraders = await batchMap(
      leaderboardResult,
      async (user) => {
        // Use cached profile if available — no blocking profile fetch per user
        const profileCacheKey = CacheKeys.profile(user.proxyWallet)
        let cachedProfile = cache.get<UserProfile>(profileCacheKey)

        const [trades, positions, tradedCount, earliestActivity, redemptions, freshProfile] = await Promise.all([
          polymarketAPI.getTrades({ user: user.proxyWallet, limit: 200 }),
          polymarketAPI.getPositions({ user: user.proxyWallet, limit: 100 }),
          polymarketAPI.getTradedCount(user.proxyWallet),
          // Cheap — only needs the single earliest row, for joinedAt
          polymarketAPI.getActivity({ user: user.proxyWallet, limit: 1, sortBy: 'timestamp', sortDirection: 'asc' }),
          // Server-side filtered to REDEEM only — so whales with thousands of
          // MAKER_REBATE/REWARD rows don't bury their actual redemptions before
          // a generic limit cuts off
          polymarketAPI.getActivity({ user: user.proxyWallet, type: 'REDEEM', limit: 500, sortBy: 'timestamp', sortDirection: 'desc' }),
          cachedProfile ? Promise.resolve(null) : polymarketAPI.getProfile(user.proxyWallet),
        ])

        if (!cachedProfile && freshProfile) {
          cachedProfile = freshProfile
          cache.set(profileCacheKey, freshProfile, 5 * 60 * 1000)
        }

        const predictionsCount = tradedCount || trades.length
        // redemptions is already type-filtered server-side now

        const joinedAt =
          (cachedProfile?.createdAt && cachedProfile.createdAt > 0)
            ? cachedProfile.createdAt
            : earliestActivity.length > 0
              ? earliestActivity[0].timestamp
              : trades.length > 0
                ? Math.min(...trades.map((t) => t.timestamp))
                : Date.now()

        const joinedDaysAgo = daysAgo(joinedAt)
        const largestTrade = trades.length > 0 ? Math.max(...trades.map((trade) => trade.totalCost)) : 0
        const scoringUser: LeaderboardUser = {
          ...user,
          predictionsCount,
          largestTrade,
          joinedAt,
          joinedDaysAgo,
        }

        const metrics = aggregateTraderMetrics(scoringUser, trades, positions, redemptions)
        const score = SmartMoneyScorer.calculateSmartMoneyScore(scoringUser, trades, positions)

        const highConvictionMarkets = new Set(
          trades
            .filter((trade) => trade.side === 'BUY')
            .map((trade) => trade.marketId)
        ).size
        const buyCount = trades.filter((trade) => trade.side === 'BUY').length
        const sellCount = trades.filter((trade) => trade.side === 'SELL').length

        const profile = cachedProfile

        const trader: SmartMoneyTrader = {
          ...user,
          predictionsCount,
          joinedAt,
          joinedDaysAgo,
          largestTrade,
          smartMoneyScore: score,
          winRate: metrics.winRate,
          avgTradeSize: metrics.avgTradeSize,
          largeTradesCount: metrics.largeTradesCount,
          profitPerPrediction: metrics.profitPerPrediction,
          earlyEntryCount: metrics.earlyEntryCount,
          highConvictionCount: highConvictionMarkets,
          riskScore: metrics.riskScore,
          volume: user.volume,
          pnl: user.pnl,
          rank: user.rank,
          userUsername: profile?.username || profile?.displayName || user.userUsername || user.userDisplayName || user.proxyWallet.slice(0, 8),
          userDisplayName: profile?.displayName || profile?.username || user.userDisplayName || user.userUsername,
          profileImage: profile?.profileImage || user.profileImage,
        }

        return {
          ...trader,
          smartMoneyScore: {
            ...trader.smartMoneyScore,
            explanation:
              `${buyCount} buys / ${sellCount} sells, ` +
              `${predictionsCount} markets, ` +
              `${joinedDaysAgo} days since first activity`,
          },
        }
      },
      8 // Reduced to 8 concurrent workers to avoid thundering herd rate limits
    )

    const filtered = TraderRanker.filterSmartMoneyTraders(smartMoneyTraders, {
      minSmartScore: minScore,
      minPnL,
      minPredictions,
      maxPredictions,
      minWinRate: undefined,
      joinedAfterDaysAgo: maxJoinedDaysAgo,
    })

    const sorted = TraderRanker.rankTraders(filtered, sortBy, false)
    const paginated = sorted.slice(offset, offset + limit)

    const response: PaginatedResponse<SmartMoneyTrader> = {
      data: paginated,
      total: sorted.length,
      limit,
      offset,
      hasMore: offset + limit < sorted.length,
    }

    // Cache for 5 minutes — expensive computation runs at most once per 5 min
    cache.set(cacheKey, response, 5 * 60 * 1000)
    return res.status(200).json(createSuccessResponse(response))
  } catch (error) {
    console.error('Leaderboard error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
