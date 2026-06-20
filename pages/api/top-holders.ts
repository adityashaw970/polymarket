import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../polymarket-api'
import { cache } from '../../cache'
import { createSuccessResponse, createErrorResponse, pLimit } from '../../utils'
import { APIResponse } from '../../types'

export interface TopHolder {
  rank: number
  proxyWallet: string
  username?: string
  displayName?: string
  profileImage?: string
  outcome: string
  outcomeIndex: number
  shares: number
  avgBuyPrice: number
  totalCost: number
  currentPrice: number
  unrealizedPnl: number
  tradeCount: number
  profileUrl: string
  totalPredictions: number
  joinedDate: number
}

export interface OutcomeGroup {
  outcome: string
  tokenId: string
  currentPrice: number
  holders: TopHolder[]
}

export interface TopHoldersResponse {
  conditionId: string
  outcomeGroups: OutcomeGroup[]
  fetchedAt: string
}

interface RawHolder {
  proxyWallet: string
  pseudonym?: string
  name?: string
  profileImage?: string
  profileImageOptimized?: string
  amount?: number | string
  outcomeIndex?: number
  asset?: string
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') { const n = parseFloat(v); if (Number.isFinite(n)) return n }
  return 0
}

const POLY_LAUNCH_MS = new Date('2020-10-01').getTime()

/**
 * Fetch live user data from the Data API:
 * - totalPredictions: number of distinct markets the user has positions in
 * - joinedDate: timestamp of their earliest trade (first on-chain activity)
 * - avgBuyPrice / totalCost / unrealizedPnl: from the positions endpoint for this market
 */
async function fetchUserLiveData(
  proxyWallet: string,
  conditionId: string,
  tokenId: string,          // ← ADD THIS PARAMETER
): Promise<{
  totalPredictions: number
  joinedDate: number
  avgBuyPrice: number
  totalCost: number
  unrealizedPnl: number
  tradeCount: number
}> {
  const defaultResult = {
    totalPredictions: 0,
    joinedDate: 0,
    avgBuyPrice: 0,
    totalCost: 0,
    unrealizedPnl: 0,
    tradeCount: 0,
  }

  try {
    const [tradedCountResult, marketPositionResult, earliestActivityResult, marketTradesResult] =
      await Promise.allSettled([
        fetchTradedCount(proxyWallet),
        polymarketAPI.getPositions({ user: proxyWallet, market: conditionId, limit: 10 }),
        fetchEarliestActivityTimestamp(proxyWallet),
        polymarketAPI.getTrades({ user: proxyWallet, market: conditionId, side: 'BUY', limit: 500, sortBy: 'timestamp', sortDirection: 'desc' }),
      ])

    const totalPredictions =
      tradedCountResult.status === 'fulfilled' ? tradedCountResult.value : 0

    let avgBuyPrice = 0
    let totalCost = 0
    let unrealizedPnl = 0

    if (marketPositionResult.status === 'fulfilled' && marketPositionResult.value.length > 0) {
      // ✅ Filter to only the position matching THIS specific tokenId/outcome
      const positions = marketPositionResult.value
      const matchingPos = positions.find(p => p.asset === tokenId) ?? positions[0]

      // ✅ Use avgPrice directly from API — don't recompute it
      avgBuyPrice = toNum(matchingPos.avgPrice)
      totalCost = toNum(matchingPos.initialValue)
      unrealizedPnl = toNum(matchingPos.cashPnl)
    } else if (marketTradesResult.status === 'fulfilled' && marketTradesResult.value.length > 0) {
      // Fallback: aggregate BUY trades for this specific token
      const trades = marketTradesResult.value.filter(t =>
        !tokenId || t.asset === tokenId
      )
      const totalShares = trades.reduce((s, t) => s + t.sharesTraded, 0)
      totalCost = trades.reduce((s, t) => s + t.totalCost, 0)
      avgBuyPrice = totalShares > 0 ? totalCost / totalShares : 0
    }

    let tradeCount = 0
    if (marketTradesResult.status === 'fulfilled') {
      tradeCount = marketTradesResult.value.length
    }

    let joinedDate = 0
    if (earliestActivityResult.status === 'fulfilled' && earliestActivityResult.value >= POLY_LAUNCH_MS) {
      joinedDate = earliestActivityResult.value
    }

    return { totalPredictions, joinedDate, avgBuyPrice, totalCost, unrealizedPnl, tradeCount }
  } catch {
    return defaultResult
  }
}

