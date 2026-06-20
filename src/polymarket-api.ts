import crypto from 'crypto'
import {
  API_ENDPOINTS,
  RATE_LIMITS,
} from './constants'
import {
  isValidConditionId,
  isValidWallet,
} from './utils'
import {
  CLOBPrice,
  GammaEvent,
  GammaMarket,
  LeaderboardUser,
  MarketHolder,
  OrderBook,
  PriceLevel,
  UserActivity,
  UserPosition,
  UserProfile,
  UserTrade,
} from './types'

type RawLeaderboardRow = {
  rank?: string | number
  proxyWallet: string
  userName?: string
  vol?: number
  pnl?: number
  profileImage?: string
  xUsername?: string
  verifiedBadge?: boolean
}

type RawMarket = Partial<GammaMarket> & {
  market_slug?: string
  question?: string
  volume?: number
  volume24hr?: number
  liquidity?: number
  closingTime?: string
  createdAt?: string
  updatedAt?: string
}

type RawEvent = Partial<GammaEvent> & {
  volume?: number
  volume24hr?: number
  liquidity?: number
  eventDate?: string
  // The Gamma API returns embedded markets in a `markets` field (not groupedMarkets)
  markets?: RawMarket[]
}

type RawPosition = {
  proxyWallet: string
  asset?: string
  conditionId: string
  size?: number
  avgPrice?: number
  initialValue?: number
  currentValue?: number
  cashPnl?: number
  percentPnl?: number
  curPrice?: number
  redeemable?: boolean
  mergeable?: boolean
  title?: string
  slug?: string
  icon?: string
  eventSlug?: string
  outcome?: string
  endDate?: string
}

type RawTrade = {
  proxyWallet?: string
  side?: 'BUY' | 'SELL'
  asset?: string
  conditionId?: string
  size?: number
  price?: number
  timestamp?: number
  title?: string
  slug?: string
  eventSlug?: string
  outcome?: string
  transactionHash?: string
  pseudonym?: string
  bio?: string
  profileImage?: string
  profileImageOptimized?: string
  outcomeIndex?: number
}

type RawActivity = RawTrade & {
  type?: UserActivity['type']
  usdcSize?: number
  transactionHash?: string
  name?: string
}

type RawHolderBucket = {
  token?: string
  holders?: Array<{
    proxyWallet: string
    pseudonym?: string
    name?: string
    profileImage?: string
    profileImageOptimized?: string
    displayUsernamePublic?: boolean
    outcomeIndex?: number
    amount?: number
    asset?: string
    bio?: string
  }>
}

class RateLimiter {
  private readonly capacity: number
  private readonly refillEveryMs: number
  private tokens: number
  private lastRefill = Date.now()

  constructor(capacity: number, refillEveryMs = 10_000) {
    this.capacity = Math.max(1, capacity)
    this.tokens = this.capacity
    this.refillEveryMs = refillEveryMs
  }

  async wait(): Promise<void> {
    this.refill()

    if (this.tokens < 1) {
      const waitTime = Math.ceil((1 - this.tokens) * (this.refillEveryMs / this.capacity))
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      this.refill()
    }

    this.tokens -= 1
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return

    const refillAmount = (elapsed / this.refillEveryMs) * this.capacity
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount)
    this.lastRefill = now
  }
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function toMsTimestamp(value: unknown): number {
  const numeric = toNumber(value)
  if (numeric <= 0) return 0
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
}

function normalizeArray<T>(payload: unknown, fallbackKey?: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && fallbackKey) {
    const maybeArray = (payload as Record<string, unknown>)[fallbackKey]
    if (Array.isArray(maybeArray)) return maybeArray as T[]
  }
  return []
}

