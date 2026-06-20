'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LiveOrderbookResponse } from '../../pages/api/live-orderbook'
import { TopHoldersResponse } from '../../pages/api/top-holders'
import { OrderBookAnalytics } from '../types'
import { APIResponse } from '../types'

// ── Utility helpers ────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(dec)
}
function fmtPct(n: number | null | undefined, dec = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(dec)}%`
}
function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}
function fmtNum(n: number | null | undefined, dec = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(dec)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ── Pulse dot ─────────────────────────────────────────────────────────────────
function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
    </span>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────
interface MetricCardProps {
  label: string
  value: string
  sub?: string
  tone?: 'green' | 'red' | 'amber' | 'sky' | 'purple' | 'neutral'
  icon?: string
  large?: boolean
}
function MetricCard({ label, value, sub, tone = 'neutral', icon, large }: MetricCardProps) {
  const colors: Record<string, string> = {
    green: 'text-emerald-300',
    red: 'text-rose-400',
    amber: 'text-amber-300',
    sky: 'text-sky-300',
    purple: 'text-violet-300',
    neutral: 'text-white',
  }
  const glows: Record<string, string> = {
    green: 'shadow-emerald-400/5',
    red: 'shadow-rose-400/5',
    amber: 'shadow-amber-400/5',
    sky: 'shadow-sky-400/5',
    purple: 'shadow-violet-400/5',
    neutral: '',
  }
  return (
    <div
      className={`rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3 shadow-lg ${glows[tone]} flex flex-col gap-1`}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-sm">{icon}</span>}
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">{label}</span>
      </div>
      <div className={`${large ? 'text-xl' : 'text-sm'} font-bold font-mono ${colors[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 font-mono">{sub}</div>}
    </div>
  )
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-base">{icon}</span>}
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{children}</span>
      <div className="flex-1 h-px bg-white/6" />
    </div>
  )
}

