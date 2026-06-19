'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { OrderBookAnalytics } from '../types'
import { APIResponse } from '../types'
import { formatNumber, formatCurrency } from '../utils'

interface OrderBookPanelProps {
  tokenId: string
  marketTitle?: string
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'sky' | 'amber' | 'default' }) {
  const colors = {
    green: 'text-emerald-300',
    red: 'text-rose-300',
    sky: 'text-sky-300',
    amber: 'text-amber-300',
    default: 'text-white',
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${colors[tone || 'default']}`}>{value}</div>
    </div>
  )
}

function DepthBar({ side, levels }: { side: 'bid' | 'ask'; levels: { price: number; size: number }[] }) {
  if (levels.length === 0) return null
  const maxSize = Math.max(...levels.map(l => l.size))
  const isBid = side === 'bid'

  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-1.5">
        {isBid ? 'Bids' : 'Asks'}
      </div>
      {levels.slice(0, 10).map((level, i) => (
        <div key={`${side}-${i}`} className="flex items-center gap-2 text-xs">
          <span className={`w-14 text-right font-mono ${isBid ? 'text-emerald-300' : 'text-rose-300'}`}>
            {level.price.toFixed(3)}
          </span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden bg-white/5">
            <div
              className={`h-full rounded-sm transition-all ${isBid ? 'bg-emerald-400/30' : 'bg-rose-400/30'}`}
              style={{ width: `${Math.max(2, (level.size / maxSize) * 100)}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono text-slate-300">
            {formatNumber(level.size, 0)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ProbabilityGauge({ upProb }: { upProb: number }) {
  const pct = Math.round(upProb * 100)
  const isUp = upProb > 0.5

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Next tick</div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 h-3 rounded-full overflow-hidden bg-rose-400/20">
          <div
            className="h-full rounded-full bg-emerald-400/60 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-sm font-bold ${isUp ? 'text-emerald-300' : 'text-rose-300'}`}>
          {isUp ? '↑' : '↓'} {pct}%
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>Down</span>
        <span>Up</span>
      </div>
    </div>
  )
}

export function OrderBookPanel({ tokenId, marketTitle }: OrderBookPanelProps) {
  const [analytics, setAnalytics] = useState<OrderBookAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/orderbook?tokenId=${encodeURIComponent(tokenId)}`)
      const json = (await response.json()) as APIResponse<OrderBookAnalytics>

      if (!json.success) {
        throw new Error(json.error || 'Failed to fetch orderbook')
      }

      setAnalytics(json.data ?? null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orderbook')
    } finally {
      setLoading(false)
    }
  }, [tokenId])

  useEffect(() => {
    if (!tokenId) return
    const timeoutId = setTimeout(() => {
      void fetchAnalytics()
    }, 0)
    const interval = setInterval(() => void fetchAnalytics(), 30000) // refresh every 30s
    return () => {
      clearTimeout(timeoutId)
      clearInterval(interval)
    }
  }, [fetchAnalytics, tokenId])

  if (loading && !analytics) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-center text-sm text-slate-300 backdrop-blur">
        Loading orderbook analytics...
      </div>
    )
  }

  if (error && !analytics) {
    return (
      <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
        {error}
      </div>
    )
  }

  if (!analytics) return null

  const a = analytics

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Orderbook analytics</div>
          {marketTitle && <div className="mt-1 text-sm font-semibold text-white line-clamp-1">{marketTitle}</div>}
        </div>
        <button
          type="button"
          onClick={() => void fetchAnalytics()}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {/* Core Spread Metrics */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard label="Best Bid" value={a.bestBid.toFixed(4)} tone="green" />
        <MetricCard label="Best Ask" value={a.bestAsk.toFixed(4)} tone="red" />
        <MetricCard label="Spread" value={`${a.spread.toFixed(4)} (${a.spreadPercent.toFixed(2)}%)`} />
        <MetricCard label="Midpoint" value={a.midpoint.toFixed(4)} tone="sky" />
      </div>

      {/* Depth Visualization */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DepthBar side="bid" levels={a.supportLevels.map(l => ({ price: l.price, size: l.size }))} />
        <DepthBar side="ask" levels={a.resistanceLevels.map(l => ({ price: l.price, size: l.size }))} />
      </div>

      {/* Imbalance & Flow */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard
          label="Bid/Ask Imbalance"
          value={`${(a.bidAskImbalance * 100).toFixed(1)}%`}
          tone={a.bidAskImbalance > 0 ? 'green' : 'red'}
        />
        <MetricCard
          label="Net Order Flow"
          value={formatCurrency(a.netOrderFlow)}
          tone={a.netOrderFlow > 0 ? 'green' : 'red'}
        />
        <MetricCard label="Buy Volume" value={formatCurrency(a.buyVolume)} tone="green" />
        <MetricCard label="Sell Volume" value={formatCurrency(a.sellVolume)} tone="red" />
      </div>

      {/* Depth Numbers */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard label="Total Bid Size" value={formatNumber(a.totalBidSize, 0)} />
        <MetricCard label="Total Ask Size" value={formatNumber(a.totalAskSize, 0)} />
        <MetricCard label="Bid Depth (5)" value={formatNumber(a.bidDepth5, 0)} />
        <MetricCard label="Ask Depth (5)" value={formatNumber(a.askDepth5, 0)} />
      </div>

      {/* Slippage */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard label="Slippage $100" value={`${a.slippage100.toFixed(3)}%`} tone={a.slippage100 > 1 ? 'red' : 'default'} />
        <MetricCard label="Slippage $500" value={`${a.slippage500.toFixed(3)}%`} tone={a.slippage500 > 2 ? 'red' : 'default'} />
        <MetricCard label="Slippage $1K" value={`${a.slippage1000.toFixed(3)}%`} tone={a.slippage1000 > 3 ? 'red' : 'default'} />
        <MetricCard label="Slippage $5K" value={`${a.slippage5000.toFixed(3)}%`} tone={a.slippage5000 > 5 ? 'red' : 'amber'} />
      </div>

      {/* Next Tick Probability */}
      <ProbabilityGauge upProb={a.nextTickUpProbability} />

      {/* Pattern Detection */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard
          label="Whale Activity"
          value={`${a.whaleActivity}/100`}
          tone={a.whaleActivity > 50 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Spoofing Score"
          value={`${a.spoofingScore}/100`}
          tone={a.spoofingScore > 30 ? 'red' : 'default'}
        />
        <MetricCard
          label="Market Maker"
          value={`${a.marketMakerScore}/100`}
          tone={a.marketMakerScore > 50 ? 'green' : 'default'}
        />
        <MetricCard
          label="Liquidity Score"
          value={`${a.liquidityScore}/100`}
          tone={a.liquidityScore > 60 ? 'green' : a.liquidityScore > 30 ? 'amber' : 'red'}
        />
      </div>

      {/* Volatility & Execution */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard label="Realized Vol" value={`${a.realizedVolatility.toFixed(2)}%`} />
        <MetricCard label="Implied Vol" value={`${a.impliedVolatility.toFixed(2)}%`} />
        <MetricCard label="Vol Forecast" value={`${a.volatilityForecast.toFixed(2)}%`} />
        <MetricCard
          label="Liquidity Δ"
          value={`${a.liquidityChange >= 0 ? '+' : ''}${a.liquidityChange.toFixed(1)}%`}
          tone={a.liquidityChange > 0 ? 'green' : 'red'}
        />
      </div>

      {/* Trade Stats */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard label="Trades" value={formatNumber(a.tradeCount, 0)} />
        <MetricCard label="Avg Trade Size" value={formatNumber(a.avgTradeSize, 1)} />
        <MetricCard label="Orders/min" value={a.ordersPerMinute.toFixed(1)} />
        <MetricCard label="Hidden Liq" value={formatNumber(a.hiddenLiquidityEstimate, 0)} />
      </div>

      {/* Execution Speed & Cancellations */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <MetricCard
          label="Cancellations"
          value={`${a.cancellationCount} (${formatNumber(a.cancellationVolume, 0)} shs)`}
          tone={a.cancellationCount > 0 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Orders / sec"
          value={a.newOrdersPerSecond.toFixed(2)}
          tone="sky"
        />
        <MetricCard
          label="Exec Interval"
          value={a.executionSpeedSeconds > 0 ? `${a.executionSpeedSeconds.toFixed(2)}s` : '—'}
        />
        <MetricCard
          label="Exec Speed"
          value={a.executionSpeedTradesPerSecond > 0 ? `${a.executionSpeedTradesPerSecond.toFixed(2)}/s` : '—'}
          tone={a.executionSpeedTradesPerSecond > 1 ? 'green' : 'default'}
        />
      </div>

      {/* Whale Orders */}
      {a.whaleOrders.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-2">Whale Orders</div>
          <div className="space-y-1.5">
            {a.whaleOrders.slice(0, 5).map((whale, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs">
                <span className={`font-semibold ${whale.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {whale.side}
                </span>
                <span className="text-white font-mono">{formatNumber(whale.size, 0)} shares</span>
                <span className="text-slate-400">@ {whale.price.toFixed(3)}</span>
                <span className="text-amber-300 font-semibold">{whale.zscore.toFixed(1)}σ</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support/Resistance */}
      <div className="grid gap-4 lg:grid-cols-2">
        {a.supportLevels.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-2">Support Levels</div>
            <div className="space-y-1">
              {a.supportLevels.map((level, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-400/10 bg-emerald-400/5 px-3 py-1.5 text-xs">
                  <span className="text-emerald-300 font-mono">{level.price.toFixed(3)}</span>
                  <span className="text-slate-300">{formatNumber(level.size, 0)} size</span>
                  <span className="text-slate-400">{formatNumber(level.cumulative, 0)} cum.</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {a.resistanceLevels.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-2">Resistance Levels</div>
            <div className="space-y-1">
              {a.resistanceLevels.map((level, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-rose-400/10 bg-rose-400/5 px-3 py-1.5 text-xs">
                  <span className="text-rose-300 font-mono">{level.price.toFixed(3)}</span>
                  <span className="text-slate-300">{formatNumber(level.size, 0)} size</span>
                  <span className="text-slate-400">{formatNumber(level.cumulative, 0)} cum.</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrderBookPanel
