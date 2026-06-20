import {
  OrderBook,
  OrderBookAnalytics,
  PriceSizeLevel,
  WhaleOrder,
  OrderBookSnapshot,
  UserTrade,
  CLOBPrice,
  PriceLevel,
} from './types'

// Type alias so analytics can also work with Record<string, unknown> levels
type AnyLevel = { price: number; size: number }

// ============================================================================
// CORE ANALYTICS COMPUTATION
// ============================================================================

export function computeOrderBookAnalytics(
  book: OrderBook,
  recentTrades: UserTrade[],
  priceHistory: CLOBPrice[],
  previousSnapshot?: OrderBookSnapshot | null
): OrderBookAnalytics {
  const now = Date.now()

  const bestBid = book.bids[0]?.price ?? 0
  const bestAsk = book.asks[0]?.price ?? 1
  const spread = Math.max(0, bestAsk - bestBid)
  const midpoint = (bestBid + bestAsk) / 2
  const spreadPercent = midpoint > 0 ? (spread / midpoint) * 100 : 0

  const totalBidSize = sumSizes(book.bids)
  const totalAskSize = sumSizes(book.asks)
  // Use top-10 depth-weighted imbalance for tighter signal
  const top10Bids = book.bids.slice(0, 10)
  const top10Asks = book.asks.slice(0, 10)
  const bidUsd = top10Bids.reduce((s, l) => s + l.price * l.size, 0)
  const askUsd = top10Asks.reduce((s, l) => s + l.price * l.size, 0)

  const finalBidVal = bidUsd > 0 ? bidUsd : totalBidSize * (book.bids[0]?.price ?? 0.5)
  const finalAskVal = askUsd > 0 ? askUsd : totalAskSize * (book.asks[0]?.price ?? 0.5)

  const imbalance = calcBidAskImbalance(finalBidVal, finalAskVal)
  const weightedMidPrice = calcWeightedMidPrice(bestBid, bestAsk, finalBidVal, finalAskVal)

  // USD-notional depth
  const bidDepth5 = book.bids.slice(0, 5).reduce((s, l) => s + l.price * l.size, 0)
  const askDepth5 = book.asks.slice(0, 5).reduce((s, l) => s + l.price * l.size, 0)
  const bidDepth10 = book.bids.slice(0, 10).reduce((s, l) => s + l.price * l.size, 0)
  const askDepth10 = book.asks.slice(0, 10).reduce((s, l) => s + l.price * l.size, 0)

  const supportLevels = calcSupportResistance(book.bids)
  const resistanceLevels = calcSupportResistance(book.asks)

  // Slippage: buy side walks asks ascending (asks[0]=best/lowest, so we walk upward)
  // Sell side walks bids descending (bids[0]=best/highest, so we walk downward)
  const slippage100 = calcBuySlippage(book.asks, 100)
  const slippage500 = calcBuySlippage(book.asks, 500)
  const slippage1000 = calcBuySlippage(book.asks, 1000)
  const slippage5000 = calcBuySlippage(book.asks, 5000)
  const sellSlippage100 = calcSellSlippage(book.bids, 100)
  const sellSlippage500 = calcSellSlippage(book.bids, 500)
  const sellSlippage1000 = calcSellSlippage(book.bids, 1000)
  const sellSlippage5000 = calcSellSlippage(book.bids, 5000)

  const orderFlow = calcNetOrderFlow(recentTrades)
  const whaleData = calcWhaleActivity(recentTrades)
  const spoofingScore = calcSpoofingScore(book, previousSnapshot)
  const marketMakerScore = calcMarketMakerScore(book)

  const nextTick = calcNextTickProbability(imbalance, orderFlow.netFlow, orderFlow.buyVolume + orderFlow.sellVolume)
  const volatility = calcVolatilityMetrics(priceHistory, book)

  const liquidityScore = calcLiquidityScore(book, spread, book.bids.length, book.asks.length)
  const liquidityChange = previousSnapshot
    ? calcLiquidityChange(totalBidSize + totalAskSize, previousSnapshot.totalBidSize + previousSnapshot.totalAskSize)
    : 0

  const hiddenLiquidityEstimate = calcHiddenLiquidity(recentTrades, totalBidSize + totalAskSize)

  // Compute cancellations
  const cancellations = calcCancellations(book, previousSnapshot, recentTrades)

  // Compute time-based trade rate using a fixed recent 60-second window
  const nowTime = Date.now()
  const ONE_MIN_MS = 60_000
  const recentWindow = recentTrades.filter(t => t.timestamp > 0 && (nowTime - t.timestamp) < ONE_MIN_MS)
  const ordersPerMinute = recentWindow.length
  const newOrdersPerSecond = recentWindow.length / 60

  // Compute execution speed
  const sortedTrades = [...recentTrades].sort((a, b) => b.timestamp - a.timestamp)
  let executionSpeedSeconds = 0
  let executionSpeedTradesPerSecond = 0
  if (sortedTrades.length >= 2) {
    const timeDiffs: number[] = []
    for (let i = 1; i < sortedTrades.length; i++) {
      const diff = (sortedTrades[i - 1].timestamp - sortedTrades[i].timestamp) / 1000
      if (diff >= 0 && diff < 3600) { // filter out gaps larger than an hour
        timeDiffs.push(diff)
      }
    }
    if (timeDiffs.length > 0) {
      const sorted = [...timeDiffs].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      executionSpeedSeconds = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid]
      executionSpeedTradesPerSecond = executionSpeedSeconds > 0 ? 1 / executionSpeedSeconds : 0
    }
  }

  return {
    tokenId: book.tokenId,
    timestamp: now,

    bestBid,
    bestAsk,
    spread,
    spreadPercent,
    midpoint,
    weightedMidPrice,

    bidAskImbalance: imbalance,
    totalBidSize,
    totalAskSize,
    bidDepth5,
    askDepth5,
    bidDepth10,
    askDepth10,
    bidLevels: book.bids.length,
    askLevels: book.asks.length,

    supportLevels,
    resistanceLevels,

    slippage100,
    slippage500,
    slippage1000,
    slippage5000,
    sellSlippage100,
    sellSlippage500,
    sellSlippage1000,
    sellSlippage5000,

    netOrderFlow: orderFlow.netFlow,
    buyVolume: orderFlow.buyVolume,
    sellVolume: orderFlow.sellVolume,
    tradeCount: recentTrades.length,
    avgTradeSize: orderFlow.avgSize,
    ordersPerMinute,

    whaleOrders: whaleData.whaleOrders,
    whaleActivity: whaleData.score,

    spoofingScore,
    marketMakerScore,

    nextTickUpProbability: nextTick.up,
    nextTickDownProbability: nextTick.down,

    realizedVolatility: volatility.realized,
    impliedVolatility: volatility.implied,
    volatilityForecast: volatility.forecast,

    liquidityScore,
    liquidityChange,

    hiddenLiquidityEstimate,

    cancellationCount: cancellations.count,
    cancellationVolume: cancellations.volume,
    newOrdersPerSecond,
    executionSpeedSeconds,
    executionSpeedTradesPerSecond,
  }
}