function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, base)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function normalizeLeaderboardTimePeriod(
  value?: '1d' | '7d' | '30d' | '90d' | 'all' | 'DAY' | 'WEEK' | 'MONTH' | 'ALL' | string
): 'DAY' | 'WEEK' | 'MONTH' | 'ALL' {
  switch (String(value || 'DAY').toUpperCase()) {
    case '1D':
    case 'DAY':
      return 'DAY'
    case '7D':
    case 'WEEK':
      return 'WEEK'
    case '30D':
    case '90D':
    case 'MONTH':
      return 'MONTH'
    case 'ALL':
      return 'ALL'
    default:
      return 'DAY'
  }
}

function normalizeLeaderboardRow(row: RawLeaderboardRow): LeaderboardUser {
  return {
    proxyWallet: row.proxyWallet,
    userUsername: row.userName,
    userDisplayName: row.userName,
    profileImage: row.profileImage,
    xUsername: row.xUsername,
    verifiedBadge: row.verifiedBadge,
    rank: toNumber(row.rank),
    pnl: toNumber(row.pnl),
    volume: toNumber(row.vol),
    predictionsCount: 0,
    largestTrade: 0,
    joinedAt: 0,
    joinedDaysAgo: 0,
  }
}

function normalizeTrade(row: RawTrade): UserTrade {
  const size = toNumber(row.size)
  const price = toNumber(row.price)

  return {
    proxyWallet: row.proxyWallet || '',
    userUsername: row.pseudonym,
    conditionId: row.conditionId || '',
    marketId: row.conditionId || '',
    marketTitle: row.title || row.slug || 'Unknown market',
    outcome: row.outcome || 'Unknown',
    side: row.side || 'BUY',
    sharesTraded: size,
    pricePerShare: price,
    totalCost: size * price,
    timestamp: toMsTimestamp(row.timestamp),
    hashId: row.transactionHash || '',
    asset: row.asset || '',
    outcomeIndex: row.outcomeIndex,
  }
}

function normalizePosition(row: RawPosition): UserPosition {
  return {
    proxyWallet: row.proxyWallet,
    userUsername: undefined,
    userDisplayName: undefined,
    conditionId: row.conditionId,
    marketId: row.conditionId,
    marketTitle: row.title || row.slug || 'Unknown market',
    outcome: row.outcome || 'Unknown',
    size: toNumber(row.size),
    avgPrice: toNumber(row.avgPrice),
    price: toNumber(row.curPrice ?? row.avgPrice),
    cashPnl: toNumber(row.cashPnl),
    percentPnl: toNumber(row.percentPnl),
    initialValue: toNumber(row.initialValue),
    currentValue: toNumber(row.currentValue),
    redeemable: Boolean(row.redeemable),
    mergeable: Boolean(row.mergeable),
    resolveTime: row.endDate || '',
    asset: row.asset || '',
  }
}

function normalizeActivity(row: RawActivity): UserActivity {
  return {
    proxyWallet: row.proxyWallet || '',
    userUsername: row.pseudonym,
    timestamp: toMsTimestamp(row.timestamp),
    type: row.type || 'TRADE',
    conditionId: row.conditionId || '',
    marketTitle: row.title || row.slug || 'Unknown market',
    outcome: row.outcome || 'Unknown',
    side: row.side,
    tokensChanged: toNumber(row.size),
    cashChanged: toNumber(row.usdcSize ?? row.price),
    hashId: row.transactionHash || '',
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map(String)
      } catch {
        // ignore parse failure and fall back
      }
    }
    return trimmed.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  return []
}