// ── Imbalance bar ─────────────────────────────────────────────────────────────
function ImbalanceBar({ imbalance }: { imbalance: number }) {
  const bidPct = clamp(((imbalance + 1) / 2) * 100, 2, 98)
  const askPct = 100 - bidPct
  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">Bid/Ask Imbalance</span>
        <span className={`text-xs font-bold font-mono ${imbalance > 0 ? 'text-emerald-300' : 'text-rose-400'}`}>
          {imbalance > 0 ? '+' : ''}{(imbalance * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex h-4 rounded-full overflow-hidden gap-px">
        <div
          className="bg-linear-to-r from-emerald-500/70 to-emerald-400/40 transition-all duration-700 rounded-l-full"
          style={{ width: `${bidPct}%` }}
        />
        <div
          className="bg-linear-to-r from-rose-400/40 to-rose-500/70 transition-all duration-700 rounded-r-full"
          style={{ width: `${askPct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px]">
        <span className="text-emerald-400">Bids {bidPct.toFixed(0)}%</span>
        <span className="text-rose-400">Asks {askPct.toFixed(0)}%</span>
      </div>
    </div>
  )
}

// ── Probability gauge ─────────────────────────────────────────────────────────
function ProbabilityGauge({ upProb }: { upProb: number }) {
  const pct = Math.round(upProb * 100)
  const isUp = upProb > 0.5
  const color = upProb >= 0.65 ? '#34d399' : upProb <= 0.35 ? '#f87171' : '#fbbf24'

  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-2">Next Tick Probability</div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 rounded-full overflow-hidden bg-rose-500/20 relative">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: color, opacity: 0.7 }}
          />
        </div>
        <span className="text-base font-black font-mono" style={{ color }}>
          {isUp ? '▲' : '▼'} {pct}%
        </span>
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-500">
        <span>↓ Down</span>
        <span>↑ Up</span>
      </div>
    </div>
  )
}

// ── Depth chart ───────────────────────────────────────────────────────────────
function DepthChart({
  bids,
  asks,
}: {
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
}) {
  const maxBid = Math.max(...bids.map(b => b.size), 1)
  const maxAsk = Math.max(...asks.map(a => a.size), 1)
  const maxSize = Math.max(maxBid, maxAsk)

  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-2">Market Depth</div>
      <div className="flex gap-3">
        {/* Bids */}
        <div className="flex-1 space-y-0.5">
          {bids.slice(0, 8).map((level, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-11 text-right font-mono text-emerald-400 shrink-0">{fmt(level.price, 3)}</span>
              <div className="flex-1 h-3 rounded-sm overflow-hidden bg-white/3">
                <div
                  className="h-full rounded-sm bg-emerald-400/40 transition-all duration-500"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-slate-400 shrink-0">{fmtNum(level.size, 0)}</span>
            </div>
          ))}
        </div>
        {/* Asks */}
        <div className="flex-1 space-y-0.5">
          {asks.slice(0, 8).map((level, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-10 font-mono text-slate-400 shrink-0">{fmtNum(level.size, 0)}</span>
              <div className="flex-1 h-3 rounded-sm overflow-hidden bg-white/3">
                <div
                  className="h-full rounded-sm bg-rose-400/40 transition-all duration-500"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
              </div>
              <span className="w-11 font-mono text-rose-400 shrink-0">{fmt(level.price, 3)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-500 font-medium">
        <span className="text-emerald-500">▲ BIDS</span>
        <span className="text-rose-500">ASKS ▼</span>
      </div>
    </div>
  )
}

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ label, score, max = 100, color }: { label: string; score: number; max?: number; color: string }) {
  const pct = (score / max) * 100
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono font-semibold text-white">{score.toFixed(0)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

// ── Slippage table ────────────────────────────────────────────────────────────
function SlippageTable({ a }: { a: OrderBookAnalytics }) {
  const rows = [
    { size: '$100', buy: a.slippage100, sell: a.sellSlippage100 },
    { size: '$500', buy: a.slippage500, sell: a.sellSlippage500 },
    { size: '$1K', buy: a.slippage1000, sell: a.sellSlippage1000 },
    { size: '$5K', buy: a.slippage5000, sell: a.sellSlippage5000 },
  ]
  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-2">Expected Slippage</div>
      <div className="grid grid-cols-3 gap-x-2 text-[10px] text-slate-500 mb-1 font-medium">
        <span>Size</span><span className="text-right">Buy</span><span className="text-right">Sell</span>
      </div>
      {rows.map((r, i) => {
        const buyBad = r.buy > 2
        const sellBad = r.sell > 2
        return (
          <div key={i} className="grid grid-cols-3 gap-x-2 text-[10px] font-mono py-0.5 border-t border-white/4">
            <span className="text-slate-300">{r.size}</span>
            <span className={`text-right ${buyBad ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(r.buy, 3)}%</span>
            <span className={`text-right ${sellBad ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(r.sell, 3)}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Whale orders ──────────────────────────────────────────────────────────────
function WhaleOrders({ a }: { a: OrderBookAnalytics }) {
  if (!a.whaleOrders.length) {
    return (
      <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-2">🐋 Whale Orders</div>
        <div className="text-[11px] text-slate-500 italic">No significant whale orders detected</div>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-amber-400/10 bg-amber-400/3 p-3">
      <div className="text-[10px] uppercase tracking-widest text-amber-400/70 font-medium mb-2">🐋 Whale Orders ({a.whaleOrders.length})</div>
      <div className="space-y-1">
        {a.whaleOrders.slice(0, 5).map((w, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
            <span className={`font-bold ${w.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{w.side}</span>
            <span className="text-white">{fmtNum(w.size, 0)} shares</span>
            <span className="text-slate-400">@ {fmt(w.price, 4)}</span>
            <span className="ml-auto text-amber-300 font-semibold">{fmt(w.zscore, 1)}σ</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Support / Resistance ──────────────────────────────────────────────────────
function SupportResistance({ a }: { a: OrderBookAnalytics }) {
  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium mb-2">Support &amp; Resistance</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-emerald-500 font-semibold mb-1">Support</div>
          {a.supportLevels.length ? a.supportLevels.map((l, i) => (
            <div key={i} className="flex justify-between text-[10px] font-mono py-0.5">
              <span className="text-emerald-300">{fmt(l.price, 3)}</span>
              <span className="text-slate-400">{fmtNum(l.size, 0)}</span>
            </div>
          )) : <div className="text-[10px] text-slate-600 italic">N/A</div>}
        </div>
        <div>
          <div className="text-[10px] text-rose-400 font-semibold mb-1">Resistance</div>
          {a.resistanceLevels.length ? a.resistanceLevels.map((l, i) => (
            <div key={i} className="flex justify-between text-[10px] font-mono py-0.5">
              <span className="text-rose-300">{fmt(l.price, 3)}</span>
              <span className="text-slate-400">{fmtNum(l.size, 0)}</span>
            </div>
          )) : <div className="text-[10px] text-slate-600 italic">N/A</div>}
        </div>
      </div>
    </div>
  )
}

// ── Full analytics panel ───────────────────────────────────────────────────────
function AnalyticsPanel({
  a,
  bids,
  asks,
  outcomeName,
}: {
  a: OrderBookAnalytics
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
  outcomeName: string
}) {
  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard label="Best Bid" value={fmt(a.bestBid, 4)} tone="green" icon="🟢" large />
        <MetricCard label="Best Ask" value={fmt(a.bestAsk, 4)} tone="red" icon="🔴" large />
        <MetricCard label="Spread" value={`${fmt(a.spread, 4)}`} sub={`${fmt(a.spreadPercent, 2)}%`} icon="↔" />
        <MetricCard label="Midpoint" value={fmt(a.midpoint, 4)} tone="sky" icon="◎" />
      </div>

      {/* Imbalance + Probability */}
      <div className="grid sm:grid-cols-2 gap-3">
        <ImbalanceBar imbalance={a.bidAskImbalance} />
        <ProbabilityGauge upProb={a.nextTickUpProbability} />
      </div>

      {/* Depth chart */}
      {bids.length > 0 && asks.length > 0 && <DepthChart bids={bids} asks={asks} />}

      {/* Order flow */}
      <SectionTitle icon="📊">Order Flow</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard
          label="Net Flow"
          value={fmtUsd(a.netOrderFlow)}
          tone={a.netOrderFlow > 0 ? 'green' : 'red'}
          icon={a.netOrderFlow > 0 ? '🟢' : '🔴'}
        />
        <MetricCard label="Buy Volume" value={fmtUsd(a.buyVolume)} tone="green" icon="📈" />
        <MetricCard label="Sell Volume" value={fmtUsd(a.sellVolume)} tone="red" icon="📉" />
        <MetricCard label="Trades" value={fmtNum(a.tradeCount, 0)} sub={`avg ${fmtNum(a.avgTradeSize, 1)} shares`} />
      </div>

      {/* Execution speed */}
      <SectionTitle icon="⚡">Execution Speed</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricCard
          label="Orders/sec"
          value={fmt(a.newOrdersPerSecond, 3)}
          tone="sky"
          icon="⚡"
        />
        <MetricCard
          label="Orders/min"
          value={fmt(a.ordersPerMinute, 1)}
          tone="sky"
        />
        <MetricCard
          label="Exec Interval"
          value={a.executionSpeedSeconds > 0 ? `${fmt(a.executionSpeedSeconds, 2)}s` : '—'}
        />
        <MetricCard
          label="Exec Speed"
          value={a.executionSpeedTradesPerSecond > 0 ? `${fmt(a.executionSpeedTradesPerSecond, 3)}/s` : '—'}
          tone={a.executionSpeedTradesPerSecond > 0.5 ? 'green' : 'neutral'}
        />
      </div>

      {/* Cancellations */}
      <SectionTitle icon="❌">Cancellations</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricCard
          label="Cancellations"
          value={String(a.cancellationCount)}
          tone={a.cancellationCount >= 5 ? 'red' : a.cancellationCount >= 2 ? 'amber' : 'neutral'}
          icon="❌"
        />
        <MetricCard
          label="Cancel Volume"
          value={fmtNum(a.cancellationVolume, 0)}
          sub="shares cancelled"
          tone={a.cancellationCount > 0 ? 'amber' : 'neutral'}
        />
        <MetricCard
          label="Suspicion"
          value={a.cancellationCount >= 10 ? 'HIGH' : a.cancellationCount >= 3 ? 'MEDIUM' : 'LOW'}
          tone={a.cancellationCount >= 10 ? 'red' : a.cancellationCount >= 3 ? 'amber' : 'green'}
        />
      </div>

      {/* Slippage */}
      <SectionTitle icon="💸">Expected Slippage</SectionTitle>
      <SlippageTable a={a} />

      {/* Hidden liquidity */}
      <SectionTitle icon="🔍">Hidden Liquidity</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricCard
          label="Hidden Liq Est."
          value={fmtNum(a.hiddenLiquidityEstimate, 0)}
          sub="shares (iceberg)"
          tone={a.hiddenLiquidityEstimate > 1000 ? 'amber' : 'neutral'}
          icon="🧊"
        />
        <MetricCard
          label="Total Bid Depth"
          value={fmtNum(a.totalBidSize, 0)}
          sub="shares"
          tone="green"
        />
        <MetricCard
          label="Total Ask Depth"
          value={fmtNum(a.totalAskSize, 0)}
          sub="shares"
          tone="red"
        />
      </div>

      {/* Whale activity */}
      <SectionTitle icon="🐋">Whale Activity</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-3 space-y-2">
          <ScoreBar
            label="Whale Score"
            score={a.whaleActivity}
            color={a.whaleActivity > 70 ? '#fb923c' : a.whaleActivity > 40 ? '#fbbf24' : '#34d399'}
          />
          <ScoreBar label="Spoofing Risk" score={a.spoofingScore} color={a.spoofingScore > 50 ? '#f87171' : '#94a3b8'} />
          <ScoreBar label="Market Maker" score={a.marketMakerScore} color="#818cf8" />
          <ScoreBar label="Liquidity Score" score={a.liquidityScore} color={a.liquidityScore > 60 ? '#34d399' : a.liquidityScore > 30 ? '#fbbf24' : '#f87171'} />
        </div>
        <WhaleOrders a={a} />
      </div>

      {/* Patterns */}
      <SectionTitle icon="🎯">Patterns</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricCard
          label="Spoofing Risk"
          value={a.spoofingScore >= 70 ? 'HIGH' : a.spoofingScore >= 40 ? 'MEDIUM' : 'LOW'}
          sub={`score: ${a.spoofingScore.toFixed(0)}/100`}
          tone={a.spoofingScore >= 70 ? 'red' : a.spoofingScore >= 40 ? 'amber' : 'green'}
          icon="⚠️"
        />
        <MetricCard
          label="Market Maker"
          value={a.marketMakerScore >= 70 ? 'STRONG' : a.marketMakerScore >= 40 ? 'MODERATE' : 'WEAK'}
          sub={`score: ${a.marketMakerScore.toFixed(0)}/100`}
          tone={a.marketMakerScore >= 70 ? 'green' : a.marketMakerScore >= 40 ? 'sky' : 'neutral'}
          icon="🏦"
        />
        <MetricCard
          label="Liquidity Trend"
          value={a.liquidityChange > 5 ? 'IMPROVING' : a.liquidityChange < -5 ? 'DETERIORATING' : 'STABLE'}
          sub={`${a.liquidityChange >= 0 ? '+' : ''}${fmt(a.liquidityChange, 1)}% vs prev`}
          tone={a.liquidityChange > 5 ? 'green' : a.liquidityChange < -5 ? 'red' : 'sky'}
          icon="💧"
        />
      </div>

      {/* Support/Resistance */}
      <SectionTitle icon="🏔">Support &amp; Resistance</SectionTitle>
      <SupportResistance a={a} />

      {/* Volatility */}
      <SectionTitle icon="📈">Volatility Forecast</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricCard label="Realized Vol" value={`${fmt(a.realizedVolatility, 2)}%`} icon="📊" />
        <MetricCard label="Implied Vol" value={`${fmt(a.impliedVolatility, 2)}%`} icon="🔭" />
        <MetricCard
          label="Forecast"
          value={`${fmt(a.volatilityForecast, 2)}%`}
          sub={a.volatilityForecast > 10 ? 'HIGH VOLATILITY' : a.volatilityForecast > 4 ? 'MODERATE' : 'LOW'}
          tone={a.volatilityForecast > 10 ? 'red' : a.volatilityForecast > 4 ? 'amber' : 'green'}
          icon="🌡"
        />
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyAnalytics() {
  return (
    <div className="rounded-xl border border-white/7 bg-linear-to-br from-white/4 to-transparent p-6 text-center">
      <div className="text-3xl mb-2">📭</div>
      <div className="text-sm text-slate-400">No live orderbook data</div>
      <div className="text-xs text-slate-600 mt-1">Market may be closed or not yet active on CLOB</div>
    </div>
  )
}

// ── Top Holders Panel ─────────────────────────────────────────────────────────
interface LiveTokenMeta { tokenId: string; outcomeName: string }

const HOLDERS_PER_PAGE = 15
const HOLDERS_REFRESH_MS = 60_000  // refresh holders every 60 s — independent of main CLOB refresh

function TopHoldersPanel({
  conditionId,
  tokens,
}: {
  conditionId: string
  tokens: LiveTokenMeta[]
}) {
  const [data, setData] = useState<TopHoldersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState(0)    // index into outcomeGroups
  const [page, setPage] = useState(0)              // pagination within active tab
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)

  // Stable key so useEffect doesn't re-fire on every parent render.
  // Only changes when conditionId or actual token list changes.
  const tokensKey = useMemo(
    () => tokens.map(t => `${t.tokenId}:${t.outcomeName}`).join('|'),
    [tokens]
  )

  // Build the API URL once per stable key
  const apiUrl = useMemo(() => {
    const tokenIds   = tokens.map(t => t.tokenId).join(',')
    const outcomeNames = tokens.map(t => t.outcomeName).join(',')
    return (
      `/api/top-holders` +
      `?conditionId=${encodeURIComponent(conditionId)}` +
      `&limit=50` +
      (tokenIds    ? `&tokenIds=${encodeURIComponent(tokenIds)}`     : '') +
      (outcomeNames ? `&outcomes=${encodeURIComponent(outcomeNames)}` : '')
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionId, tokensKey])

  const doFetch = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(apiUrl)
      .then(r => r.json())
      .then((json: APIResponse<TopHoldersResponse>) => {
        if (json.success && json.data) {
          setData(json.data)
        } else {
          setError(json.error ?? 'Failed to fetch holders')
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [apiUrl])

  // Initial fetch + periodic refresh (independent of CLOB refresh)
  useEffect(() => {
    if (!conditionId) return
    setActiveTab(0)
    setPage(0)
    doFetch()
    const timer = setInterval(doFetch, HOLDERS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [conditionId, tokensKey, doFetch])

  // Reset pagination when tab changes
  useEffect(() => { setPage(0) }, [activeTab])

  const pnlColor = (pnl: number) =>
    pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-slate-400'

  const fmtShares = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toFixed(1)
  }

  const fmtPrice = (n: number) => n > 0 ? `${(n * 100).toFixed(1)}¢` : '—'

  const fmtPnl = (n: number) => {
    const sign = n >= 0 ? '+' : ''
    if (Math.abs(n) >= 1_000) return `${sign}$${(n / 1_000).toFixed(1)}K`
    return `${sign}$${n.toFixed(2)}`
  }

  // Format joined date as relative (e.g. "Nov 2024") or fallback to "—"
  const fmtJoined = (ms: number) => {
    if (!ms || ms <= 0) return '—'
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  // Format predictions count: 252,585 → "252K"
  const fmtPredictions = (n: number) => {
    if (!n || n <= 0) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const copyWallet = (wallet: string) => {
    navigator.clipboard.writeText(wallet).catch(() => {})
    setCopiedWallet(wallet)
    setTimeout(() => setCopiedWallet(null), 1500)
  }

  const currentGroup = data?.outcomeGroups?.[activeTab] ?? null
  const totalUsers = data?.outcomeGroups?.reduce((s, g) => s + g.holders.length, 0) ?? 0

  // Pagination
  const allHolders  = currentGroup?.holders ?? []
  const totalPages  = Math.max(1, Math.ceil(allHolders.length / HOLDERS_PER_PAGE))
  const pageHolders = allHolders.slice(page * HOLDERS_PER_PAGE, (page + 1) * HOLDERS_PER_PAGE)

  return (
    <div className="rounded-xl border border-violet-400/15 bg-violet-500/3 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">👑</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300">
            Top Share Holders
          </span>
          {data && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-mono">
              {totalUsers} users
            </span>
          )}
          {loading && (
            <span className="text-[9px] text-slate-600 animate-pulse">updating…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[9px] text-slate-700">
              ↻ {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
          <span className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* Outcome tabs — one tab per outcome (Yes / No / …) */}
          {data && data.outcomeGroups.length > 1 && (
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {data.outcomeGroups.map((g, i) => (
                <button
                  key={`${g.outcome}-${i}`}
                  onClick={() => setActiveTab(i)}
                  className={`text-[11px] px-3 py-1 rounded-lg border font-semibold transition ${
                    activeTab === i
                      ? g.outcome.toLowerCase() === 'yes'
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                        : g.outcome.toLowerCase() === 'no'
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                      : 'border-white/8 bg-white/3 text-slate-400 hover:text-white'
                  }`}
                >
                  {g.outcome}
                  <span className="ml-1 opacity-60 font-mono text-[9px]">({g.holders.length})</span>
                </button>
              ))}
            </div>
          )}

          {/* Loading skeleton — only show if no data yet */}
          {loading && !data && (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-9 rounded-lg bg-white/4" />
              ))}
            </div>
          )}

          {error && !loading && (
            <div className="text-xs text-slate-500 italic py-2">
              ⚠️ Could not load holders: {error}
            </div>
          )}

          {!loading && currentGroup && currentGroup.holders.length === 0 && (
            <div className="text-xs text-slate-500 italic py-2">No holders found for this outcome.</div>
          )}

          {currentGroup && allHolders.length > 0 && (
            <div>
              {/* Column headers */}
              <div
                className="grid gap-2 mb-2 px-1"
                style={{ gridTemplateColumns: '2rem 1fr 6rem 6rem 7rem 6rem 7rem' }}
              >
                <span className="text-[9px] uppercase tracking-wider text-slate-600">#</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-600">User</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-600 text-right">Shares</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-600 text-right">Avg Price</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-600 text-right">Unreal. PnL</span>
                <span className="text-[9px] uppercase tracking-wider text-violet-400/70 text-right">Predictions</span>
                <span className="text-[9px] uppercase tracking-wider text-violet-400/70 text-right">Joined</span>
              </div>

              <div className="space-y-1">
                {pageHolders.map((holder, i) => {
                  const globalIdx = page * HOLDERS_PER_PAGE + i
                  return (
                    <div
                      key={holder.proxyWallet}
                      className={`grid gap-2 items-center px-2 py-2 rounded-lg transition ${
                        globalIdx === 0
                          ? 'bg-amber-400/8 border border-amber-400/15'
                          : globalIdx === 1
                          ? 'bg-white/4 border border-white/6'
                          : globalIdx === 2
                          ? 'bg-white/3 border border-white/5'
                          : 'bg-white/2 border border-white/3 hover:bg-white/4'
                      }`}
                      style={{ gridTemplateColumns: '2rem 1fr 6rem 6rem 7rem 6rem 7rem' }}
                    >
                      {/* Rank */}
                      <span className={`text-[11px] font-black font-mono text-center ${
                        globalIdx === 0 ? 'text-amber-300' : globalIdx === 1 ? 'text-slate-300' : globalIdx === 2 ? 'text-amber-700' : 'text-slate-600'
                      }`}>
                        {globalIdx === 0 ? '🥇' : globalIdx === 1 ? '🥈' : globalIdx === 2 ? '🥉' : `#${globalIdx + 1}`}
                      </span>

                      {/* User identity */}
                      <div className="flex items-center gap-2 min-w-0">
                        {holder.profileImage ? (
                          <img
                            src={holder.profileImage}
                            alt=""
                            className="w-6 h-6 rounded-full shrink-0 object-cover bg-slate-700"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full shrink-0 bg-linear-to-br from-violet-500/40 to-sky-500/40 flex items-center justify-center">
                            <span className="text-[9px] font-bold text-white">
                              {(holder.username || holder.proxyWallet).slice(0, 1).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5" title={holder.username || holder.proxyWallet}>
                            <span className="text-[11px] font-semibold text-white truncate">
                              {holder.username || holder.proxyWallet}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span
                              title={holder.proxyWallet}
                              className="text-[9px] font-mono text-slate-500 break-all select-all"
                            >
                              {holder.proxyWallet}
                            </span>
                            <button
                              title="Copy wallet address"
                              onClick={() => copyWallet(holder.proxyWallet)}
                              className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-500 hover:text-sky-300 transition font-mono"
                            >
                              {copiedWallet === holder.proxyWallet ? '✓' : '⎘'}
                            </button>
                            <a
                              href={holder.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open on Polymarket"
                              className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-white/5 hover:bg-violet-500/20 text-slate-500 hover:text-violet-300 transition"
                              onClick={e => e.stopPropagation()}
                            >
                              ↗
                            </a>
                          </div>
                        </div>
                      </div>

                      {/* Shares */}
                      <div className="text-right">
                        <div className="text-[12px] font-bold font-mono text-sky-300">
                          {fmtShares(holder.shares)}
                        </div>
                        <div className="text-[9px] text-slate-600">shares</div>
                      </div>

                      {/* Avg buy price */}
                      <div className="text-right">
                        <div className="text-[12px] font-bold font-mono text-white">
                          {fmtPrice(holder.avgBuyPrice)}
                        </div>
                        <div className="text-[9px] text-slate-600">
                          {holder.tradeCount > 0 ? `${holder.tradeCount} trade${holder.tradeCount !== 1 ? 's' : ''}` : 'no trades'}
                        </div>
                      </div>

                      {/* Unrealized PnL */}
                      <div className="text-right">
                        <div className={`text-[12px] font-bold font-mono ${pnlColor(holder.unrealizedPnl)}`}>
                          {holder.avgBuyPrice > 0 ? fmtPnl(holder.unrealizedPnl) : '—'}
                        </div>
                        {holder.avgBuyPrice > 0 && (
                          <div className={`text-[9px] ${pnlColor(holder.unrealizedPnl)}`}>
                            @ {fmtPrice(currentGroup.currentPrice)} now
                          </div>
                        )}
                      </div>

                      {/* Total Predictions */}
                      <div className="text-right">
                        <div className="text-[12px] font-bold font-mono text-violet-300">
                          {fmtPredictions(holder.totalPredictions)}
                        </div>
                        <div className="text-[9px] text-slate-600">markets</div>
                      </div>

                      {/* Joined Date */}
                      <div className="text-right">
                        <div
                          className="text-[12px] font-bold font-mono text-slate-300"
                          title={
                            holder.joinedDate > 0
                              ? `First on-chain activity: ${new Date(holder.joinedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                              : 'Join date unavailable'
                          }
                        >
                          {holder.joinedDate > 0 ? fmtJoined(holder.joinedDate) : '—'}
                        </div>
                        <div className="text-[9px] text-slate-600">joined</div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-white/8 bg-white/3 text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-30 disabled:cursor-not-allowed transition font-medium"
                  >
                    ← Prev
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setPage(idx)}
                        className={`w-6 h-6 rounded text-[9px] font-mono transition ${
                          idx === page
                            ? 'bg-violet-500/30 text-violet-300 border border-violet-500/40'
                            : 'bg-white/3 text-slate-500 hover:bg-white/6 hover:text-white border border-white/5'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-white/8 bg-white/3 text-slate-400 hover:text-white hover:bg-white/6 disabled:opacity-30 disabled:cursor-not-allowed transition font-medium"
                  >
                    Next →
                  </button>
                </div>
              )}

              <div className="mt-2 text-[9px] text-slate-700 flex justify-between items-center">
                <span>Showing {page * HOLDERS_PER_PAGE + 1}–{Math.min((page + 1) * HOLDERS_PER_PAGE, allHolders.length)} of {allHolders.length} · {currentGroup.outcome}</span>
                <span>Avg price = weighted avg of BUY trades · refreshes every 90s</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Search bar ────────────────────────────────────────────────────────────────
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  onSearch: () => void
  loading: boolean
}
function SearchBar({ value, onChange, onSearch, loading }: SearchBarProps) {
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSearch()
  }
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</div>
        <input
          id="orderbook-search"
          type="text"
          className="w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:bg-white/[0.07] transition"
          placeholder="Search event, e.g. 'bitcoin', 'US election' or paste polymarket.com/event/... URL"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKey}
        />
      </div>
      <button
        id="orderbook-search-btn"
        onClick={onSearch}
        disabled={loading || !value.trim()}
        className="px-5 py-3 rounded-xl bg-sky-500/80 hover:bg-sky-400/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shrink-0"
      >
        {loading ? '...' : 'Analyze'}
      </button>
    </div>
  )
}

// ── Refresh countdown ring ─────────────────────────────────────────────────────
function RefreshRing({ interval, timeLeft }: { interval: number; timeLeft: number }) {
  const pct = (timeLeft / interval) * 100
  const r = 10
  const circ = 2 * Math.PI * r
  const dashOffset = circ * (1 - pct / 100)
  return (
    <div className="relative flex items-center justify-center" title={`Refreshing in ${timeLeft}s`}>
      <svg width="28" height="28" className="-rotate-90">
        <circle cx="14" cy="14" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" />
        <circle
          cx="14" cy="14" r={r}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <span className="absolute text-[8px] font-mono text-sky-400">{timeLeft}</span>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 1 // second — main CLOB refresh (orderbook/analytics only)
const QUICK_SEARCHES = ['Bitcoin', 'Trump', 'NBA Finals', 'US Election', 'Ethereum', 'World Cup', 'AI', 'Fed Rate']

export function OrderbookDashboard() {
  const [query, setQuery] = useState('')
  const [data, setData] = useState<LiveOrderbookResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMarket, setSelectedMarket] = useState(0)
  const [selectedToken, setSelectedToken] = useState(0)
  const [timeLeft, setTimeLeft] = useState(REFRESH_INTERVAL)
  const [isLive, setIsLive] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentQueryRef = useRef('')

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    try {
      // Detect if it's a URL or slug
      let apiUrl: string
      if (q.includes('polymarket.com') || q.includes('/event/')) {
        apiUrl = `/api/live-orderbook?url=${encodeURIComponent(q)}`
      } else if (/^[a-z0-9-]+$/.test(q.trim()) && q.includes('-')) {
        apiUrl = `/api/live-orderbook?slug=${encodeURIComponent(q.trim())}`
      } else {
        apiUrl = `/api/live-orderbook?q=${encodeURIComponent(q.trim())}`
      }
      const res = await fetch(apiUrl)
      const json = (await res.json()) as APIResponse<LiveOrderbookResponse>
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to fetch orderbook data')
      }
      setData(json.data)
      setLastUpdated(new Date())
      setIsLive(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      setIsLive(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearch = useCallback(() => {
    const q = query.trim()
    if (!q) return
    currentQueryRef.current = q
    setSelectedMarket(0)
    setSelectedToken(0)
    setIsLive(false)
    // Add to recent searches
    setRecentSearches(prev => {
      const next = [q, ...prev.filter(s => s !== q)].slice(0, 5)
      return next
    })
    // Stop existing auto-refresh
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    // Fetch immediately
    void fetchData(q)
    // Start auto-refresh
    setTimeLeft(REFRESH_INTERVAL)
    intervalRef.current = setInterval(() => {
      void fetchData(currentQueryRef.current)
      setTimeLeft(REFRESH_INTERVAL)
    }, REFRESH_INTERVAL * 1000)
    countdownRef.current = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1))
    }, 1000)
  }, [query, fetchData])

  const handleQuickSearch = (q: string) => {
    setQuery(q)
    currentQueryRef.current = q
    setSelectedMarket(0)
    setSelectedToken(0)
    // Stop existing
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    void fetchData(q)
    setTimeLeft(REFRESH_INTERVAL)
    intervalRef.current = setInterval(() => {
      void fetchData(currentQueryRef.current)
      setTimeLeft(REFRESH_INTERVAL)
    }, REFRESH_INTERVAL * 1000)
    countdownRef.current = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1))
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // Current selection
  const currentMarket = data?.markets?.[selectedMarket]
  const currentToken = currentMarket?.tokens?.[selectedToken]
  const analytics = currentToken?.analytics ?? null
  const bookSnapshot = currentToken?.bookSnapshot ?? null
  const hasLiveBook = currentToken?.hasLiveBook ?? false

  return (
    <div className="min-h-screen bg-[#06101f] text-white">
      {/* Top gradient accent */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-150 h-150 rounded-full bg-sky-500/6 blur-3xl" />
        <div className="absolute -top-20 right-0 w-100 h-100 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-200 h-100 rounded-full bg-sky-400/3 blur-3xl" />
      </div>

      <div className="relative  mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-start gap-4 ">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h1 className="text-xl font-black tracking-tight bg-linear-to-r from-sky-300 via-blue-300 to-violet-300 bg-clip-text text-transparent">
                📡 Real-Time Orderbook Analytics
              </h1>
              <button onClick={()=>window.location.href=`${window.location.origin}`} className='inline-flex rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-red-300 cursor-pointer'>Main Page</button>
            </div>
            <p className="text-sm text-slate-500">
              Bid/ask imbalance, whale detection, spoofing patterns &amp; 15+ live metrics for any Polymarket event
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isLive && (
              <>
                <RefreshRing interval={REFRESH_INTERVAL} timeLeft={timeLeft} />
                <div className="flex items-center gap-1.5">
                  <LiveDot active />
                  <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">LIVE</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="rounded-2xl border border-white/7 bg-white/2 p-4 space-y-3">
          <SearchBar value={query} onChange={setQuery} onSearch={handleSearch} loading={loading} />

          {/* Quick search chips */}
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] text-slate-600 self-center font-medium uppercase tracking-wider">Quick:</span>
            {QUICK_SEARCHES.map(q => (
              <button
                key={q}
                id={`quick-search-${q.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => handleQuickSearch(q)}
                className="text-[11px] px-3 py-1 rounded-full border border-white/8 bg-white/4 text-slate-300 hover:bg-white/8 hover:border-sky-500/30 hover:text-sky-300 transition"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] text-slate-600 self-center font-medium uppercase tracking-wider">Recent:</span>
              {recentSearches.map(q => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); handleQuickSearch(q) }}
                  className="text-[11px] px-2.5 py-0.5 rounded-full border border-sky-500/20 bg-sky-500/5 text-sky-400 hover:bg-sky-500/10 transition"
                >
                  ↺ {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3">
            <div className="text-sm text-rose-300 font-semibold">❌ {error}</div>
            <div className="text-xs text-slate-500 mt-1">
              Try searching for: "Bitcoin", "Trump", "NBA", "US election" or paste a full polymarket.com/event/... URL
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <div className="space-y-4 animate-pulse">
            <div className="h-20 rounded-2xl bg-white/3" />
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-xl bg-white/3" />)}
            </div>
            <div className="h-40 rounded-xl bg-white/3" />
          </div>
        )}

        {/* Data */}
        {data && (
          <div className="space-y-5">
            {/* Event header */}
            <div className="rounded-2xl border border-white/7 bg-linear-to-br from-sky-500/4 to-violet-500/3 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${
                      data.active && !data.closed
                        ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
                        : 'text-slate-500 border-slate-500/30 bg-slate-500/10'
                    }`}>
                      {data.active && !data.closed ? '● ACTIVE' : '● CLOSED'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">via {data.resolvedVia}</span>
                    {lastUpdated && (
                      <span className="text-[10px] text-slate-600">
                        Updated {lastUpdated.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-white truncate">{data.eventTitle}</h2>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{data.eventDescription}</p>
                </div>

                {/* Summary stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0">
                  <div className="text-center">
                    <div className="text-lg font-black font-mono text-sky-300">{data.summary.totalMarkets}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Markets</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black font-mono text-emerald-300">{data.summary.totalTokensAnalyzed}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Live Tokens</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-black font-mono ${data.summary.hasLiveData ? 'text-emerald-300' : 'text-rose-400'}`}>
                      {data.summary.hasLiveData ? '✓' : '✕'}
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Live Data</div>
                  </div>
                </div>
              </div>

              {/* Summary metrics row */}
              {data.summary.hasLiveData && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 pt-3 border-t border-white/6">
                  <MetricCard
                    label="Overall Imbalance"
                    value={data.summary.overallBidAskImbalance != null ? `${(data.summary.overallBidAskImbalance * 100).toFixed(1)}%` : '—'}
                    tone={data.summary.overallBidAskImbalance != null && data.summary.overallBidAskImbalance > 0 ? 'green' : 'red'}
                  />
                  <MetricCard
                    label="Next Tick ↑"
                    value={data.summary.overallNextTickUp != null ? `${(data.summary.overallNextTickUp * 100).toFixed(1)}%` : '—'}
                    tone={data.summary.overallNextTickUp != null && data.summary.overallNextTickUp > 0.55 ? 'green' : 'red'}
                  />
                  <MetricCard
                    label="Whale Activity"
                    value={data.summary.overallWhaleActivity != null ? `${data.summary.overallWhaleActivity.toFixed(0)}/100` : '—'}
                    tone={data.summary.overallWhaleActivity != null && data.summary.overallWhaleActivity > 50 ? 'amber' : 'neutral'}
                    icon="🐋"
                  />
                  <MetricCard
                    label="Liquidity Score"
                    value={data.summary.overallLiquidityScore != null ? `${data.summary.overallLiquidityScore.toFixed(0)}/100` : '—'}
                    tone={data.summary.overallLiquidityScore != null && data.summary.overallLiquidityScore > 60 ? 'green' : 'amber'}
                    icon="💧"
                  />
                  <MetricCard
                    label="Volatility"
                    value={data.summary.overallVolatilityForecast != null ? `${data.summary.overallVolatilityForecast.toFixed(2)}%` : '—'}
                    tone={data.summary.overallVolatilityForecast != null && data.summary.overallVolatilityForecast > 8 ? 'red' : 'neutral'}
                    icon="🌡"
                  />
                </div>
              )}
            </div>

            {/* Market selector tabs */}
            {data.markets.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {data.markets.map((market, i) => (
                  <button
                    key={market.marketId}
                    id={`market-tab-${i}`}
                    onClick={() => { setSelectedMarket(i); setSelectedToken(0) }}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium truncate max-w-50 ${
                      selectedMarket === i
                        ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                        : 'border-white/7 bg-white/3 text-slate-400 hover:text-white hover:border-white/15'
                    }`}
                    title={market.title}
                  >
                    {market.title.length > 40 ? market.title.slice(0, 38) + '…' : market.title}
                    {!market.active || market.closed ? ' 🔒' : ' ✓'}
                  </button>
                ))}
              </div>
            )}

            {/* Token outcome tabs */}
            {currentMarket && currentMarket.tokens.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                <span className="text-[10px] text-slate-600 self-center uppercase tracking-wider font-medium">Outcome:</span>
                {currentMarket.tokens.map((token, i) => (
                  <button
                    key={token.tokenId}
                    id={`token-tab-${i}`}
                    onClick={() => setSelectedToken(i)}
                    className={`text-xs px-3 py-1 rounded-lg border transition font-medium ${
                      selectedToken === i
                        ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                        : 'border-white/7 bg-white/3 text-slate-400 hover:text-white'
                    }`}
                  >
                    {token.outcomeName}
                    {token.hasLiveBook ? ' 🟢' : ' 🔴'}
                  </button>
                ))}
              </div>
            )}

            {/* Top Holders — shown for every market with a valid conditionId.
                 tokens is memoized inside TopHoldersPanel to prevent re-fetch on every CLOB refresh. */}
            {currentMarket && currentMarket.conditionId && (
              <div className="space-y-0">
                <SectionTitle icon="👑">Top Share Holders</SectionTitle>
                <TopHoldersPanel
                  conditionId={currentMarket.conditionId}
                  tokens={(currentMarket.tokens ?? []).map(t => ({ tokenId: t.tokenId, outcomeName: t.outcomeName }))}
                />
              </div>
            )}

            {/* Analytics */}
            {currentMarket && (
              <div>
                {hasLiveBook && analytics ? (
                  <AnalyticsPanel
                    a={analytics}
                    bids={bookSnapshot?.bids ?? []}
                    asks={bookSnapshot?.asks ?? []}
                    outcomeName={currentToken?.outcomeName ?? ''}
                  />
                ) : (
                  <EmptyAnalytics />
                )}
              </div>
            )}
          </div>
        )}

        {/* Initial empty state */}
        {!data && !loading && !error && (
          <div className="rounded-2xl border border-white/5 bg-white/2 p-12 text-center space-y-4">
            <div className="text-5xl">📡</div>
            <div>
              <div className="text-xl font-bold text-white mb-2">Search Any Market</div>
              <div className="text-sm text-slate-500 max-w-md mx-auto">
                Enter a topic like <span className="text-sky-400">"Bitcoin"</span>, <span className="text-sky-400">"US Election"</span>,{' '}
                <span className="text-sky-400">"NBA Finals"</span> — or paste a full Polymarket URL to get real-time L2/L3 orderbook analytics
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {['Bitcoin price', 'Trump 2024', 'NBA Championship', 'Federal Reserve', 'AI regulation'].map(q => (
                <button
                  key={q}
                  onClick={() => handleQuickSearch(q)}
                  className="text-sm px-4 py-2 rounded-xl border border-white/8 bg-white/4 text-slate-300 hover:bg-sky-500/10 hover:border-sky-500/30 hover:text-sky-300 transition"
                >
                  {q} →
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[10px] text-slate-700 pb-4">
          Data from Polymarket CLOB API · Orderbook refreshes every {REFRESH_INTERVAL}s · Holders refresh every 60s · Analytics computed server-side
        </div>
      </div>
    </div>
  )
}

export default OrderbookDashboard
