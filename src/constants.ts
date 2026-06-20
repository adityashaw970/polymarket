// ============================================================================
// API ENDPOINTS
// ============================================================================

export const API_ENDPOINTS = {
  GAMMA_API: 'https://gamma-api.polymarket.com',
  DATA_API: 'https://data-api.polymarket.com',
  CLOB_API: 'https://clob.polymarket.com',
  WEBSOCKET: 'wss://ws-subscriptions-clob.polymarket.com/ws',
} as const;

// ============================================================================
// SMART MONEY DETECTION THRESHOLDS
// ============================================================================

export const SMART_MONEY_THRESHOLDS = {
  // Minimum metrics to consider a trader
  MIN_PREDICTIONS: 3, // Must have at least 3 predictions
  MIN_VOLUME: 100, // Minimum trading volume
  MIN_PNL: -50, // Can be negative, but not extreme losses

  // Early entry detection
  EARLY_ENTRY_PRICE: 0.30, // Buy signal when price < 30%
  EARLY_ENTRY_RATIO_MIN: 0.5, // At least 50% of buys are early entries

  // Large accumulation
  LARGE_TRADE_SIZE: 1000, // Minimum to flag as large
  LARGE_POSITION_RATIO: 0.8, // 80% of volume in few trades

  // High conviction
  HIGH_CONVICTION_BUY_RATIO: 0.70, // >70% buys = high conviction
  CONVICTION_POSITION_CONSISTENCY: 0.6, // Std dev of position sizes

  // Win rate and consistency
  MIN_WIN_RATE: 0.4, // Minimum to score
  GOOD_WIN_RATE: 0.55, // Good trader threshold

  // Time windows
  EARLY_ENTRY_WINDOW_DAYS: 7, // First week counts as early
  RECENT_ACTIVITY_DAYS: 30, // Last 30 days for activity analysis
  TRADER_HISTORY_DAYS: 180, // Last 6 months for historical analysis
} as const;

// ============================================================================
// SMART MONEY SCORE WEIGHTS
// ============================================================================

export const SMART_MONEY_WEIGHTS = {
  EFFICIENCY: 0.35, // Profitability per trade
  TIMING: 0.25, // Early entry detection
  CONVICTION: 0.25, // Position sizing consistency
  CONSISTENCY: 0.15, // Win rate
} as const;

// Sum should equal 1.0
const weightSum = Object.values(SMART_MONEY_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`Smart money weights do not sum to 1.0: ${weightSum}`);
}

// ============================================================================
// EFFICIENCY SCORE CALCULATION
// ============================================================================

export const EFFICIENCY_SCORING = {
  // Normalize by trading volume
  BASELINE_PROFIT_RATIO: 0.02, // 2% = baseline good ratio
  MAX_EFFICIENCY_RATIO: 0.15, // 15% = max scoring ratio

  // Edge case handling
  MIN_VOLUME_FOR_EFFICIENCY: 100,
  LOSS_ADJUSTMENT: 0.5, // Losing traders get 0.5x multiplier

  // Per-prediction scoring
  BASELINE_PROFIT_PER_PREDICTION: 50, // $50 per prediction = baseline
  MAX_PROFIT_PER_PREDICTION: 500, // $500+ = max score
} as const;

// ============================================================================
// TIMING SCORE CALCULATION
// ============================================================================

export const TIMING_SCORING = {
  // Price band scoring
  VERY_EARLY_PRICE: 0.15, // <15% price
  EARLY_PRICE: 0.30, // <30% price
  LATE_PRICE: 0.70, // >70% price (sell side)

  // Timing bonus
  CONSISTENT_EARLY_BONUS: 1.2, // 20% bonus if >60% trades are early
  BAD_TIMING_PENALTY: 0.8, // 20% penalty if mostly late entries

  // Price impact scoring
  MAX_PRICE_IMPROVEMENT: 0.5, // 50% price improvement = max score
} as const;

// ============================================================================
// CONVICTION SCORE CALCULATION
// ============================================================================

