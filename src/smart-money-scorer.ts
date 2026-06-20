//smart-money-scorer.ts
import {
  SmartMoneyTrader,
  SmartMoneyScore,
  LeaderboardUser,
  UserTrade,
  UserPosition,
  SmartMoneySignal,
} from './types';
import {
  SMART_MONEY_THRESHOLDS,
  SMART_MONEY_WEIGHTS,
  EFFICIENCY_SCORING,
  CONVICTION_SCORING,
  CONSISTENCY_SCORING,
} from './constants';

// ============================================================================
// SMART MONEY SCORE CALCULATOR
// ============================================================================

export class SmartMoneyScorer {
  /**
   * Calculate comprehensive smart money score
   */
  static calculateSmartMoneyScore(
    trader: LeaderboardUser,
    trades: UserTrade[],
    positions: UserPosition[]
  ): SmartMoneyScore {
    // Filter by minimum metrics
    if (trades.length < SMART_MONEY_THRESHOLDS.MIN_PREDICTIONS) {
      return {
        totalScore: 0,
        efficiency: 0,
        timing: 0,
        conviction: 0,
        consistency: 0,
        explanation: `Insufficient predictions (${trades.length} < ${SMART_MONEY_THRESHOLDS.MIN_PREDICTIONS})`,
      };
    }

    // Calculate component scores
    const efficiencyScore = this.calculateEfficiencyScore(trader, trades);
    const timingScore = this.calculateTimingScore(trades);
    const convictionScore = this.calculateConvictionScore(trades, positions);
    const consistencyScore = this.calculateConsistencyScore(trades);

    // Weighted total
    const totalScore = Math.round(
      efficiencyScore * SMART_MONEY_WEIGHTS.EFFICIENCY +
        timingScore * SMART_MONEY_WEIGHTS.TIMING +
        convictionScore * SMART_MONEY_WEIGHTS.CONVICTION +
        consistencyScore * SMART_MONEY_WEIGHTS.CONSISTENCY
    );

    // Explanation
    const explanations: string[] = [];
    if (efficiencyScore > 70) explanations.push('High profitability');
    if (timingScore > 70) explanations.push('Excellent timing');
    if (convictionScore > 70) explanations.push('Strong conviction');
    if (consistencyScore > 70) explanations.push('High win rate');

    return {
      totalScore: Math.max(0, Math.min(100, totalScore)),
      efficiency: Math.round(efficiencyScore),
      timing: Math.round(timingScore),
      conviction: Math.round(convictionScore),
      consistency: Math.round(consistencyScore),
      explanation: explanations.join(' | ') || 'Average trader',
    };
  }

  /**
   * Calculate Efficiency Score (35% weight)
   * Measures: Profit per prediction, profit ratio vs volume
   */
  private static calculateEfficiencyScore(trader: LeaderboardUser, trades: UserTrade[]): number {
    const predictionCount = Math.max(1, trades.length);
    const profitPerPrediction = trader.pnl / predictionCount;
    const ppScore = Math.min(
      100,
      (profitPerPrediction / EFFICIENCY_SCORING.BASELINE_PROFIT_PER_PREDICTION) * 50 + 50
    );

    if (trader.volume < EFFICIENCY_SCORING.MIN_VOLUME_FOR_EFFICIENCY) {
      return Math.max(0, ppScore * 0.6);
    }

    const profitRatio = trader.pnl / Math.max(1, trader.volume);
    const ratioScore = Math.min(
      100,
      (profitRatio / EFFICIENCY_SCORING.BASELINE_PROFIT_RATIO) * 50 + 50
    );

    if (trader.pnl < 0) {
      return Math.max(0, ratioScore * EFFICIENCY_SCORING.LOSS_ADJUSTMENT);
    }

    return Math.max(0, Math.min(100, (ppScore + ratioScore) / 2));
  }

  /**
   * Calculate Timing Score (25% weight)
   * Measures: Entry price (early vs late), consistency of timing
   */
  private static calculateTimingScore(trades: UserTrade[]): number {
    const buyTrades = trades.filter((t) => t.side === 'BUY');
    if (buyTrades.length === 0) return 45;

    // Count early entries
    const earlyEntries = buyTrades.filter((t) => t.pricePerShare < SMART_MONEY_THRESHOLDS.EARLY_ENTRY_PRICE);
    const earlyRatio = earlyEntries.length / buyTrades.length;

    // Score early entry consistency
    let timingScore = earlyRatio * 100;

    // Bonus for very early entries
    const veryEarlyEntries = buyTrades.filter((t) => t.pricePerShare < 0.15);
    if (veryEarlyEntries.length > 0) {
      timingScore += (veryEarlyEntries.length / buyTrades.length) * 20;
    }

    // Average entry price
    const avgEntryPrice = buyTrades.reduce((sum, t) => sum + t.pricePerShare, 0) / buyTrades.length;
    const sellTrades = trades.filter((t) => t.side === 'SELL');
    const avgSellPrice =
      sellTrades.reduce((sum, t) => sum + t.pricePerShare, 0) / Math.max(1, sellTrades.length) || avgEntryPrice;

    // Price improvement score
    if (avgSellPrice > avgEntryPrice) {
      const improvement = (avgSellPrice - avgEntryPrice) / avgEntryPrice;
      timingScore += Math.min(20, improvement * 100);
    }

    return Math.min(100, timingScore);
  }

