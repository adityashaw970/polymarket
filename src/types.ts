// ============================================================================
// POLYMARKET DATA STRUCTURES
// ============================================================================

export interface GammaMarket {
  id: string;
  slug: string;
  title: string;
  description: string;
  question: string;
  eventSlug: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  volume24hr: number;
  volumeAll: number;
  liquidity: number;
  createdAt: string;
  updatedAt: string;
  endDate: string;
  outcomes: string[];
  clobTokenIds: string[];
  conditionId: string;
  tags: string[];
  events: GammaEvent[];
}

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  volume24hr: number;
  volumeAll: number;
  liquidity: number;
  createdAt: string;
  endDate: string;
  tags: string[];
  groupedMarkets: GammaMarket[];
}

// ============================================================================
// DATA API STRUCTURES
// ============================================================================

export interface UserPosition {
  proxyWallet: string;
  userUsername?: string;
  userDisplayName?: string;
  conditionId: string;
  marketId: string;
  marketTitle: string;
  outcome: string;
  size: number;
  avgPrice: number;
  price: number;
  cashPnl: number;
  percentPnl: number;
  initialValue: number;
  currentValue: number;
  redeemable: boolean;
  mergeable: boolean;
  resolveTime: string;
  asset?: string;
}

export interface UserTrade {
  proxyWallet: string;
  userUsername?: string;
  conditionId: string;
  marketId: string;
  marketTitle: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  sharesTraded: number;
  pricePerShare: number;
  totalCost: number;
  timestamp: number;
  hashId: string;
  asset?: string;
  outcomeIndex?: number;
}

export interface UserActivity {
  proxyWallet: string;
  userUsername?: string;
  timestamp: number;
  type: 'TRADE' | 'SPLIT' | 'MERGE' | 'REDEEM' | 'REWARD' | 'CONVERSION';
  conditionId: string;
  marketTitle: string;
  outcome: string;
  side?: 'BUY' | 'SELL';
  tokensChanged: number;
  cashChanged: number;
  hashId: string;
}

export interface LeaderboardUser {
  proxyWallet: string;
  userUsername?: string;
  userDisplayName?: string;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
  rank: number;
  pnl: number;
  volume: number;
  predictionsCount: number;
  largestTrade: number;
  joinedAt: number;
  joinedDaysAgo: number;
}

export interface MarketHolder {
  proxyWallet: string;
  userUsername?: string;
  userDisplayName?: string;
  profileImage?: string;
  outcome: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  cashPnl: number;
  percentPnl: number;
}

// ============================================================================
// USER PROFILE (REAL JOIN DATE)
// ============================================================================

export interface UserProfile {
  address: string;
  username?: string;
  displayName?: string;
  profileImage?: string;
  bio?: string;
  createdAt: number;
  positionsValue: number;
  volume: number;
  pnl: number;
  predictions: number;
}

// ============================================================================
// ENRICHED MARKET HOLDER (EXACT SHARES + PRICES)
// ============================================================================

export interface EnrichedMarketHolder extends MarketHolder {
  avgBuyPrice: number;
  avgSellPrice: number;
  totalBought: number;
  totalSold: number;
  netShares: number;
  unrealizedPnl: number;
  realizedPnl: number;
  tradeCount: number;
  firstTradeAt: number;
  lastTradeAt: number;
  trades: HolderTrade[];
}

export interface HolderTrade {
  side: 'BUY' | 'SELL';
  shares: number;
  price: number;
  cost: number;
  timestamp: number;
  hashId: string;
}

// ============================================================================
// ORDER BOOK ANALYTICS (PROFESSIONAL LEVEL-2/3)
// ============================================================================

export interface OrderBookAnalytics {
  tokenId: string;
  timestamp: number;

  // Core spread metrics
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  midpoint: number;
  weightedMidPrice: number;

  // Depth analysis
  bidAskImbalance: number;
  totalBidSize: number;
  totalAskSize: number;
  bidDepth5: number;
  askDepth5: number;
  bidDepth10: number;
  askDepth10: number;
  bidLevels: number;
  askLevels: number;

  // Support/Resistance
  supportLevels: PriceSizeLevel[];
  resistanceLevels: PriceSizeLevel[];

  // Slippage (buy side - walking asks up)
  slippage100: number;
  slippage500: number;
  slippage1000: number;
  slippage5000: number;

  // Sell-side slippage (walking bids down)
  sellSlippage100: number;
  sellSlippage500: number;
  sellSlippage1000: number;
  sellSlippage5000: number;

  // Order flow
  netOrderFlow: number;
  buyVolume: number;
  sellVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  ordersPerMinute: number;

  // Whale detection
  whaleOrders: WhaleOrder[];
  whaleActivity: number;

  // Pattern detection
  spoofingScore: number;
  marketMakerScore: number;

  // Predictions
  nextTickUpProbability: number;
  nextTickDownProbability: number;