export const CONVICTION_SCORING = {
  // Position sizing consistency
  IDEAL_STD_DEV_RATIO: 0.3, // 30% std dev = ideal
  MAX_STD_DEV_RATIO: 1.5, // 150% std dev = inconsistent

  // Buy/Sell ratio
  STRONG_CONVICTION_BUY_RATIO: 0.75, // >75% buys
  WEAK_CONVICTION_BUY_RATIO: 0.50, // <50% buys

  // Average position size bonus
  LARGE_POSITION_BONUS: 1.3, // 30% bonus for large positions
} as const;

// ============================================================================
// CONSISTENCY SCORE (WIN RATE)
// ============================================================================

export const CONSISTENCY_SCORING = {
  BASELINE_BREAKEVEN: 0.5, // 50% win rate
  GOOD_WIN_RATE: 0.65, // 65% win rate
  EXCELLENT_WIN_RATE: 0.80, // 80% win rate
  MAX_WIN_RATE: 0.95, // Cap at 95% (avoid overweighting)
  RECENT_WEIGHT: 0.6, // 60% weight to recent trades
  HISTORICAL_WEIGHT: 0.4, // 40% weight to older trades
} as const;

// ============================================================================
// CACHE SETTINGS
// ============================================================================

export const CACHE_TTL = {
  LEADERBOARD: 2 * 60 * 1000,         // 2 min
  TRADER_ACTIVITY: 3 * 60 * 1000,     // 3 min
  MARKET_DATA: 5 * 60 * 1000,         // 5 min
  POSITIONS: 2 * 60 * 1000,           // 2 min
  HOLDERS: 60 * 1000,                 // 1 min
  PRICE_DATA: 30 * 1000,              // 30s
} as const;

// ============================================================================
// API RATE LIMITING
// ============================================================================

export const RATE_LIMITS = {
  GAMMA_API_GENERAL: 4000, // per 10 seconds
  GAMMA_API_EVENTS: 500, // per 10 seconds
  GAMMA_API_MARKETS: 300, // per 10 seconds
  GAMMA_API_SEARCH: 350, // per 10 seconds
  DATA_API_GENERAL: 2000, // per 10 seconds
  CLOB_API_GENERAL: 2000, // per 10 seconds
} as const;

// ============================================================================
// PAGINATION DEFAULTS
// ============================================================================

export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 500,
  DEFAULT_OFFSET: 0,
} as const;

// ============================================================================
// FILTERING DEFAULTS
// ============================================================================

export const DEFAULT_FILTERS = {
  MIN_SMART_SCORE: 40, // Only show traders with 40+ score
  MIN_PNL: 0, // Only profitable traders
  MIN_PREDICTIONS: 3, // At least 3 trades
  CATEGORY: 'ALL',
  TIME_PERIOD: '30d', // Last 30 days
} as const;

// ============================================================================
// MARKET CATEGORIES
// ============================================================================

export const MARKET_CATEGORIES = [
  'ALL',
  'politics',
  'crypto',
  'sports',
  'entertainment',
  'business',
  'science',
  'technology',
  'other',
] as const;

export type MarketCategory = typeof MARKET_CATEGORIES[number];

// ============================================================================
// TIME PERIODS
// ============================================================================

export const TIME_PERIODS = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  'all': null,
} as const;

export type TimePeriod = keyof typeof TIME_PERIODS;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getTimestampFromPeriod(period: TimePeriod): number | null {
  const ms = TIME_PERIODS[period];
  if (ms === null) return null;
  return Date.now() - ms;
}



// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  INVALID_WALLET: 'Invalid wallet address format',
  INVALID_MARKET_ID: 'Invalid market ID format',
  INVALID_CONDITION_ID: 'Invalid condition ID format',
  API_ERROR: 'Error fetching data from Polymarket API',
  RATE_LIMIT: 'Rate limit exceeded, please try again later',
  NOT_FOUND: 'Data not found',
  NETWORK_ERROR: 'Network error, please check your connection',
  INTERNAL_ERROR: 'Internal server error',
} as const;