function normalizeMarket(raw: RawMarket): GammaMarket {
  const outcomes = parseStringArray(raw.outcomes)
  const clobTokenIds = parseStringArray(raw.clobTokenIds)
  const events = Array.isArray(raw.events) ? raw.events : []
  const tags = Array.isArray(raw.tags) ? raw.tags : []

  return {
    id: raw.id || raw.conditionId || raw.slug || '',
    slug: raw.slug || raw.market_slug || '',
    title: raw.title || raw.question || 'Untitled market',
    description: raw.description || '',
    question: raw.question || raw.title || '',
    eventSlug: raw.eventSlug || '',
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    archived: Boolean(raw.archived),
    volume24hr: toNumber(raw.volume24hr ?? raw.volume),
    volumeAll: toNumber(raw.volumeAll ?? raw.volume),
    liquidity: toNumber(raw.liquidity),
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
    endDate: raw.endDate || raw.closingTime || '',
    outcomes,
    clobTokenIds,
    conditionId: raw.conditionId || raw.id || '',
    tags,
    events,
  }
}

function normalizeEvent(raw: RawEvent): GammaEvent {
  // Gamma API returns embedded markets in raw.markets (not raw.groupedMarkets)
  // We normalize both to cover any API version differences
  const rawMarkets: RawMarket[] = [
    ...(Array.isArray(raw.markets) ? raw.markets : []),
    ...(Array.isArray(raw.groupedMarkets) ? (raw.groupedMarkets as RawMarket[]) : []),
  ]
  const groupedMarkets = rawMarkets.map(normalizeMarket)
  const tags = Array.isArray(raw.tags) ? raw.tags : []

  return {
    id: raw.id || raw.slug || '',
    slug: raw.slug || '',
    title: raw.title || raw.description || 'Untitled event',
    description: raw.description || '',
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    archived: Boolean(raw.archived),
    volume24hr: toNumber(raw.volume24hr ?? raw.volume),
    volumeAll: toNumber(raw.volumeAll ?? raw.volume),
    liquidity: toNumber(raw.liquidity),
    createdAt: raw.createdAt || '',
    endDate: raw.endDate || raw.eventDate || '',
    tags,
    groupedMarkets,
  }
}

// ============================================================================
// CLOB L2 HMAC Authentication
// Set POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE, POLY_ADDRESS in .env.local
// See: https://docs.polymarket.com/developers/clob-api/authentication
// ============================================================================
function buildClobL2Headers(method: string, path: string, body = ''): Record<string, string> {
  const apiKey = process.env.POLY_API_KEY
  const secret = process.env.POLY_API_SECRET
  const passphrase = process.env.POLY_API_PASSPHRASE
  const address = process.env.POLY_ADDRESS

  if (!apiKey || !secret || !passphrase || !address) return {}

  const timestamp = Math.floor(Date.now() / 1000).toString()
  // Message = timestamp + method + path + body
  const message = timestamp + method.toUpperCase() + path + body
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'base64'))
  hmac.update(message)
  const signature = hmac.digest('base64')

  return {
    'POLY_ADDRESS': address,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_API_KEY': apiKey,
    'POLY_PASSPHRASE': passphrase,
  }
}

export class PolymarketAPI {
  private readonly gammaLimiter = new RateLimiter(RATE_LIMITS.GAMMA_API_GENERAL)
  private readonly dataLimiter = new RateLimiter(RATE_LIMITS.DATA_API_GENERAL)
  private readonly clobLimiter = new RateLimiter(RATE_LIMITS.CLOB_API_GENERAL)

