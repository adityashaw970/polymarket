'use client'

import React, { useState } from 'react'

import { SmartMoneyTrader } from '../types'
import { formatCurrency, formatDaysAgo, formatPercent, formatNumber } from '../utils'

interface SmartMoneyLeaderboardProps {
  traders: SmartMoneyTrader[]
  loading?: boolean
  onTraderClick?: (trader: SmartMoneyTrader) => void
}

type SortField =
  | 'smartScore'
  | 'pnl'
  | 'profitPerPrediction'
  | 'winRate'
  | 'predictionsCount'
  | 'joinedDaysAgo'
  | 'volume'
  | 'riskScore'

const sortLabels: Record<SortField, string> = {
  smartScore: 'Smart score',
  pnl: 'PnL',
  profitPerPrediction: 'Profit / prediction',
  winRate: 'Win rate',
  predictionsCount: 'Predictions',
  joinedDaysAgo: 'Recency',
  volume: 'Volume',
  riskScore: 'Risk',
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
}

function formatDisplayName(name: string | undefined): string {
  if (!name) return 'Trader'
  if (name.startsWith('0x') && name.length > 12) {
    const parts = name.split('-')
    const addr = parts[0]
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }
  return name
}

export const SmartMoneyLeaderboard: React.FC<SmartMoneyLeaderboardProps> = ({
  traders,
  loading = false,
  onTraderClick,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortField>('smartScore')
  const [sortAsc, setSortAsc] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)

  const itemsPerPage = 12

  const sorted = [...traders].sort((a, b) => {
    let aVal = 0
    let bVal = 0

    switch (sortBy) {
      case 'smartScore':
        aVal = a.smartMoneyScore.totalScore
        bVal = b.smartMoneyScore.totalScore
        break
      case 'pnl':
        aVal = a.pnl
        bVal = b.pnl
        break
      case 'profitPerPrediction':
        aVal = a.profitPerPrediction
        bVal = b.profitPerPrediction
        break
      case 'winRate':
        aVal = a.winRate
        bVal = b.winRate
        break
      case 'predictionsCount':
        aVal = a.predictionsCount
        bVal = b.predictionsCount
        break
      case 'joinedDaysAgo':
        aVal = a.joinedDaysAgo
        bVal = b.joinedDaysAgo
        break
      case 'volume':
        aVal = a.volume
        bVal = b.volume
        break
      case 'riskScore':
        aVal = a.riskScore
        bVal = b.riskScore
        break
    }

    return sortAsc ? aVal - bVal : bVal - aVal
  })

  const start = currentPage * itemsPerPage
  const end = start + itemsPerPage
  const paginated = sorted.slice(start, end)

  const toggleExpanded = (wallet: string) => {
    const next = new Set(expanded)
    if (next.has(wallet)) {
      next.delete(wallet)
    } else {
      next.add(wallet)
    }
    setExpanded(next)
  }

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc)
      return
    }

    setSortBy(field)
    setSortAsc(field === 'joinedDaysAgo')
  }

  const scoreTone = (score: number): string => {
    if (score >= 80) return 'bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/30'
    if (score >= 60) return 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/30'
    if (score >= 40) return 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30'
    return 'bg-rose-400/20 text-rose-300 ring-1 ring-rose-400/30'
  }

  const scoreText = (value: number) => {
    if (value >= 80) return 'Elite'
    if (value >= 60) return 'Strong'
    if (value >= 40) return 'Watch'
    return 'Weak'
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Sort bar skeleton */}
        <div className="flex flex-wrap items-center gap-2 rounded-3xl border border-white/10 bg-white/5 p-3 shadow-2xl shadow-slate-950/20 backdrop-blur">
          <div className="h-4 w-14 rounded-full bg-white/8 animate-pulse" />
          {[96, 48, 128, 72, 96, 72, 64, 48].map((w, i) => (
            <div key={i} className="h-7 rounded-full bg-white/6 animate-pulse" style={{ width: w, animationDelay: `${i * 60}ms` }} />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-slate-950/40 backdrop-blur">
          {/* thead */}
          <div className="flex gap-4 border-b border-white/10 bg-white/5 px-4 py-4">
            {[40, 160, 64, 96, 104, 72, 80, 64].map((w, i) => (
              <div key={i} className="h-3 rounded-full bg-white/10 animate-pulse shrink-0" style={{ width: w, animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
          {/* rows */}
          {Array.from({ length: 8 }).map((_, rowIdx) => (
            <div
              key={rowIdx}
              className="flex items-center gap-4 border-b border-white/5 px-4 py-4"
              style={{ animationDelay: `${rowIdx * 80}ms` }}
            >
              {/* rank */}
              <div className="h-4 w-8 rounded-full bg-white/8 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80}ms` }} />
              {/* name */}
              <div className="flex flex-col gap-1.5 shrink-0" style={{ width: 160 }}>
                <div className="h-3.5 w-28 rounded-full bg-white/8 animate-pulse" style={{ animationDelay: `${rowIdx * 80 + 20}ms` }} />
                <div className="h-2.5 w-20 rounded-full bg-white/5 animate-pulse" style={{ animationDelay: `${rowIdx * 80 + 40}ms` }} />
              </div>
              {/* score */}
              <div className="h-6 w-14 rounded-full bg-emerald-400/10 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80 + 30}ms` }} />
              {/* pnl */}
              <div className="h-4 w-20 rounded-full bg-white/6 animate-pulse shrink-0 ml-auto" style={{ animationDelay: `${rowIdx * 80 + 50}ms` }} />
              {/* pnl/pred */}
              <div className="h-4 w-20 rounded-full bg-white/6 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80 + 60}ms` }} />
              {/* win rate */}
              <div className="h-4 w-14 rounded-full bg-white/6 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80 + 70}ms` }} />
              {/* predictions */}
              <div className="h-4 w-12 rounded-full bg-white/6 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80 + 80}ms` }} />
              {/* joined */}
              <div className="h-4 w-14 rounded-full bg-white/6 animate-pulse shrink-0" style={{ animationDelay: `${rowIdx * 80 + 90}ms` }} />
            </div>
          ))}
          {/* footer */}
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-4">
            <div className="h-3 w-32 rounded-full bg-white/6 animate-pulse" />
            <div className="flex gap-2">
              <div className="h-8 w-24 rounded-full bg-white/6 animate-pulse" />
              <div className="h-8 w-16 rounded-full bg-white/6 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (traders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 px-6 py-16 text-center text-sm text-slate-300 backdrop-blur">
        No traders matched the current filters.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-3xl border border-white/10 bg-white/5 p-3 shadow-2xl shadow-slate-950/20 backdrop-blur">
        <span className="mr-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
          Sort by
        </span>
        {(Object.keys(sortLabels) as SortField[]).map((field) => (
          <button
            key={field}
            type="button"
            onClick={() => handleSort(field)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              sortBy === field
                ? 'bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            {sortLabels[field]}
            {sortBy === field ? (sortAsc ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-slate-950/40 backdrop-blur">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 table-fixed">
            <thead className="bg-white/5 text-left text-[11px] uppercase tracking-[0.24em] text-slate-400">
              <tr>
                <th className="px-4 py-4 w-[8%]">Rank</th>
                <th className="px-4 py-4 w-[24%]">Trader</th>
                <th className="px-4 py-4 text-right w-[11%]">
                  <button type="button" onClick={() => handleSort('smartScore')} className="inline-flex items-center gap-1">
                    Score {sortBy === 'smartScore' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="px-4 py-4 text-right w-[13%]">
                  <button type="button" onClick={() => handleSort('pnl')} className="inline-flex items-center gap-1">
                    PnL {sortBy === 'pnl' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="px-4 py-4 text-right w-[14%]">
                  <button
                    type="button"
                    onClick={() => handleSort('profitPerPrediction')}
                    className="inline-flex items-center gap-1"
                  >
                    PnL / pred {sortBy === 'profitPerPrediction' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="px-4 py-4 text-right w-[10%]">
                  <button type="button" onClick={() => handleSort('winRate')} className="inline-flex items-center gap-1">
                    Win rate {sortBy === 'winRate' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="px-4 py-4 text-right w-[10%]">
                  <button
                    type="button"
                    onClick={() => handleSort('predictionsCount')}
                    className="inline-flex items-center gap-1"
                  >
                    Predictions {sortBy === 'predictionsCount' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
                <th className="px-4 py-4 text-right w-[10%]">
                  <button
                    type="button"
                    onClick={() => handleSort('joinedDaysAgo')}
                    className="inline-flex items-center gap-1"
                  >
                    Joined {sortBy === 'joinedDaysAgo' ? (sortAsc ? '↑' : '↓') : ''}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {paginated.map((trader, idx) => {
                const isOpen = expanded.has(trader.proxyWallet)

                return (
                  <React.Fragment key={trader.proxyWallet}>
                    <tr
                      className={`cursor-pointer transition ${
                        isOpen ? 'bg-sky-400/5' : 'hover:bg-white/5'
                      }`}
                      onClick={() => {
                        toggleExpanded(trader.proxyWallet)
                        onTraderClick?.(trader)
                      }}
                    >
                      <td className="px-4 py-4 text-sm font-semibold text-white">#{start + idx + 1}</td>
                      <td className="px-4 py-4">
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate text-sm font-semibold text-white">
                              {formatDisplayName(trader.userDisplayName || trader.userUsername)}
                            </span>
                            <a
                              href={`https://polymarket.com/profile/${trader.proxyWallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open on Polymarket"
                              className="shrink-0 text-slate-500 hover:text-sky-300 transition text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              ↗
                            </a>
                          </div>
                          <span className="truncate font-mono text-[11px] text-slate-400">{shortWallet(trader.proxyWallet)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${scoreTone(trader.smartMoneyScore.totalScore)}`}>
                          {trader.smartMoneyScore.totalScore}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-4 text-right text-sm font-semibold ${
                          trader.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatCurrency(trader.pnl)}
                      </td>
                      <td
                        className={`px-4 py-4 text-right text-sm ${
                          trader.profitPerPrediction >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {formatCurrency(trader.profitPerPrediction)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-slate-200">
                        {formatPercent(trader.winRate)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-slate-200">
                        {formatNumber(trader.predictionsCount, 0)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-slate-300">
                        {formatDaysAgo(trader.joinedDaysAgo)}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-white/3">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="grid gap-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4 md:grid-cols-[1.2fr_1fr]">
                            <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Smart money score</div>
                                <div className="mt-1 text-2xl font-semibold text-white">
                                  {trader.smartMoneyScore.totalScore}
                                    <span className="ml-2 text-sm font-medium text-slate-400">
                                      {scoreText(trader.smartMoneyScore.totalScore)}
                                    </span>
                                  </div>
                                </div>
                              <div className="max-w-sm text-right text-sm leading-6 text-slate-300">
                                {trader.smartMoneyScore.explanation}
                              </div>
                            </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Efficiency</div>
                                  <div className="mt-1 text-lg font-semibold text-white">{trader.smartMoneyScore.efficiency}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Timing</div>
                                  <div className="mt-1 text-lg font-semibold text-white">{trader.smartMoneyScore.timing}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Conviction</div>
                                  <div className="mt-1 text-lg font-semibold text-white">{trader.smartMoneyScore.conviction}</div>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Consistency</div>
                                  <div className="mt-1 text-lg font-semibold text-white">{trader.smartMoneyScore.consistency}</div>
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Average trade</div>
                                <div className="mt-2 text-lg font-semibold text-white">{formatCurrency(trader.avgTradeSize)}</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Large trades</div>
                                <div className="mt-2 text-lg font-semibold text-white">{trader.largeTradesCount}</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Early entries</div>
                                <div className="mt-2 text-lg font-semibold text-white">{trader.earlyEntryCount}</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Risk score</div>
                                <div className="mt-2 text-lg font-semibold text-white">{formatNumber(trader.riskScore, 0)}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-4 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
          <div>
            Showing {start + 1}-{Math.min(end, sorted.length)} of {sorted.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={end >= sorted.length}
              onClick={() => setCurrentPage((page) => page + 1)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SmartMoneyLeaderboard