  /**
   * Calculate Conviction Score (25% weight)
   * Measures: Position sizing consistency, buy/sell ratio, position magnitude
   */
  private static calculateConvictionScore(trades: UserTrade[], positions: UserPosition[]): number {
    if (trades.length === 0) return 50;

    // Buy/Sell ratio
    const buys = trades.filter((t) => t.side === 'BUY');
    const buyRatio = buys.length / trades.length;

    let convictionScore = 0;

    // Strong conviction if mostly buys
    if (buyRatio > CONVICTION_SCORING.STRONG_CONVICTION_BUY_RATIO) {
      convictionScore += 50;
    } else if (buyRatio > CONVICTION_SCORING.WEAK_CONVICTION_BUY_RATIO) {
      convictionScore += 25;
    }

    // Position sizing consistency
    const sizes = trades.map((t) => t.sharesTraded);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
    const stdDev = Math.sqrt(sizes.reduce((sum, s) => sum + Math.pow(s - avgSize, 2), 0) / Math.max(1, sizes.length));
    const stdDevRatio = avgSize > 0 ? stdDev / avgSize : 1;

    if (stdDevRatio < CONVICTION_SCORING.IDEAL_STD_DEV_RATIO) {
      convictionScore += 40; // Very consistent sizing
    } else if (stdDevRatio < CONVICTION_SCORING.MAX_STD_DEV_RATIO) {
      convictionScore += 20; // Somewhat consistent
    }

    // Large position bonus
    const avgPositionValue = positions.reduce((sum, p) => sum + p.currentValue, 0) / Math.max(1, positions.length);
    if (avgPositionValue > SMART_MONEY_THRESHOLDS.LARGE_TRADE_SIZE * 5) {
      convictionScore += 20;
    }

    return Math.min(100, convictionScore);
  }

  /**
   * Calculate Consistency Score / Win Rate (15% weight)
   * Measures: Winning vs losing trades ratio
   */
  private static calculateConsistencyScore(trades: UserTrade[]): number {
    if (trades.length < 2) return 45;

    // Group trades by market
    const tradesByMarket = new Map<string, UserTrade[]>();
    trades.forEach((t) => {
      if (!tradesByMarket.has(t.marketId)) {
        tradesByMarket.set(t.marketId, []);
      }
      tradesByMarket.get(t.marketId)!.push(t);
    });

    let winningMarkets = 0;

    // Analyze each market
    tradesByMarket.forEach((marketTrades) => {
      const buys = marketTrades.filter((t) => t.side === 'BUY');
      const sells = marketTrades.filter((t) => t.side === 'SELL');

      const totalBuyCost = buys.reduce((sum, t) => sum + t.totalCost, 0);
      const totalSellRevenue = sells.reduce((sum, t) => sum + t.totalCost, 0);

      // Market is profitable if sells > buys (in value)
      if (totalSellRevenue > totalBuyCost) {
        winningMarkets++;
      }
    });

    const winRate = winningMarkets / Math.max(1, tradesByMarket.size);

    // Convert to score
    let score = (winRate - CONSISTENCY_SCORING.BASELINE_BREAKEVEN) * 100;

    // Excellent win rate bonus
    if (winRate > CONSISTENCY_SCORING.EXCELLENT_WIN_RATE) {
      score += 30;
    } else if (winRate > CONSISTENCY_SCORING.GOOD_WIN_RATE) {
      score += 15;
    }

    return Math.max(0, Math.min(100, score));
  }
}

// ============================================================================
// SMART MONEY SIGNAL DETECTION
// ============================================================================