  private async requestJson<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
    let lastError: Error | null = null
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8_000)
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; PolymarketTracker/1.0)',
            ...(init?.headers as Record<string, string> | undefined),
          },
        })
        clearTimeout(timeoutId)
        if (response.ok) {
          return await response.json() as T
        }
        let body = ''
        try { body = await response.text() } catch { /* ignore */ }
        
        // If it's a client error (except 429), throw immediately and don't retry
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`Request failed (${response.status}) for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`)
        }
        lastError = new Error(`Request failed (${response.status}) for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`)
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(`Request timed out after 8s for ${url}`)
        } else {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, i)))
      }
    }
    throw lastError || new Error(`Request failed for ${url}`)
  }

  /** Make an authenticated CLOB API request using L2 HMAC headers (if credentials set) */
  private async requestClobJson<T>(url: string, init?: RequestInit, retries = 3): Promise<T> {
    const parsedUrl = new URL(url)
    const path = parsedUrl.pathname + parsedUrl.search
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : ''
    let authHeaders = buildClobL2Headers(method, path, body)

    let lastError: Error | null = null
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8_000)
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; PolymarketTracker/1.0)',
            ...authHeaders,
            ...(init?.headers as Record<string, string> | undefined),
          },
        })
        clearTimeout(timeoutId)
        if (response.ok) {
          return await response.json() as T
        }
        let responseBody = ''
        try { responseBody = await response.text() } catch { /* ignore */ }
        
        // If auth failed (400, 401, 403) and we used auth headers, fallback to public (clear headers)
        if ((response.status === 400 || response.status === 401 || response.status === 403) && Object.keys(authHeaders).length > 0) {
          console.warn(`[CLOB API] Request failed (${response.status}) for ${url}. Falling back to unauthenticated request...`)
          authHeaders = {}
          continue
        }

        // If it's a client error (except 429), throw immediately and don't retry
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`CLOB request failed (${response.status}) for ${url}${responseBody ? `: ${responseBody.slice(0, 200)}` : ''}`)
        }
        lastError = new Error(`CLOB request failed (${response.status}) for ${url}${responseBody ? `: ${responseBody.slice(0, 200)}` : ''}`)
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error(`CLOB request timed out after 8s for ${url}`)
        } else {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, i)))
      }
    }
    throw lastError || new Error(`CLOB request failed for ${url}`)
  }

  async getMarkets(params?: {
    limit?: number
    offset?: number
    active?: boolean
    closed?: boolean
    tag?: string
    slug?: string
    orderBy?: 'volume' | 'liquidity' | 'volumeAll'
    ascending?: boolean
  }): Promise<{ markets: GammaMarket[]; count: number }> {
    await this.gammaLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.GAMMA_API, '/markets', {
      limit: params?.limit,
      offset: params?.offset,
      active: params?.active,
      closed: params?.closed,
      tag: params?.tag,
      slug: params?.slug,
      orderBy: params?.orderBy,
      ascending: params?.ascending,
    })

    const payload = await this.requestJson<unknown>(url)
    const markets = normalizeArray<RawMarket>(payload, 'markets').map(normalizeMarket)
    const count =
      payload && typeof payload === 'object' && 'count' in payload
        ? toNumber((payload as Record<string, unknown>).count, markets.length)
        : markets.length

    return { markets, count }
  }

  async getMarket(idOrSlug: string): Promise<GammaMarket | null> {
    const bySlug = await this.getMarkets({ slug: idOrSlug, limit: 1 })
    if (bySlug.markets[0]) return bySlug.markets[0]
    return null
  }

  async getEvents(params?: {
    limit?: number
    offset?: number
    active?: boolean
    closed?: boolean
    tag?: string
    slug?: string
    orderBy?: 'volume' | 'liquidity' | 'volumeAll'
    ascending?: boolean
  }): Promise<{ events: GammaEvent[]; count: number }> {
    await this.gammaLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.GAMMA_API, '/events', {
      limit: params?.limit,
      offset: params?.offset,
      active: params?.active,
      closed: params?.closed,
      tag: params?.tag,
      slug: params?.slug,
      orderBy: params?.orderBy,
      ascending: params?.ascending,
    })

    const payload = await this.requestJson<unknown>(url)
    const events = normalizeArray<RawEvent>(payload, 'events').map(normalizeEvent)
    const count =
      payload && typeof payload === 'object' && 'count' in payload
        ? toNumber((payload as Record<string, unknown>).count, events.length)
        : events.length

    return { events, count }
  }

  /**
   * Look up an event by its slug.
   * Returns null if the slug is not found — callers must handle null.
   *
   * NOTE: The Gamma API does NOT support /events/{slug} path lookups (returns 422).
   * The ONLY supported lookup is GET /events?slug=<slug>.
   */
  async getEvent(idOrSlug: string): Promise<GammaEvent | null> {
    const bySlug = await this.getEvents({ slug: idOrSlug, limit: 1 })
    return bySlug.events[0] ?? null
  }

  async search(query: string, limit = 10): Promise<unknown> {
    await this.gammaLimiter.wait()
    const url = buildUrl(API_ENDPOINTS.GAMMA_API, '/public-search', { query, limit })
    return this.requestJson<unknown>(url)
  }

  async getPositions(params: {
    user: string
    limit?: number
    offset?: number
    conditionId?: string
    market?: string
    sortBy?: 'tokens' | 'value' | 'cashPnl' | 'percentPnl'
    sortDirection?: 'asc' | 'desc'
  }): Promise<UserPosition[]> {
    if (!isValidWallet(params.user)) {
      throw new Error('Invalid wallet address')
    }

    await this.dataLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.DATA_API, '/positions', {
      user: params.user,
      limit: params.limit,
      offset: params.offset,
      conditionId: params.conditionId,
      market: params.market,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
    })

    const payload = await this.requestJson<unknown>(url)
    return normalizeArray<RawPosition>(payload).map(normalizePosition)
  }

  async getTrades(params: {
    user?: string
    limit?: number
    offset?: number
    conditionId?: string
    market?: string
    side?: 'BUY' | 'SELL'
    sortBy?: 'timestamp' | 'tokens' | 'cash'
    sortDirection?: 'asc' | 'desc'
    start?: number
    end?: number
  }): Promise<UserTrade[]> {
    if (params.user && !isValidWallet(params.user)) {
      throw new Error('Invalid wallet address')
    }
    if (params.conditionId && !isValidConditionId(params.conditionId)) {
      throw new Error('Invalid condition ID')
    }

    await this.dataLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.DATA_API, '/trades', {
      user: params.user,
      limit: params.limit,
      offset: params.offset,
      market: params.market || params.conditionId,
      side: params.side,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
      start: params.start,
      end: params.end,
    })

    const payload = await this.requestJson<unknown>(url)
    return normalizeArray<RawTrade>(payload).map(normalizeTrade)
  }

  async getActivity(params: {
    user: string
    limit?: number
    offset?: number
    type?: string
    conditionId?: string
    market?: string
    startTime?: number
    endTime?: number
    sortBy?: 'timestamp' | 'tokens' | 'cash'
    sortDirection?: 'asc' | 'desc'
    side?: 'BUY' | 'SELL'
  }): Promise<UserActivity[]> {
    if (!isValidWallet(params.user)) {
      throw new Error('Invalid wallet address')
    }

    await this.dataLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.DATA_API, '/activity', {
      user: params.user,
      limit: params.limit,
      offset: params.offset,
      type: params.type,
      conditionId: params.conditionId,
      market: params.market,
      start: params.startTime,
      end: params.endTime,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
      side: params.side,
    })

    const payload = await this.requestJson<unknown>(url)
    return normalizeArray<RawActivity>(payload).map(normalizeActivity)
  }

  async getTradedCount(user: string): Promise<number> {
    if (!isValidWallet(user)) {
      throw new Error('Invalid wallet address')
    }
    await this.dataLimiter.wait()
    const url = buildUrl(API_ENDPOINTS.DATA_API, '/traded', { user })
    const payload = await this.requestJson<{ traded?: number }>(url)
    return toNumber(payload?.traded)
  }

  async getLeaderboard(params?: {
    limit?: number
    offset?: number
    timePeriod?: '1d' | '7d' | '30d' | '90d' | 'all' | 'DAY' | 'WEEK' | 'MONTH' | 'ALL'
    orderBy?: 'pnl' | 'volume' | 'PNL' | 'VOL'
    category?: string
    user?: string
    userName?: string
  }): Promise<LeaderboardUser[]> {
    await this.dataLimiter.wait()

    const timePeriod = normalizeLeaderboardTimePeriod(params?.timePeriod)
    const orderBy = params?.orderBy ? String(params.orderBy).toUpperCase() : 'PNL'
    const limit = Math.min(Math.max(params?.limit ?? 25, 1), 50)
    const offset = Math.min(Math.max(params?.offset ?? 0, 0), 1000)

    const url = buildUrl(API_ENDPOINTS.DATA_API, '/v1/leaderboard', {
      limit,
      offset,
      timePeriod,
      orderBy,
      category: params?.category,
      user: params?.user,
      userName: params?.userName,
    })

    const payload = await this.requestJson<unknown>(url)
    return normalizeArray<RawLeaderboardRow>(payload).map(normalizeLeaderboardRow)
  }

  async getMarketHolders(params: {
    marketId: string
    conditionId?: string
    limit?: number
    offset?: number
    sortBy?: 'size' | 'value' | 'pnl'
    sortDirection?: 'asc' | 'desc'
  }): Promise<MarketHolder[]> {
    if (!isValidConditionId(params.marketId)) {
      throw new Error('Invalid market ID')
    }

    await this.dataLimiter.wait()

    const url = buildUrl(API_ENDPOINTS.DATA_API, '/holders', {
      market: params.marketId,
      conditionId: params.conditionId,
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
    })

    const payload = await this.requestJson<unknown>(url)
    const buckets = normalizeArray<RawHolderBucket>(payload)
    const holders = buckets.flatMap((bucket) =>
      (bucket.holders || []).map((holder) => ({
        proxyWallet: holder.proxyWallet,
        userUsername: holder.pseudonym || holder.name,
        userDisplayName: holder.name || holder.pseudonym,
        profileImage: holder.profileImageOptimized || holder.profileImage,
        outcome: String(holder.outcomeIndex ?? bucket.token ?? 'Unknown'),
        size: toNumber(holder.amount),
        averagePrice: 0,
        currentPrice: 0,
        cashPnl: 0,
        percentPnl: 0,
      }))
    )

    return holders
  }

  async getPrice(tokenId: string): Promise<CLOBPrice> {
    await this.clobLimiter.wait()
    const url = buildUrl(API_ENDPOINTS.CLOB_API, '/price', { token_id: tokenId })
    const payload = await this.requestClobJson<Record<string, unknown>>(url)
    return {
      tokenId,
      price: toNumber(payload.price),
      timestamp: toNumber(payload.timestamp),
      bid: toNumber(payload.bid, NaN) || undefined,
      ask: toNumber(payload.ask, NaN) || undefined,
      midpoint: toNumber(payload.midpoint, NaN) || undefined,
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    await this.clobLimiter.wait()
    const url = buildUrl(API_ENDPOINTS.CLOB_API, '/book', { token_id: tokenId })
    // Use authenticated request if credentials are available, otherwise fall back to public
    const payload = await this.requestClobJson<Record<string, unknown>>(url)

    // CLOB API returns bids ascending (worst→best) and asks descending (worst→best)
    // We normalize both to canonical order: bids descending (best bid first),
    // asks ascending (best ask first) so analytics code sees bids[0]=bestBid, asks[0]=bestAsk
    const rawBids = normalizeArray<Record<string, unknown>>(payload, 'bids').map((level) => ({
      price: toNumber(level.price),
      size: toNumber(level.size),
    }))
    const rawAsks = normalizeArray<Record<string, unknown>>(payload, 'asks').map((level) => ({
      price: toNumber(level.price),
      size: toNumber(level.size),
    }))

    // Sort: bids descending (highest price = best bid first)
    const bids = rawBids.sort((a, b) => b.price - a.price).filter(l => l.size > 0)
    // Sort: asks ascending (lowest price = best ask first)
    const asks = rawAsks.sort((a, b) => a.price - b.price).filter(l => l.size > 0)

    return {
      tokenId,
      bids,
      asks,
      timestamp: toMsTimestamp(payload.timestamp),
      conditionId: typeof payload.market === 'string' ? payload.market : undefined,
    }
  }

  async getProfile(address: string): Promise<UserProfile | null> {
    try {
      const url = buildUrl(API_ENDPOINTS.GAMMA_API, '/public-profile', { address })
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) return null
      const data = await response.json() as Record<string, unknown>
      if (!data || typeof data !== 'object') return null

      let createdAt = 0
      if (typeof data.createdAt === 'string') {
        const parsed = new Date(data.createdAt).getTime()
        if (Number.isFinite(parsed) && parsed > 0) createdAt = parsed
      }

      return {
        address,
        username: (data.pseudonym || data.name) as string | undefined,
        displayName: (data.name || data.pseudonym) as string | undefined,
        profileImage: data.profileImage as string | undefined,
        bio: data.bio as string | undefined,
        createdAt,
        // Not exposed by the official /public-profile endpoint
        positionsValue: 0,
        volume: 0,
        pnl: 0,
        predictions: 0,
      }
    } catch {
      return null
    }
  }

  async getTradesForMarket(conditionId: string, limit = 500): Promise<UserTrade[]> {
    return this.getTrades({ market: conditionId, limit })
  }

  async getPriceHistory(params: {
    tokenId: string
    startTime?: number
    endTime?: number
    interval?: '1h' | '6h' | '1d' | '1w' | '1m' | 'max'
    fidelity?: number
    limit?: number
  }): Promise<CLOBPrice[]> {
    await this.clobLimiter.wait()
    // NOTE: The CLOB API uses 'market' (not 'token_id') for price history.
    // Time range: use interval (relative) OR startTs/endTs (absolute) — not both.
    // Response format per docs: array of { t: unixSeconds, p: price }
    const urlParams: Record<string, string | number | boolean | undefined> = {
      market: params.tokenId,
      fidelity: params.fidelity ?? 60,
    }
    if (params.startTime || params.endTime) {
      // Absolute range — convert ms → seconds if needed
      if (params.startTime) {
        urlParams.startTs = params.startTime > 1_000_000_000_000
          ? Math.floor(params.startTime / 1000)
          : params.startTime
      }
      if (params.endTime) {
        urlParams.endTs = params.endTime > 1_000_000_000_000
          ? Math.floor(params.endTime / 1000)
          : params.endTime
      }
    } else {
      urlParams.interval = params.interval ?? '1d'
    }
    const url = buildUrl(API_ENDPOINTS.CLOB_API, '/prices-history', urlParams)
    const payload = await this.requestJson<unknown>(url)
    // The API wraps results: { history: [{t, p}, ...] } or a bare array
    const raw = payload && typeof payload === 'object' && 'history' in (payload as object)
      ? (payload as Record<string, unknown>).history
      : payload
    return normalizeArray<Record<string, unknown>>(raw).map((item) => ({
      tokenId: params.tokenId,
      // docs: { t: unixTimestamp (seconds), p: price }
      price: toNumber(item.p ?? item.price),
      timestamp: toMsTimestamp(item.t ?? item.timestamp),
      bid: undefined,
      ask: undefined,
      midpoint: undefined,
    }))
  }

  async getMidpoint(tokenId: string): Promise<number> {
    const book = await this.getOrderBook(tokenId)
    if (!book.bids.length || !book.asks.length) return 0.5
    // bids[0] = best bid (highest), asks[0] = best ask (lowest)
    return (book.bids[0].price + book.asks[0].price) / 2
  }

  async getSpread(tokenId: string): Promise<number> {
    const book = await this.getOrderBook(tokenId)
    if (!book.bids.length || !book.asks.length) return 0
    return Math.max(0, book.asks[0].price - book.bids[0].price)
  }
}

export const polymarketAPI = new PolymarketAPI()