// ============================================================================
// CREATE SNAPSHOT FOR TRACKING CHANGES
// ============================================================================

export function createOrderBookSnapshot(book: OrderBook): OrderBookSnapshot {
  const totalBidSize = sumSizes(book.bids)
  const totalAskSize = sumSizes(book.asks)
  const bestBid = book.bids[0]?.price ?? 0
  const bestAsk = book.asks[0]?.price ?? 1

  return {
    tokenId: book.tokenId,
    timestamp: Date.now(),
    totalBidSize,
    totalAskSize,
    spread: Math.max(0, bestAsk - bestBid),
    midpoint: (bestBid + bestAsk) / 2,
    imbalance: calcBidAskImbalance(totalBidSize, totalAskSize),
    bids: book.bids,
    asks: book.asks,
  }
}

// ============================================================================
// INDIVIDUAL METRIC FUNCTIONS
// ============================================================================

function calcCancellations(
  currentBook: OrderBook,
  previousSnapshot?: OrderBookSnapshot | null,
  recentTrades?: UserTrade[]
): { count: number; volume: number } {
  if (!previousSnapshot?.bids || !previousSnapshot?.asks) return { count: 0, volume: 0 }

  const TICK = 0.001
  const round = (p: number) => Math.round(p / TICK) * TICK

  // Executed volume at each rounded price since snapshot
  const tradesSince = (recentTrades ?? []).filter(t => t.timestamp > previousSnapshot.timestamp)
  const executedAtPrice = new Map<number, number>()
  tradesSince.forEach(t => {
    const rp = round(t.pricePerShare)
    executedAtPrice.set(rp, (executedAtPrice.get(rp) ?? 0) + t.sharesTraded)
  })

  let count = 0, volume = 0

  // Check bids separately
  const prevBids = new Map(previousSnapshot.bids.map(l => [round(l.price), l.size]))
  const currBids = new Map(currentBook.bids.map(l => [round(l.price), l.size]))
  for (const [price, prevSize] of prevBids) {
    const currSize = currBids.get(price) ?? 0
    const decrease = prevSize - currSize
    if (decrease > 0) {
      const filled = executedAtPrice.get(price) ?? 0
      const cancelled = Math.max(0, decrease - filled)
      if (cancelled > 0.0001) { count++; volume += cancelled }
    }
  }

  // Check asks separately
  const prevAsks = new Map(previousSnapshot.asks.map(l => [round(l.price), l.size]))
  const currAsks = new Map(currentBook.asks.map(l => [round(l.price), l.size]))
  for (const [price, prevSize] of prevAsks) {
    const currSize = currAsks.get(price) ?? 0
    const decrease = prevSize - currSize
    if (decrease > 0) {
      const filled = executedAtPrice.get(price) ?? 0
      const cancelled = Math.max(0, decrease - filled)
      if (cancelled > 0.0001) { count++; volume += cancelled }
    }
  }

  return { count, volume }
}