export class SmartMoneyDetector {
  /**
   * Detect early entry signals
   */
  static detectEarlyEntrySignals(trades: UserTrade[]): { confidence: number; count: number; avgPrice: number } {
    const buyTrades = trades.filter((t) => t.side === 'BUY');
    const earlyBuys = buyTrades.filter(
      (t) =>
        t.side === 'BUY' &&
        t.pricePerShare < SMART_MONEY_THRESHOLDS.EARLY_ENTRY_PRICE
    );

    if (earlyBuys.length === 0 || buyTrades.length === 0) {
      return { confidence: 0, count: 0, avgPrice: 0 };
    }

    const avgPrice = earlyBuys.reduce((sum, t) => sum + t.pricePerShare, 0) / earlyBuys.length;
    const buyRatio = earlyBuys.length / buyTrades.length;

    // Confidence based on how early and how consistent
    const priceDepth = 1 - (avgPrice / SMART_MONEY_THRESHOLDS.EARLY_ENTRY_PRICE);
    const confidence = Math.min(1, (buyRatio * 0.6 + priceDepth * 0.4));

    return {
      confidence,
      count: earlyBuys.length,
      avgPrice,
    };
  }

  /**
   * Detect large accumulation signals (few trades, high sizes)
   */
  static detectAccumulationSignals(trades: UserTrade[]): { confidence: number; totalSize: number; avgSize: number } {
    const buys = trades.filter((t) => t.side === 'BUY');
    if (buys.length === 0) {
      return { confidence: 0, totalSize: 0, avgSize: 0 };
    }

    const totalSize = buys.reduce((sum, t) => sum + t.sharesTraded, 0);
    const avgSize = totalSize / buys.length;

    // Check if trades are large and few
    const largeTrades = buys.filter((t) => t.sharesTraded > SMART_MONEY_THRESHOLDS.LARGE_TRADE_SIZE);
    const largeTradeRatio = largeTrades.length / buys.length;
    const concentrationRatio = totalSize / Math.max(1, buys.length);

    // Confidence: concentrated large positions
    const confidence = Math.min(1, (largeTradeRatio * 0.6) + Math.min(1, concentrationRatio / 5000) * 0.4);

    return {
      confidence: Math.min(1, confidence),
      totalSize,
      avgSize,
    };
  }

  /**
   * Detect high conviction signals (mostly buys, consistent sizing)
   */
  static detectHighConvictionSignals(trades: UserTrade[]): { confidence: number; buyRatio: number; consistency: number } {
    const buyCount = trades.filter((t) => t.side === 'BUY').length;
    const buyRatio = buyCount / Math.max(1, trades.length);

    if (buyRatio < SMART_MONEY_THRESHOLDS.HIGH_CONVICTION_BUY_RATIO) {
      return { confidence: 0, buyRatio, consistency: 0 };
    }

    // Size consistency
    const buys = trades.filter((t) => t.side === 'BUY');
    if (buys.length === 0) {
      return { confidence: 0, buyRatio, consistency: 0 };
    }
    const sizes = buys.map((t) => t.sharesTraded);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
    const stdDev = Math.sqrt(sizes.reduce((sum, s) => sum + Math.pow(s - avgSize, 2), 0) / Math.max(1, sizes.length));
    const consistency = avgSize > 0 ? 1 - Math.min(1, stdDev / avgSize) : 0;

    // Confidence: high buy ratio + consistent sizing
    const confidence = (buyRatio - SMART_MONEY_THRESHOLDS.HIGH_CONVICTION_BUY_RATIO) * 2 * consistency;

    return {
      confidence: Math.min(1, confidence),
      buyRatio,
      consistency,
    };
  }

  /**
   * Detect timing patterns (buy low, sell high)
   */
  static detectTimingPatterns(trades: UserTrade[]): { confidence: number; avgEntryPrice: number; avgExitPrice: number } {
    const buys = trades.filter((t) => t.side === 'BUY');
    const sells = trades.filter((t) => t.side === 'SELL');

    if (buys.length === 0 || sells.length === 0) {
      return { confidence: 0, avgEntryPrice: 0, avgExitPrice: 0 };
    }

    const avgEntry = buys.reduce((sum, t) => sum + t.pricePerShare, 0) / buys.length;
    const avgExit = sells.reduce((sum, t) => sum + t.pricePerShare, 0) / sells.length;

    if (avgExit <= avgEntry) {
      return { confidence: 0, avgEntryPrice: avgEntry, avgExitPrice: avgExit };
    }

    const priceImprovement = (avgExit - avgEntry) / avgEntry;
    const confidence = Math.min(1, priceImprovement);

    return {
      confidence,
      avgEntryPrice: avgEntry,
      avgExitPrice: avgExit,
    };
  }

