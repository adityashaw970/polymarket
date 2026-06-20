'use client'

import { useCallback, useEffect, useState } from 'react'

import { FilterBar } from './FilterBar'
import { SmartMoneyLeaderboard } from './SmartMoneyLeaderboard'
import { TraderCard } from './TraderCard'
import { OrderBookPanel } from './OrderBookPanel'
import { EventHolders } from './EventHolders'
import {
  APIResponse,
  EventAnalysisResponse,
  SmartMoneyTrader,
  TraderActivityResponse,
} from '../types'
import { formatCurrency, formatNumber, formatPercent } from '../utils'

type LeaderboardPayload = {
  data: SmartMoneyTrader[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

const DEFAULT_LIMIT = 100

function statLabel(value: number, suffix = ''): string {
  return `${formatNumber(value, 0)}${suffix}`
}

function shortLabel(value: string): string {
  if (value.startsWith('0x') && value.length > 12) {
    const parts = value.split('-')
    const addr = parts[0]
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }
  return value
}

function formatJoinDate(joinedAt: number, joinedDaysAgo: number): string {
  // If we have a real joinedAt timestamp, format as "Mon YYYY"
  if (joinedAt > 0 && joinedAt < Date.now()) {
    const date = new Date(joinedAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`

    // For older dates, show the actual month/year
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  // Fallback to days-based display
  if (joinedDaysAgo === 0) return 'Today'
  if (joinedDaysAgo === 1) return 'Yesterday'
  if (joinedDaysAgo < 7) return `${joinedDaysAgo}d ago`
  if (joinedDaysAgo < 30) return `${Math.floor(joinedDaysAgo / 7)}w ago`
  if (joinedDaysAgo < 365) return `${Math.floor(joinedDaysAgo / 30)}mo ago`
  return `${Math.floor(joinedDaysAgo / 365)}y ago`
}

export function ScoutDashboard() {
  const [traders, setTraders] = useState<SmartMoneyTrader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [eventSlug, setEventSlug] = useState('')
  const [eventData, setEventData] = useState<EventAnalysisResponse | null>(null)
  const [eventLoading, setEventLoading] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)

  const [minScore, setMinScore] = useState(40)
  const [minPnL, setMinPnL] = useState(0)
  const [maxPredictions, setMaxPredictions] = useState(25)
  const [sortBy, setSortBy] = useState('smartScore')
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null)
  const [selectedTrader, setSelectedTrader] = useState<TraderActivityResponse | null>(null)
  const [traderLoading, setTraderLoading] = useState(false)
  const [recentLimit, setRecentLimit] = useState(10)

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        limit: String(limit),
        sortBy,
        minScore: String(minScore),
        minPnL: String(minPnL),
        maxPredictions: String(maxPredictions),
        timePeriod: '30d',
        category: 'OVERALL',
      })

      const response = await fetch(`/api/leaderboard?${params.toString()}`)
      const json = (await response.json()) as APIResponse<LeaderboardPayload>

      if (!json.success) {
        throw new Error(json.error || 'Failed to fetch leaderboard')
      }

      setTraders(json.data.data)
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch leaderboard')
    } finally {
      setLoading(false)
    }
  }, [limit, maxPredictions, minPnL, minScore, sortBy])

  const fetchTrader = useCallback(async (wallet: string) => {
    try {
      setTraderLoading(true)
      const response = await fetch(`/api/traders/${wallet}`)
      const json = (await response.json()) as APIResponse<TraderActivityResponse>

      if (!json.success) {
        throw new Error(json.error || 'Failed to fetch trader details')
      }

      setSelectedTrader(json.data)
    } catch (fetchError) {
      setSelectedTrader(null)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch trader details')
    } finally {
      setTraderLoading(false)
    }
  }, [])

  const fetchEventAnalysis = useCallback(async (silent: boolean | React.MouseEvent = false) => {
    if (!eventSlug.trim()) {
      setEventError('Enter an event slug first.')
      return
    }

    const isSilent = silent === true

    try {
      if (!isSilent) setEventLoading(true)
      const response = await fetch(`/api/events/${encodeURIComponent(eventSlug.trim())}/analysis?limit=8`)
      const json = (await response.json()) as APIResponse<EventAnalysisResponse>

      if (!json.success) {
        throw new Error(json.error || 'Failed to fetch event analysis')
      }

      setEventData(json.data)
      setEventError(null)
    } catch (fetchError) {
      setEventError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch event analysis')
      if (!isSilent) setEventData(null)
    } finally {
      if (!isSilent) setEventLoading(false)
    }
  }, [eventSlug])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchLeaderboard()
    }, 0)

    const interval = window.setInterval(() => {
      void fetchLeaderboard()
    }, 5 * 60 * 1000) // Poll every 5 min — matches server cache TTL

    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [fetchLeaderboard])

  useEffect(() => {
    if (!eventData || !eventSlug.trim()) return

    const interval = window.setInterval(() => {
      void fetchEventAnalysis(true)
    }, 1 * 60 * 1000) // Auto-refresh event analysis every 1 minute

    return () => {
      window.clearInterval(interval)
    }
  }, [eventData, eventSlug, fetchEventAnalysis])

  useEffect(() => {
    if (selectedWallet) {
      const loadTrader = window.setTimeout(() => {
        void fetchTrader(selectedWallet)
      }, 0)

      return () => {
        window.clearTimeout(loadTrader)
      }
    } else {
      const clearSelection = window.setTimeout(() => {
        setSelectedTrader(null)
      }, 0)

      return () => {
        window.clearTimeout(clearSelection)
      }
    }
  }, [fetchTrader, selectedWallet])

  const averageScore =
    traders.length > 0
      ? traders.reduce((sum, trader) => sum + trader.smartMoneyScore.totalScore, 0) / traders.length
      : 0

  const lowPredictionWhales = traders.filter((trader) => trader.predictionsCount <= maxPredictions).slice(0, 6)
  const recentJoiners = traders
    .slice()
    .sort((a, b) => a.joinedDaysAgo - b.joinedDaysAgo)
    .slice(0, recentLimit)

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-400 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-4xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/30 backdrop-blur md:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="space-y-5">
            <div className=' w-full flex items-center justify-start gap-[2vw]'>
              <div className="inline-flex rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-300">
              Polymarket scout
            </div>
            <button onClick={()=>window.location.href=`${window.location.origin}/orderbook`} className='inline-flex rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-red-300 cursor-pointer'>Go to Orderbook</button>
            </div>

            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Find the traders who act early, size up hard, and stay profitable.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Scan the leaderboard with your own rules, focus on low-prediction high-PnL wallets, and drill into event
                groups to see which buyers and sellers are concentrated on each outcome.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Tracked traders</div>
                <div className="mt-2 text-2xl font-semibold text-white">{statLabel(traders.length)}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Average score</div>
                <div className="mt-2 text-2xl font-semibold text-white">{statLabel(averageScore, '')}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Best PnL</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-300">
                  {formatCurrency(traders[0]?.pnl ?? 0)}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Recent joiner</div>
                <div className="mt-2 truncate text-lg font-semibold text-white">
                  {shortLabel(
                    recentJoiners[0]?.userDisplayName ||
                      recentJoiners[0]?.userUsername ||
                      'Waiting for data'
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {recentJoiners[0]
                    ? `${formatJoinDate(recentJoiners[0].joinedAt, recentJoiners[0].joinedDaysAgo)} joined`
                    : 'Use the filters below'}
                </div>
              </div>
            </div>
          </div>

         
        </div>
      </section>

      <FilterBar
        eventSlug={eventSlug}
        onEventSlugChange={setEventSlug}
        limit={limit}
        onLimitChange={setLimit}
        minScore={minScore}
        onMinScoreChange={setMinScore}
        minPnL={minPnL}
        onMinPnLChange={setMinPnL}
        maxPredictions={maxPredictions}
        onMaxPredictionsChange={setMaxPredictions}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onSubmit={fetchLeaderboard}
        loading={loading}
      />

      {error && (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.7fr_0.9fr] w-full min-w-0">
        <div className="min-w-0">
          <SmartMoneyLeaderboard traders={traders} loading={loading} onTraderClick={(trader) => setSelectedWallet(trader.proxyWallet)} />
        </div>

        <div className="space-y-1 min-w-0">
          <section className="rounded-4xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Trader detail</div>
                <div className="mt-1 text-lg font-semibold text-white">Selected wallet</div>
              </div>
              {traderLoading && <div className="text-sm text-slate-400">Loading...</div>}
            </div>

            {selectedTrader ? (
              <div className="mt-4 space-y-1">
                <TraderCard trader={selectedTrader.trader} />

                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Recent trades</div>
                    <div className="mt-3 space-y-2">
                      {selectedTrader.recentTrades.slice(0, 4).map((trade) => (
                        <div key={trade.hashId || `${trade.marketId}-${trade.timestamp}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="flex items-start justify-between gap-2 text-sm">
                            <span className="font-medium text-white line-clamp-2 wrap-break-word text-sm pr-1">{trade.marketTitle}</span>
                            <span className={`shrink-0 font-semibold ${trade.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {trade.side}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400 wrap-break-word">
                            {trade.outcome} - {formatNumber(trade.sharesTraded, 0)} shares at {trade.pricePerShare.toFixed(3)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Top holdings</div>
                    <div className="mt-3 space-y-2">
                      {selectedTrader.positions.slice(0, 4).map((position) => (
                        <div key={`${position.marketId}-${position.outcome}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <div className="text-sm font-medium text-white line-clamp-2 wrap-break-word">{position.marketTitle}</div>
                          <div className="mt-1 text-xs text-slate-400 wrap-break-word">
                            {position.outcome} - value {formatCurrency(position.currentValue)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-6 text-sm text-slate-300">
                Click any trader row to inspect their positions and recent trades.
              </div>
            )}
          </section>

        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-4xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Low prediction whales</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {lowPredictionWhales.map((trader) => (
              <TraderCard key={trader.proxyWallet} trader={trader} onClick={(nextTrader) => setSelectedWallet(nextTrader.proxyWallet)} />
            ))}
          </div>
        </div>

        <div className="rounded-4xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Recent joiners</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Show:</span>
              <input
                type="number"
                min={1}
                max={50}
                value={recentLimit}
                onChange={(e) => setRecentLimit(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-12 rounded-lg border border-white/10 bg-slate-950/60 px-1.5 py-0.5 text-center text-xs font-semibold text-white outline-none focus:border-sky-400"
              />
            </div>
          </div>
          <div className="mt-4 space-y-3 max-h-[47vw] overflow-y-auto pr-1">
            {recentJoiners.map((trader) => (
              <div key={trader.proxyWallet} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {shortLabel(trader.userDisplayName || trader.userUsername || trader.proxyWallet.slice(0, 8))}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {formatJoinDate(trader.joinedAt, trader.joinedDaysAgo)} joined - {formatPercent(trader.winRate)}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-emerald-300">{formatCurrency(trader.pnl)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ScoutDashboard