  // Volatility
  realizedVolatility: number;
  impliedVolatility: number;
  volatilityForecast: number;

  // Liquidity
  liquidityScore: number;
  liquidityChange: number;

  // Hidden liquidity
  hiddenLiquidityEstimate: number;

  // Cancellations
  cancellationCount: number;
  cancellationVolume: number;

  // Order rate
  newOrdersPerSecond: number;

  // Execution speed
  executionSpeedSeconds: number;
  executionSpeedTradesPerSecond: number;
}

export interface PriceSizeLevel {
  price: number;
  size: number;
  cumulative: number;
}

export interface WhaleOrder {
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
  zscore: number;
}

export interface OrderBookSnapshot {
  tokenId: string;
  timestamp: number;
  totalBidSize: number;
  totalAskSize: number;
  spread: number;
  midpoint: number;
  imbalance: number;
  bids?: PriceLevel[];
  asks?: PriceLevel[];
}

// ============================================================================
// CLOB API STRUCTURES
// ============================================================================

export interface CLOBPrice {
  tokenId: string;
  price: number;
  timestamp: number;
  bid?: number;
  ask?: number;
  midpoint?: number;
}

export interface OrderBook {
  tokenId: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  timestamp: number;
  conditionId?: string;
}

export interface PriceLevel {
  price: number;
  size: number;
}

// ============================================================================
// SMART MONEY DETECTION STRUCTURES
// ============================================================================

export interface SmartMoneyScore {
  totalScore: number; // 0-100
  efficiency: number; // PnL per prediction
  timing: number; // Early entry detection
  conviction: number; // Position consistency
  consistency: number; // Win rate
  explanation: string;
}

export interface SmartMoneyTrader extends LeaderboardUser {
  smartMoneyScore: SmartMoneyScore;
  profitPerPrediction: number;
  winRate: number;
  avgTradeSize: number;
  largeTradesCount: number;
  earlyEntryCount: number; // Entered <30% price
  highConvictionCount: number; // Consistent sizing
  riskScore: number; // 0-100, higher = more aggressive
}

export interface EventOutcomeMetrics {
  eventSlug: string;
  eventTitle: string;
  marketId: string;
  outcome: string;
  price: number;
  volume24hr: number;
  totalHolders: number;
  topHolders: MarketHolder[];
  smartMoneyHolders: SmartMoneyTraderPosition[];
  enrichedHolders?: EnrichedMarketHolder[];
  orderBookAnalytics?: OrderBookAnalytics;
}

export interface SmartMoneyTraderPosition {
  wallet: string;
  username?: string;
  displayName?: string;
  smartMoneyScore: number;
  position: {
    size: number;
    avgPrice: number;
    currentValue: number;
    cashPnl: number;
  };
  tradingPattern: {
    totalTrades: number;
    buySells: number; // Ratio of buys to sells
    averageTradeSize: number;
    entryPrice: number;
    entryTimestamp: number;
  };
}

export interface SmartMoneySignal {
  type: 'EARLY_ENTRY' | 'LARGE_ACCUMULATION' | 'HIGH_CONVICTION' | 'TIMING_PATTERN';
  confidence: number; // 0-1
  description: string;
  trader: SmartMoneyTrader;
  relatedMarkets: string[];
  timestamp: number;
}

// ============================================================================
// API RESPONSE STRUCTURES
// ============================================================================

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface LeaderboardResponse extends PaginatedResponse<SmartMoneyTrader> {
  timeframe: string;
  category: string;
}

export interface TraderActivityResponse {
  trader: SmartMoneyTrader;
  recentTrades: UserTrade[];
  recentActivity: UserActivity[];
  positions: UserPosition[];
  marketHoldings: EventOutcomeMetrics[];
}

export interface EventAnalysisResponse {
  event: GammaEvent;
  markets: GammaMarket[];
  smartMoneySignals: SmartMoneySignal[];
  outcomeMetrics: EventOutcomeMetrics[];
}

// ============================================================================
// FILTERING & SORTING
// ============================================================================

export interface FilterOptions {
  minSmartScore?: number;
  minPnL?: number;
  minPredictions?: number;
  maxPredictions?: number;
  minTradeSize?: number;
  category?: string;
  joinedDaysAgo?: number;
}

export type SortField = 'smartScore' | 'pnl' | 'profitPerPrediction' | 'winRate' | 'volume' | 'predictionsCount';

export interface SortOptions {
  field: SortField;
  ascending: boolean;
}

// ============================================================================
// CACHE & PERFORMANCE
// ============================================================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
}

// ============================================================================
// WEBSOCKET
// ============================================================================

export interface WebSocketMessage {
  type: 'PRICE_UPDATE' | 'ORDER_BOOK_UPDATE' | 'TRADE' | 'POSITION_CHANGE';
  payload: unknown;
  timestamp: number;
}

export interface PriceUpdate {
  tokenId: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
}