  /**
   * Combine all signals into smart money signals
   */
  static generateSmartMoneySignals(
    trader: SmartMoneyTrader,
    trades: UserTrade[],
    relatedMarkets: string[]
  ): SmartMoneySignal[] {
    const signals: SmartMoneySignal[] = [];

    // Early entry signal
    const earlyEntry = this.detectEarlyEntrySignals(trades);
    if (earlyEntry.confidence > 0.5) {
      signals.push({
        type: 'EARLY_ENTRY',
        confidence: earlyEntry.confidence,
        description: `Entered ${earlyEntry.count} markets at avg price ${earlyEntry.avgPrice.toFixed(2)}`,
        trader,
        relatedMarkets,
        timestamp: Date.now(),
      });
    }

    // Large accumulation signal
    const accumulation = this.detectAccumulationSignals(trades);
    if (accumulation.confidence > 0.4) {
      signals.push({
        type: 'LARGE_ACCUMULATION',
        confidence: accumulation.confidence,
        description: `Accumulated ${accumulation.totalSize.toFixed(0)} shares avg size ${accumulation.avgSize.toFixed(0)}`,
        trader,
        relatedMarkets,
        timestamp: Date.now(),
      });
    }

    // High conviction signal
    const conviction = this.detectHighConvictionSignals(trades);
    if (conviction.confidence > 0.5) {
      signals.push({
        type: 'HIGH_CONVICTION',
        confidence: conviction.confidence,
        description: `${(conviction.buyRatio * 100).toFixed(0)}% buy ratio with ${(conviction.consistency * 100).toFixed(0)}% size consistency`,
        trader,
        relatedMarkets,
        timestamp: Date.now(),
      });
    }

    // Timing pattern signal
    const timing = this.detectTimingPatterns(trades);
    if (timing.confidence > 0.4) {
      signals.push({
        type: 'TIMING_PATTERN',
        confidence: timing.confidence,
        description: `Buy avg ${timing.avgEntryPrice.toFixed(2)}, sell avg ${timing.avgExitPrice.toFixed(2)} (${(timing.confidence * 100).toFixed(0)}% improvement)`,
        trader,
        relatedMarkets,
        timestamp: Date.now(),
      });
    }

    // Sort by confidence
    return signals.sort((a, b) => b.confidence - a.confidence);
  }
}

// ============================================================================
// TRADER FILTER & RANKING
// ============================================================================

export class TraderRanker {
  /**
   * Filter traders by criteria
   */
  static filterSmartMoneyTraders(
    traders: SmartMoneyTrader[],
    filters: {
      minSmartScore?: number;
      minPnL?: number;
      maxPnL?: number;
      minPredictions?: number;
      maxPredictions?: number;
      minWinRate?: number;
      joinedAfterDaysAgo?: number;
    }
  ): SmartMoneyTrader[] {
    return traders.filter((t) => {
      if (filters.minSmartScore !== undefined && t.smartMoneyScore.totalScore < filters.minSmartScore) return false;
      if (filters.minPnL !== undefined && t.pnl < filters.minPnL) return false;
      if (filters.maxPnL !== undefined && t.pnl > filters.maxPnL) return false;
      if (filters.minPredictions !== undefined && t.predictionsCount < filters.minPredictions) return false;
      if (filters.maxPredictions !== undefined && t.predictionsCount > filters.maxPredictions) return false;
      if (filters.minWinRate !== undefined && t.winRate < filters.minWinRate) return false;
      if (filters.joinedAfterDaysAgo !== undefined && t.joinedDaysAgo > filters.joinedAfterDaysAgo) return false;
      return true;
    });
  }

  /**
   * Rank traders by a specific metric
   */
  static rankTraders(
    traders: SmartMoneyTrader[],
    sortBy: 'smartScore' | 'pnl' | 'profitPerPrediction' | 'winRate' | 'consistency' | 'predictionsCount' | 'joinedDaysAgo' | 'volume' | 'riskScore',
    ascending: boolean = false
  ): SmartMoneyTrader[] {
    const sorted = [...traders];

    sorted.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortBy) {
        case 'smartScore':
          aValue = a.smartMoneyScore.totalScore;
          bValue = b.smartMoneyScore.totalScore;
          break;
        case 'pnl':
          aValue = a.pnl;
          bValue = b.pnl;
          break;
        case 'profitPerPrediction':
          aValue = a.profitPerPrediction;
          bValue = b.profitPerPrediction;
          break;
        case 'winRate':
          aValue = a.winRate;
          bValue = b.winRate;
          break;
        case 'consistency':
          aValue = a.smartMoneyScore.consistency;
          bValue = b.smartMoneyScore.consistency;
          break;
        case 'predictionsCount':
          aValue = a.predictionsCount;
          bValue = b.predictionsCount;
          break;
        case 'joinedDaysAgo':
          aValue = a.joinedDaysAgo;
          bValue = b.joinedDaysAgo;
          break;
        case 'volume':
          aValue = a.volume;
          bValue = b.volume;
          break;
        case 'riskScore':
          aValue = a.riskScore;
          bValue = b.riskScore;
          break;
      }

      const diff = ascending ? aValue - bValue : bValue - aValue;
      return diff;
    });

    return sorted;
  }
}