function sumSizes(levels: PriceLevel[]): number {
  return levels.reduce((sum, l) => sum + l.size, 0)
}

function calcBidAskImbalance(totalBid: number, totalAsk: number): number {
  const total = totalBid + totalAsk
  if (total === 0) return 0
  return (totalBid - totalAsk) / total // -1 to 1
}

function calcWeightedMidPrice(bestBid: number, bestAsk: number, bidSize: number, askSize: number): number {
  const total = bidSize + askSize
  if (total === 0) return (bestBid + bestAsk) / 2
  // Weighted by opposite side (more bids → price pushed up)
  return (bestBid * askSize + bestAsk * bidSize) / total
}

function calcSupportResistance(levels: PriceLevel[]): PriceSizeLevel[] {
  if (levels.length === 0) return []
  const prices = levels.map(l => l.price)
  const range = Math.max(...prices) - Math.min(...prices)
  const bucketSize = range > 0 ? range / 20 : 0.01  // ~20 buckets across the range

  const clusters = new Map<number, number>()
  for (const level of levels) {
    const bucket = Math.round(level.price / bucketSize) * bucketSize
    clusters.set(bucket, (clusters.get(bucket) ?? 0) + level.size)
  }

  const sorted = Array.from(clusters.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  let cumulative = 0
  return sorted.map(([price, size]) => {
    cumulative += size
    return { price, size, cumulative }
  })
}

// Buy slippage: walk asks from lowest (best) upward
function calcBuySlippage(asks: AnyLevel[], orderSizeUsd: number): number {
  if (asks.length === 0 || orderSizeUsd <= 0) return 0

  // asks[0] is the best (lowest) ask — walk ascending
  const bestAsk = asks[0].price
  let remaining = orderSizeUsd
  let totalShares = 0
  let totalCost = 0

  for (const level of asks) {
    if (remaining <= 0) break
    const levelValue = level.size * level.price
    if (levelValue >= remaining) {
      const sharesToFill = remaining / level.price
      totalShares += sharesToFill
      totalCost += remaining
      remaining = 0
    } else {
      totalShares += level.size
      totalCost += levelValue
      remaining -= levelValue
    }
  }

  if (totalShares === 0) return 0
  const avgFillPrice = totalCost / totalShares
  return Math.max(0, ((avgFillPrice - bestAsk) / bestAsk) * 100)
}

// Sell slippage: walk bids from highest (best) downward
function calcSellSlippage(bids: AnyLevel[], orderSizeUsd: number): number {
  if (bids.length === 0 || orderSizeUsd <= 0) return 0

  // bids[0] is the best (highest) bid — walk descending
  const bestBid = bids[0].price
  let remaining = orderSizeUsd
  let totalShares = 0
  let totalRevenue = 0

  for (const level of bids) {
    if (remaining <= 0) break
    const levelValue = level.size * level.price
    if (levelValue >= remaining) {
      const sharesToFill = remaining / level.price
      totalShares += sharesToFill
      totalRevenue += remaining
      remaining = 0
    } else {
      totalShares += level.size
      totalRevenue += levelValue
      remaining -= levelValue
    }
  }

  if (totalShares === 0) return 0
  const avgFillPrice = totalRevenue / totalShares
  return Math.max(0, ((bestBid - avgFillPrice) / bestBid) * 100)
}



function calcNetOrderFlow(trades: UserTrade[]): {
  netFlow: number
  buyVolume: number
  sellVolume: number
  avgSize: number
} {
  let buyVolume = 0
  let sellVolume = 0

  for (const trade of trades) {
    const value = trade.sharesTraded * trade.pricePerShare
    const side = (trade.side ?? '').toString().toUpperCase()
    if (side === 'BUY') buyVolume += value
    else if (side === 'SELL') sellVolume += value
  }

  const avgSize = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.sharesTraded, 0) / trades.length
    : 0

  return {
    netFlow: buyVolume - sellVolume,
    buyVolume,
    sellVolume,
    avgSize,
  }
}

