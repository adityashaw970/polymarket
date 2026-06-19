import {
  SmartMoneyTrader,
  LeaderboardUser,
  UserTrade,
  UserPosition,
} from './types';

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

export function formatCurrency(amount: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatNumber(num: number, decimals: number = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatPercent(decimal: number, decimals: number = 2): string {
  return (decimal * 100).toFixed(decimals) + '%';
}

export function formatPrice(price: number, decimals: number = 4): string {
  return price.toFixed(decimals);
}

export function formatAddress(address: string, chars: number = 6): string {
  if (!address || address.length < 10) return address;
  return address.slice(0, chars) + '...' + address.slice(-chars);
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDaysAgo(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ============================================================================
// CALCULATION UTILITIES
// ============================================================================

export function calculateWinRate(trades: UserTrade[]): number {
  if (trades.length === 0) return 0;

  // Group trades by market to determine if profitable
  const tradesByMarket = new Map<string, UserTrade[]>();
  trades.forEach((t) => {
    if (!tradesByMarket.has(t.marketId)) {
      tradesByMarket.set(t.marketId, []);
    }
    tradesByMarket.get(t.marketId)!.push(t);
  });

  let winCount = 0;
  tradesByMarket.forEach((marketTrades) => {
    const buyCost = marketTrades
      .filter((t) => t.side === 'BUY')
      .reduce((sum, t) => sum + t.totalCost, 0);
    const sellRevenue = marketTrades
      .filter((t) => t.side === 'SELL')
      .reduce((sum, t) => sum + t.totalCost, 0);

    if (sellRevenue > buyCost) {
      winCount++;
    }
  });

  return winCount / tradesByMarket.size;
}

export function calculateProfitPerPrediction(pnl: number, predictionsCount: number): number {
  if (predictionsCount === 0) return 0;
  return pnl / predictionsCount;
}

export function calculateRiskScore(
  volatility: number,
  avgTradeSize: number,
  largeTradesRatio: number
): number {
  // Risk = size * volatility * concentration
  const baseRisk = volatility * 20; // Normalize volatility
  const sizeRisk = Math.min(100, avgTradeSize / 100); // Larger avg = more risk
  const concentrationRisk = largeTradesRatio * 100; // More concentrated = more risk

  return Math.min(100, (baseRisk + sizeRisk + concentrationRisk) / 3);
}

export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;

  return Math.sqrt(avgSquareDiff);
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidConditionId(id: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(id);
}

export function isValidMarketId(id: string): boolean {
  // Market IDs can be slugs or condition IDs
  return /^[a-zA-Z0-9\-]+$/.test(id) || isValidConditionId(id);
}

// ============================================================================
// SORTING UTILITIES
// ============================================================================

export function sortTraders(
  traders: SmartMoneyTrader[],
  sortBy: 'score' | 'pnl' | 'profitPerPred' | 'winRate' | 'volume',
  descending: boolean = true
): SmartMoneyTrader[] {
  const sorted = [...traders];

  sorted.sort((a, b) => {
    let aValue: number;
    let bValue: number;

    switch (sortBy) {
      case 'score':
        aValue = a.smartMoneyScore.totalScore;
        bValue = b.smartMoneyScore.totalScore;
        break;
      case 'pnl':
        aValue = a.pnl;
        bValue = b.pnl;
        break;
      case 'profitPerPred':
        aValue = a.profitPerPrediction;
        bValue = b.profitPerPrediction;
        break;
      case 'winRate':
        aValue = a.winRate;
        bValue = b.winRate;
        break;
      case 'volume':
        aValue = a.volume;
        bValue = b.volume;
        break;
      default:
        return 0;
    }

    return descending ? bValue - aValue : aValue - bValue;
  });

  return sorted;
}

// ============================================================================
// FILTERING UTILITIES
// ============================================================================

export function filterTraders(
  traders: SmartMoneyTrader[],
  filters: {
    minScore?: number;
    minPnL?: number;
    maxPnL?: number;
    minPredictions?: number;
    maxPredictions?: number;
    minWinRate?: number;
    maxJoinedDaysAgo?: number;
  }
): SmartMoneyTrader[] {
  return traders.filter((t) => {
    if (filters.minScore !== undefined && t.smartMoneyScore.totalScore < filters.minScore) return false;
    if (filters.minPnL !== undefined && t.pnl < filters.minPnL) return false;
    if (filters.maxPnL !== undefined && t.pnl > filters.maxPnL) return false;
    if (filters.minPredictions !== undefined && t.predictionsCount < filters.minPredictions) return false;
    if (filters.maxPredictions !== undefined && t.predictionsCount > filters.maxPredictions) return false;
    if (filters.minWinRate !== undefined && t.winRate < filters.minWinRate) return false;
    if (filters.maxJoinedDaysAgo !== undefined && t.joinedDaysAgo > filters.maxJoinedDaysAgo) return false;
    return true;
  });
}

// ============================================================================
// PAGINATION UTILITIES
// ============================================================================

export function paginate<T>(items: T[], limit: number, offset: number): { items: T[]; total: number } {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
  };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number
) {
  return {
    data: items.slice(offset, offset + limit),
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

// ============================================================================
// API RESPONSE UTILITIES
// ============================================================================

export function createSuccessResponse<T>(data: T, timestamp: number = Date.now()) {
  return {
    success: true,
    data,
    timestamp,
  };
}

export function createErrorResponse(error: string, timestamp: number = Date.now()) {
  return {
    success: false,
    error,
    timestamp,
  };
}

// ============================================================================
// AGGREGATION UTILITIES
// ============================================================================

export function aggregateTraderMetrics(trader: LeaderboardUser, trades: UserTrade[], positions: UserPosition[]) {
  const winRate = calculateWinRate(trades);
  const predictionCount = Math.max(1, new Set(trades.map((trade) => trade.marketId)).size || trader.predictionsCount);
  const profitPerPrediction = calculateProfitPerPrediction(trader.pnl, predictionCount);

  const sizes = trades.map((t) => t.sharesTraded);
  const avgTradeSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const largeTradesCount = sizes.filter((s) => s > 1000).length;

  const earlyEntries = trades.filter(
    (t) => t.side === 'BUY' && t.pricePerShare < 0.3
  );
  const earlyEntryCount = earlyEntries.length;

  const buys = trades.filter((t) => t.side === 'BUY');
  const highConvictionCount = buys.length > 0 && buys.length / trades.length > 0.7 ? 1 : 0;
  const avgPositionValue =
    positions.length > 0 ? positions.reduce((sum, position) => sum + position.currentValue, 0) / positions.length : 0;

  const riskScore = calculateRiskScore(
    calculateStandardDeviation(sizes) / Math.max(1, avgTradeSize),
    avgTradeSize,
    Math.min(1, largeTradesCount / Math.max(1, trades.length)) + Math.min(1, avgPositionValue / 10000)
  );

  return {
    winRate,
    profitPerPrediction,
    avgTradeSize,
    largeTradesCount,
    earlyEntryCount,
    highConvictionCount,
    riskScore,
  };
}

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

export function compareTraders(trader1: SmartMoneyTrader, trader2: SmartMoneyTrader) {
  return {
    scoreRatio: trader2.smartMoneyScore.totalScore === 0 ? 0 : trader1.smartMoneyScore.totalScore / trader2.smartMoneyScore.totalScore,
    pnlRatio: trader2.pnl === 0 ? 0 : trader1.pnl / trader2.pnl,
    winRateRatio: trader2.winRate === 0 ? 0 : trader1.winRate / trader2.winRate,
    volumeRatio: trader2.volume === 0 ? 0 : trader1.volume / trader2.volume,
  };
}

// ============================================================================
// TIME UTILITIES
// ============================================================================

export function daysAgo(timestamp: number): number {
  const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return Math.floor((Date.now() - normalized) / (24 * 60 * 60 * 1000));
}

export function hoursAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / (60 * 60 * 1000));
}

export function minutesAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / (60 * 1000));
}

export function getTimestampDaysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

// ============================================================================
// BATCH UTILITIES
// ============================================================================

export async function batchMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number = 5
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }

  return results;
}

export async function batchFetch<T>(
  ids: string[],
  fn: (id: string) => Promise<T>,
  batchSize: number = 10
): Promise<Map<string, T>> {
  const results = new Map<string, T>();

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((id) => fn(id).then((data) => ({ id, data }))));
    batchResults.forEach(({ id, data }) => results.set(id, data));
  }

  return results;
}
