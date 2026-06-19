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
  const imbalance = calcBidAskImbalance(bidUsd || totalBidSize, askUsd || totalAskSize)
  const weightedMidPrice = calcWeightedMidPrice(bestBid, bestAsk, bidUsd || totalBidSize, askUsd || totalAskSize)

  const bidDepth5 = sumSizes(book.bids.slice(0, 5))
  const askDepth5 = sumSizes(book.asks.slice(0, 5))
  const bidDepth10 = sumSizes(book.bids.slice(0, 10))
  const askDepth10 = sumSizes(book.asks.slice(0, 10))

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

  const nextTick = calcNextTickProbability(imbalance, orderFlow.netFlow)
  const volatility = calcVolatilityMetrics(priceHistory, book)

  const liquidityScore = calcLiquidityScore(totalBidSize, totalAskSize, spread, book.bids.length, book.asks.length)
  const liquidityChange = previousSnapshot
    ? calcLiquidityChange(totalBidSize + totalAskSize, previousSnapshot.totalBidSize + previousSnapshot.totalAskSize)
    : 0

  const hiddenLiquidityEstimate = calcHiddenLiquidity(recentTrades, totalBidSize + totalAskSize)

  // Compute cancellations
  const cancellations = calcCancellations(book, previousSnapshot, recentTrades)

  // Compute time-based order rate
  const tradeTimestamps = recentTrades.map(t => t.timestamp).filter(t => t > 0)
  const timeSpanMs = tradeTimestamps.length >= 2
    ? Math.max(1, Math.max(...tradeTimestamps) - Math.min(...tradeTimestamps))
    : 60000
  const ordersPerMinute = recentTrades.length > 0
    ? (recentTrades.length / (timeSpanMs / 60000))
    : 0
  const newOrdersPerSecond = ordersPerMinute / 60

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
      executionSpeedSeconds = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length
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
  if (!previousSnapshot || !previousSnapshot.bids || !previousSnapshot.asks) {
    return { count: 0, volume: 0 }
  }

  let count = 0
  let volume = 0

  const prevLevels = new Map<number, number>()
  previousSnapshot.bids.forEach(l => prevLevels.set(l.price, l.size))
  previousSnapshot.asks.forEach(l => prevLevels.set(l.price, l.size))

  const currLevels = new Map<number, number>()
  currentBook.bids.forEach(l => currLevels.set(l.price, l.size))
  currentBook.asks.forEach(l => currLevels.set(l.price, l.size))

  // Find trades that happened since the previous snapshot
  const tradesSinceSnapshot = (recentTrades || []).filter(
    t => t.timestamp > previousSnapshot.timestamp
  )
  const tradesAtPrice = new Map<number, number>()
  tradesSinceSnapshot.forEach(t => {
    tradesAtPrice.set(t.pricePerShare, (tradesAtPrice.get(t.pricePerShare) || 0) + t.sharesTraded)
  })

  // Compare previous levels to current levels to find decreases
  for (const [price, prevSize] of prevLevels.entries()) {
    const currSize = currLevels.get(price) || 0
    if (currSize < prevSize) {
      const sizeDecrease = prevSize - currSize
      const executedVolume = tradesAtPrice.get(price) || 0
      const cancelled = Math.max(0, sizeDecrease - executedVolume)

      if (cancelled > 0.0001) {
        count++
        volume += cancelled
      }
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

  // Group nearby prices (within 1% of each other) and find clusters
  const clusters: Map<number, number> = new Map()
  const bucketSize = 0.01

  for (const level of levels) {
    const bucket = Math.round(level.price / bucketSize) * bucketSize
    clusters.set(bucket, (clusters.get(bucket) || 0) + level.size)
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

// Legacy alias (kept for backward compatibility)
function calcExpectedSlippage(levels: AnyLevel[], orderSizeUsd: number): number {
  return calcBuySlippage(levels, orderSizeUsd)
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
    if (trade.side === 'BUY') buyVolume += value
    else sellVolume += value
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
  if (trades.length < 3) return { whaleOrders: [], score: 0 }

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
  const score = Math.min(100, Math.round((whaleVolume / Math.max(1, totalVolume)) * 100 * 2))

  return { whaleOrders, score }
}

function calcSpoofingScore(book: OrderBook, previousSnapshot?: OrderBookSnapshot | null): number {
  if (!previousSnapshot) return 0

  // Spoofing: large size changes in short time (orders placed then quickly cancelled)
  const currentTotal = sumSizes(book.bids) + sumSizes(book.asks)
  const previousTotal = previousSnapshot.totalBidSize + previousSnapshot.totalAskSize

  if (previousTotal === 0) return 0

  const timeDiff = Date.now() - previousSnapshot.timestamp
  if (timeDiff > 300000) return 0 // Only look at last 5 minutes

  // Rapid large changes indicate potential spoofing
  const changePercent = Math.abs(currentTotal - previousTotal) / previousTotal
  const rapidChange = timeDiff < 60000 && changePercent > 0.3

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

  // Symmetric placement: check if bid/ask sizes are balanced at each level
  const pairsToCheck = Math.min(5, book.bids.length, book.asks.length)
  let symmetryScore = 0

  for (let i = 0; i < pairsToCheck; i++) {
    const bidSize = book.bids[i].size
    const askSize = book.asks[i].size
    const ratio = Math.min(bidSize, askSize) / Math.max(bidSize, askSize)
    symmetryScore += ratio
  }

  score += Math.round((symmetryScore / pairsToCheck) * 40)

  // Tight spread indicates MM presence
  const bestBid = book.bids[0].price
  const bestAsk = book.asks[0].price
  const spread = bestAsk - bestBid
  if (spread < 0.02) score += 30
  else if (spread < 0.05) score += 15

  // Multiple price levels filled
  if (book.bids.length >= 8 && book.asks.length >= 8) score += 15
  else if (book.bids.length >= 5 && book.asks.length >= 5) score += 8

  // Consistent sizing across levels
  const bidSizes = book.bids.slice(0, 5).map(l => l.size)
  const askSizes = book.asks.slice(0, 5).map(l => l.size)
  const bidCV = coefficientOfVariation(bidSizes)
  const askCV = coefficientOfVariation(askSizes)
  if (bidCV < 0.5 && askCV < 0.5) score += 15

  return Math.min(100, score)
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 1
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 1
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length)
  return stdDev / mean
}

function calcNextTickProbability(imbalance: number, netFlow: number): {
  up: number
  down: number
} {
  // Combine orderbook imbalance with recent order flow direction
  // More bids + positive net flow → likely price up
  const imbalanceSignal = (imbalance + 1) / 2 // normalize 0-1
  const flowSignal = netFlow > 0 ? Math.min(1, netFlow / 1000) * 0.5 + 0.5 : Math.max(0, 0.5 + netFlow / 1000)

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
        returns.push(Math.log(priceHistory[i].price / priceHistory[i - 1].price))
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

function calcLiquidityScore(totalBid: number, totalAsk: number, spread: number, bidLevels: number, askLevels: number): number {
  let score = 0

  // Depth score (0-40)
  const totalDepth = totalBid + totalAsk
  score += Math.min(40, totalDepth * 0.004)

  // Spread score (0-30)
  if (spread < 0.01) score += 30
  else if (spread < 0.03) score += 20
  else if (spread < 0.05) score += 10
  else if (spread < 0.10) score += 5

  // Level count score (0-15)
  const avgLevels = (bidLevels + askLevels) / 2
  score += Math.min(15, avgLevels * 1.5)

  // Balance score (0-15)
  const balance = Math.min(totalBid, totalAsk) / Math.max(1, Math.max(totalBid, totalAsk))
  score += balance * 15

  return Math.min(100, Math.round(score))
}

function calcLiquidityChange(currentTotal: number, previousTotal: number): number {
  if (previousTotal === 0) return 0
  return ((currentTotal - previousTotal) / previousTotal) * 100
}

function calcHiddenLiquidity(trades: UserTrade[], visibleBookSize: number): number {
  if (trades.length === 0 || visibleBookSize === 0) return 0

  // If executed volume significantly exceeds visible book, there's hidden liquidity
  const executedVolume = trades.reduce((sum, t) => sum + t.sharesTraded, 0)
  const ratio = executedVolume / visibleBookSize

  // If ratio > 1, more was executed than visible → hidden iceberg orders
  return Math.max(0, (ratio - 1) * visibleBookSize * 0.5)
}