function calcWhaleActivity(trades: UserTrade[]): {
  whaleOrders: WhaleOrder[]
  score: number
} {
  if (trades.length < 5) return { whaleOrders: [], score: 0 }

  const sizes = trades.map(t => t.sharesTraded)
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
  const stdDev = Math.sqrt(
    sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length
  )

  if (stdDev === 0) return { whaleOrders: [], score: 0 }

  const threshold = 2 // 2 standard deviations
  const whaleOrders: WhaleOrder[] = trades
    .filter(t => {
      const zscore = (t.sharesTraded - mean) / stdDev
      return zscore >= threshold
    })
    .map(t => ({
      side: t.side as 'BUY' | 'SELL',
      price: t.pricePerShare,
      size: t.sharesTraded,
      timestamp: t.timestamp,
      zscore: (t.sharesTraded - mean) / stdDev,
    }))
    .sort((a, b) => b.zscore - a.zscore)
    .slice(0, 10)

  // Score: how much whale activity relative to total
  const whaleVolume = whaleOrders.reduce((sum, w) => sum + w.size, 0)
  const totalVolume = sizes.reduce((a, b) => a + b, 0)
  const score = Math.min(100, Math.round((whaleVolume / Math.max(1, totalVolume)) * 150))

  return { whaleOrders, score }
}

function calcSpoofingScore(book: OrderBook, previousSnapshot?: OrderBookSnapshot | null): number {
  if (!previousSnapshot) return 0

  // Spoofing: large size changes in short time (orders placed then quickly cancelled)
  const currentTotal = sumSizes(book.bids) + sumSizes(book.asks)
  const previousTotal = previousSnapshot.totalBidSize + previousSnapshot.totalAskSize

  if (previousTotal === 0) return 0

  const timeDiff = Date.now() - previousSnapshot.timestamp
  if (timeDiff > 30_000) return 0  // only last 30 seconds
  if (timeDiff < 1_000) return 0   // too fast to measure reliably

  // Rapid large changes indicate potential spoofing
  const changePercent = Math.abs(currentTotal - previousTotal) / previousTotal
  const rapidChange = changePercent > 0.3

  // Large one-sided imbalance shifts
  const imbalanceShift = Math.abs(
    calcBidAskImbalance(sumSizes(book.bids), sumSizes(book.asks)) - previousSnapshot.imbalance
  )

  let score = 0
  if (rapidChange) score += 40
  if (imbalanceShift > 0.3) score += 30
  if (changePercent > 0.5) score += 30

  return Math.min(100, score)
}

function calcMarketMakerScore(book: OrderBook): number {
  if (book.bids.length < 3 || book.asks.length < 3) return 0

  let score = 0

  // Tight spread indicates MM presence
  const bestBid = book.bids[0].price
  const bestAsk = book.asks[0].price
  const spread = bestAsk - bestBid
  if (spread < 0.02) score += 30
  else if (spread < 0.05) score += 15

  // Multiple price levels filled
  if (book.bids.length >= 8 && book.asks.length >= 8) score += 15
  else if (book.bids.length >= 5 && book.asks.length >= 5) score += 8

  // Consistent sizing across levels (within-side CV consistency)
  const bidSizes = book.bids.slice(0, 5).map(l => l.size)
  const askSizes = book.asks.slice(0, 5).map(l => l.size)
  const bidCV = coefficientOfVariation(bidSizes)
  const askCV = coefficientOfVariation(askSizes)
  score += Math.round((1 - Math.min(1, (bidCV + askCV) / 2)) * 55) // 0-55 pts

  return Math.min(100, score)
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 1
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 1
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length)
  return stdDev / mean
}