async function fetchHoldersForToken(
  conditionId: string,
  tokenId: string,
  outcomeIndex: number,
  limit: number,
): Promise<RawHolder[]> {
  const primaryUrl =
    `https://data-api.polymarket.com/holders` +
    `?asset=${encodeURIComponent(tokenId)}` +
    `&limit=${limit + 20}` +
    `&sortBy=amount&sortDirection=desc`

  const controller1 = new AbortController()
  const timer1 = setTimeout(() => controller1.abort(), 5_000)
  try {
    const payload = await fetch(primaryUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PolymarketTracker/1.0' },
      signal: controller1.signal,
    }).then(r => r.json()) as unknown

    if (Array.isArray(payload) && payload.length > 0) {
      const holders: RawHolder[] = []
      for (const item of payload as unknown[]) {
        if (!item || typeof item !== 'object') continue
        const obj = item as Record<string, unknown>
        if ('proxyWallet' in obj) {
          holders.push(obj as unknown as RawHolder)
        } else if ('holders' in obj && Array.isArray((obj as Record<string, unknown[]>).holders)) {
          const bucket = obj as { holders: RawHolder[] }
          holders.push(...bucket.holders)
        }
      }
      if (holders.length > 0) return holders
    }
  } catch { /* fallthrough */ } finally {
    clearTimeout(timer1)
  }

  const fallbackUrl =
    `https://data-api.polymarket.com/holders` +
    `?market=${encodeURIComponent(conditionId)}` +
    `&limit=${(limit + 20) * 4}` +
    `&sortBy=amount&sortDirection=desc`

  const controller2 = new AbortController()
  const timer2 = setTimeout(() => controller2.abort(), 5_000)
  try {
    const payload = await fetch(fallbackUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PolymarketTracker/1.0' },
      signal: controller2.signal,
    }).then(r => r.json()) as unknown

    if (!Array.isArray(payload)) return []

    const all: RawHolder[] = []
    for (const item of payload as unknown[]) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>

      if ('holders' in obj && Array.isArray((obj as { holders: unknown[] }).holders)) {
        const bucket = obj as { token?: string; asset?: string; holders: RawHolder[] }
        const bucketToken = bucket.token ?? bucket.asset ?? ''
        if (!tokenId || bucketToken === tokenId || bucketToken.toLowerCase() === tokenId.toLowerCase()) {
          all.push(...bucket.holders)
        }
      } else if ('proxyWallet' in obj) {
        const h = obj as unknown as RawHolder
        if (h.outcomeIndex === outcomeIndex || !tokenId) {
          all.push(h)
        }
      }
    }

    if (all.length === 0) {
      for (const item of payload as unknown[]) {
        if (!item || typeof item !== 'object') continue
        const obj = item as Record<string, unknown>
        if ('proxyWallet' in obj) all.push(obj as unknown as RawHolder)
        else if ('holders' in obj && Array.isArray((obj as { holders: unknown[] }).holders)) {
          all.push(...(obj as { holders: RawHolder[] }).holders)
        }
      }
    }

    const filtered = all.filter(h => h.outcomeIndex === outcomeIndex)
    return filtered.length > 0 ? filtered : all
  } catch { return [] } finally {
    clearTimeout(timer2)
  }
}

/**
 * Fetch the current midpoint price for a token from the CLOB API.
 * Returns 0 on failure.
 */
async function fetchTradedCount(proxyWallet: string): Promise<number> {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/traded?user=${encodeURIComponent(proxyWallet)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'PolymarketTracker/1.0' } }
    ).then(r => r.json()) as { traded?: number }
    return toNum(res?.traded)
  } catch {
    return 0
  }
}

async function fetchEarliestActivityTimestamp(proxyWallet: string): Promise<number> {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/activity?user=${encodeURIComponent(proxyWallet)}` +
      `&limit=1&sortBy=TIMESTAMP&sortDirection=ASC`,
      { headers: { Accept: 'application/json', 'User-Agent': 'PolymarketTracker/1.0' } }
    ).then(r => r.json()) as unknown

    if (Array.isArray(res) && res.length > 0) {
      const raw = toNum((res[0] as { timestamp?: number }).timestamp)
      if (raw <= 0) return 0
      // Data API /activity returns seconds, not ms — normalize defensively
      return raw < 1e12 ? raw * 1000 : raw
    }
    return 0
  } catch {
    return 0
  }
}

async function fetchCurrentPrice(tokenId: string): Promise<number> {
  if (!tokenId) return 0
  try {
    const price = await polymarketAPI.getPrice(tokenId)
    return price.midpoint ?? price.price ?? 0
  } catch {
    // Fallback: try getMidpoint
    try {
      return await polymarketAPI.getMidpoint(tokenId)
    } catch {
      return 0
    }
  }
}

async function fetchOutcomeHolders(
  conditionId: string,
  tokenId: string,
  outcomeName: string,
  outcomeIndex: number,
  limit: number,
): Promise<OutcomeGroup> {
  const rawHolders = await fetchHoldersForToken(conditionId, tokenId, outcomeIndex, limit)

  const seen = new Set<string>()
  const topRaw = rawHolders
    .filter(h => {
      if (!h.proxyWallet || seen.has(h.proxyWallet)) return false
      seen.add(h.proxyWallet)
      return true
    })
    .map(h => ({ ...h, _amount: toNum(h.amount) }))
    .filter(h => h._amount > 0)
    .sort((a, b) => b._amount - a._amount)
    .slice(0, limit)

  // Fetch current live price from CLOB
  const currentPrice = await fetchCurrentPrice(tokenId)

  // Enrich each holder with live data from the Data API
  const enriched = await pLimit(
    topRaw.map((raw, idx) => async () => {
      try {
        const liveData = await fetchUserLiveData(raw.proxyWallet, conditionId, tokenId)

        const shares = raw._amount

        // Trust the positions API for unrealized PnL
        const unrealizedPnl = liveData.unrealizedPnl

        const holder: TopHolder = {
          rank: idx + 1,
          proxyWallet: raw.proxyWallet,
          username: (raw.name && !raw.name.startsWith('0x')) ? raw.name : (raw.pseudonym || raw.name || undefined),
          displayName: raw.name || raw.pseudonym || undefined,
          profileImage: raw.profileImageOptimized || raw.profileImage,
          outcome: outcomeName,
          outcomeIndex,
          shares,
          avgBuyPrice: liveData.avgBuyPrice,
          totalCost: liveData.totalCost,
          currentPrice,
          unrealizedPnl,
          tradeCount: liveData.tradeCount,
          profileUrl: `https://polymarket.com/profile/${raw.proxyWallet}`,
          totalPredictions: liveData.totalPredictions,
          joinedDate: liveData.joinedDate,
        }
        return { status: 'fulfilled' as const, value: holder }
      } catch (err) {
        return { status: 'rejected' as const, reason: err }
      }
    }),
    5
  )

  const holders: TopHolder[] = enriched.map((r, idx) => {
    if (r.status === 'fulfilled') return r.value
    const raw = topRaw[idx]
    return {
      rank: idx + 1,
      proxyWallet: raw.proxyWallet,
      username: (raw.name && !raw.name.startsWith('0x')) ? raw.name : (raw.pseudonym || raw.name || undefined),
      displayName: raw.name || raw.pseudonym || undefined,
      profileImage: raw.profileImageOptimized || raw.profileImage,
      outcome: outcomeName,
      outcomeIndex,
      shares: raw._amount,
      avgBuyPrice: 0,
      totalCost: 0,
      currentPrice,
      unrealizedPnl: 0,
      tradeCount: 0,
      profileUrl: `https://polymarket.com/profile/${raw.proxyWallet}`,
      totalPredictions: 0,
      joinedDate: 0,
    }
  })

  holders.sort((a, b) => b.shares - a.shares)
  holders.forEach((h, i) => { h.rank = i + 1 })

  return { outcome: outcomeName, tokenId, currentPrice, holders }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<TopHoldersResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')

  const conditionId = req.query.conditionId as string | undefined
  const tokenIdsParam = (req.query.tokenIds as string | undefined) ?? ''
  const outcomesParam = (req.query.outcomes as string | undefined) ?? ''
  const limitParam = Math.min(50, Math.max(1, Number.parseInt((req.query.limit as string) || '50', 10)))

  if (!conditionId) {
    return res.status(400).json(createErrorResponse('Missing required query param: conditionId'))
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(conditionId)) {
    return res.status(400).json(createErrorResponse('Invalid conditionId'))
  }

  const tokenIds = tokenIdsParam ? tokenIdsParam.split(',').map(s => s.trim()).filter(Boolean) : []
  const outcomes = outcomesParam ? outcomesParam.split(',').map(s => s.trim()).filter(Boolean) : []

  const cacheKey = `top-holders-v5:${conditionId}:${tokenIds.join('+')}:${limitParam}`
  const cached = cache.get<TopHoldersResponse>(cacheKey)
  if (cached) {
    return res.status(200).json(createSuccessResponse(cached))
  }

  try {
    const groupDefs: { tokenId: string; outcome: string; outcomeIndex: number }[] =
      tokenIds.length > 0
        ? tokenIds.map((tid, i) => ({
            tokenId: tid,
            outcome: outcomes[i] ?? `Outcome ${i + 1}`,
            outcomeIndex: i,
          }))
        : [{ tokenId: '', outcome: 'All', outcomeIndex: 0 }]

    const outcomeGroups = await pLimit(
      groupDefs.map(g => () =>
        fetchOutcomeHolders(conditionId, g.tokenId, g.outcome, g.outcomeIndex, limitParam)
      ),
      2
    )

    const response: TopHoldersResponse = {
      conditionId,
      outcomeGroups,
      fetchedAt: new Date().toISOString(),
    }

    cache.set(cacheKey, response, 60_000)
    return res.status(200).json(createSuccessResponse(response))
  } catch (err) {
    console.error('[top-holders] Error:', err)
    return res.status(500).json(
      createErrorResponse(err instanceof Error ? err.message : 'Internal server error')
    )
  }
}