function calcNextTickProbability(
  imbalance: number,
  netFlow: number,
  totalVolume: number
): {
  up: number
  down: number
} {
  const imbalanceSignal = (imbalance + 1) / 2  // 0–1
  const normalizedFlow = totalVolume > 0 ? netFlow / totalVolume : 0  // -1 to 1
  const flowSignal = (normalizedFlow + 1) / 2  // 0–1

  const upProb = imbalanceSignal * 0.6 + flowSignal * 0.4
  const clampedUp = Math.max(0.05, Math.min(0.95, upProb))
  return {
    up: clampedUp,
    down: 1 - clampedUp,
  }
}

function calcVolatilityMetrics(priceHistory: CLOBPrice[], book: OrderBook): {
  realized: number
  implied: number
  forecast: number
} {
  // Realized volatility from price returns
  let realized = 0
  if (priceHistory.length >= 3) {
    const returns: number[] = []
    for (let i = 1; i < priceHistory.length; i++) {
      if (priceHistory[i - 1].price > 0) {
        const r = (priceHistory[i].price - priceHistory[i - 1].price) / priceHistory[i - 1].price
        if (Number.isFinite(r)) {
          returns.push(r)
        }
      }
    }

    if (returns.length > 0) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
      realized = Math.sqrt(variance) * 100 // as percentage
    }
  }

  // Implied volatility from orderbook spread and depth
  const bestBid = book.bids[0]?.price ?? 0
  const bestAsk = book.asks[0]?.price ?? 1
  const spread = bestAsk - bestBid
  const midpoint = (bestBid + bestAsk) / 2
  const totalDepth = sumSizes(book.bids) + sumSizes(book.asks)

  // Wider spread + lower depth → higher implied vol
  const spreadComponent = midpoint > 0 ? (spread / midpoint) * 100 : 0
  const depthComponent = totalDepth > 0 ? Math.max(0, 100 - totalDepth * 0.01) : 100
  const implied = (spreadComponent * 60 + depthComponent * 40) / 100

  // Blended forecast
  const forecast = realized > 0 ? realized * 0.6 + implied * 0.4 : implied

  return { realized, implied, forecast }
}

function calcLiquidityScore(book: OrderBook, spread: number, bidLevels: number, askLevels: number): number {
  let score = 0

  // Depth score (0-40) based on USD-notional depth
  const totalDepthUsd = book.bids.reduce((s, l) => s + l.price * l.size, 0)
                      + book.asks.reduce((s, l) => s + l.price * l.size, 0)
  score += Math.min(40, totalDepthUsd / 250)  // $10,000 USD depth = max 40 pts

  // Spread score (0-30)
  if (spread < 0.01) score += 30
  else if (spread < 0.03) score += 20
  else if (spread < 0.05) score += 10
  else if (spread < 0.10) score += 5

  // Level count score (0-15)
  const avgLevels = (bidLevels + askLevels) / 2
  score += Math.min(15, avgLevels * 1.5)

  // Balance score (0-15)
  const totalBid = sumSizes(book.bids)
  const totalAsk = sumSizes(book.asks)
  const balance = Math.min(totalBid, totalAsk) / Math.max(1, Math.max(totalBid, totalAsk))
  score += balance * 15

  return Math.min(100, Math.round(score))
}

function calcLiquidityChange(currentTotal: number, previousTotal: number): number {
  if (previousTotal === 0) return 0
  return ((currentTotal - previousTotal) / previousTotal) * 100
}

function calcHiddenLiquidity(trades: UserTrade[], visibleBookSize: number): number {
  if (trades.length < 5 || visibleBookSize === 0) return 0

  // Avg single trade size vs avg book replenishment implied by visible depth
  const avgTradeSize = trades.reduce((s, t) => s + t.sharesTraded, 0) / trades.length
  const impliedAvgLevelSize = visibleBookSize / Math.max(1, trades.length * 0.1)

  // If trades are consistently larger than the visible levels they consume,
  // the difference is a rough iceberg estimate
  const excess = Math.max(0, avgTradeSize - impliedAvgLevelSize)
  return excess * trades.length * 0.3
}
