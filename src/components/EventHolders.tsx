'use client'

import React, { useState } from 'react'
import { EnrichedMarketHolder } from '../types'
import { formatCurrency, formatNumber, formatDate } from '../utils'

interface EventHoldersProps {
  holders: EnrichedMarketHolder[]
  marketTitle?: string
}

type SortKey = 'size' | 'avgBuyPrice' | 'avgSellPrice' | 'totalBought' | 'totalSold' | 'unrealizedPnl' | 'realizedPnl' | 'tradeCount'

const sortLabels: Record<SortKey, string> = {
  size: 'Shares Held',
  avgBuyPrice: 'Avg Buy Price',
  avgSellPrice: 'Avg Sell Price',
  totalBought: 'Total Bought',
  totalSold: 'Total Sold',
  unrealizedPnl: 'Unrealized P&L',
  realizedPnl: 'Realized P&L',
  tradeCount: 'Trades',
}

export function EventHolders({ holders, marketTitle }: EventHoldersProps) {
  const [sortBy, setSortBy] = useState<SortKey>('size')
  const [sortAsc, setSortAsc] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sorted = [...holders].sort((a, b) => {
    const aVal = a[sortBy] ?? 0
    const bVal = b[sortBy] ?? 0
    return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
  })

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortBy(key)
      setSortAsc(false)
    }
  }

  const toggleExpanded = (wallet: string) => {
    const next = new Set(expanded)
    if (next.has(wallet)) next.delete(wallet)
    else next.add(wallet)
    setExpanded(next)
  }

  if (holders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-6 text-sm text-slate-300">
        No holder data available for this market.
      </div>
    )
  }

  // Compute total supply for percentage
  const totalSupply = holders.reduce((sum, h) => sum + h.size, 0)

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur space-y-4">
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Holdings breakdown</div>
        {marketTitle && <div className="mt-1 text-sm font-semibold text-white line-clamp-1">{marketTitle}</div>}
        <div className="mt-1 text-xs text-slate-400">{holders.length} holders · {formatNumber(totalSupply, 0)} total shares</div>
      </div>

      {/* Sort Buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(sortLabels) as SortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleSort(key)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${
              sortBy === key
                ? 'bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {sortLabels[key]}
            {sortBy === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>

      {/* Holders Table */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10">
            <thead className="bg-white/5 text-left text-[10px] uppercase tracking-[0.24em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Holder</th>
                <th className="px-3 py-3 text-right">Shares</th>
                <th className="px-3 py-3 text-right">% Supply</th>
                <th className="px-3 py-3 text-right">Avg Buy</th>
                <th className="px-3 py-3 text-right">Avg Sell</th>
                <th className="px-3 py-3 text-right">Bought</th>
                <th className="px-3 py-3 text-right">Sold</th>
                <th className="px-3 py-3 text-right">Unreal. P&L</th>
                <th className="px-3 py-3 text-right">Real. P&L</th>
                <th className="px-3 py-3 text-right">Trades</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {sorted.map((holder) => {
                const isOpen = expanded.has(holder.proxyWallet)
                const supplyPct = totalSupply > 0 ? (holder.size / totalSupply) * 100 : 0
                const displayName = holder.userDisplayName || holder.userUsername || `${holder.proxyWallet.slice(0, 6)}...${holder.proxyWallet.slice(-4)}`

                return (
                  <React.Fragment key={holder.proxyWallet}>
                    <tr
                      className={`cursor-pointer transition text-xs ${isOpen ? 'bg-sky-400/5' : 'hover:bg-white/5'}`}
                      onClick={() => toggleExpanded(holder.proxyWallet)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-white truncate max-w-35">{displayName}</span>
                          <span className="font-mono text-[10px] text-slate-500">{holder.proxyWallet.slice(0, 6)}...{holder.proxyWallet.slice(-4)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold text-white">{formatNumber(holder.size, 0)}</td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 rounded-full overflow-hidden bg-white/10">
                            <div
                              className="h-full rounded-full bg-sky-400/60"
                              style={{ width: `${Math.min(100, supplyPct)}%` }}
                            />
                          </div>
                          <span>{supplyPct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-emerald-300">{holder.avgBuyPrice > 0 ? holder.avgBuyPrice.toFixed(4) : '—'}</td>
                      <td className="px-3 py-3 text-right font-mono text-rose-300">{holder.avgSellPrice > 0 ? holder.avgSellPrice.toFixed(4) : '—'}</td>
                      <td className="px-3 py-3 text-right text-slate-200">{formatNumber(holder.totalBought, 0)}</td>
                      <td className="px-3 py-3 text-right text-slate-200">{formatNumber(holder.totalSold, 0)}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${holder.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {formatCurrency(holder.unrealizedPnl)}
                      </td>
                      <td className={`px-3 py-3 text-right font-semibold ${holder.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {formatCurrency(holder.realizedPnl)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">{holder.tradeCount}</td>
                    </tr>

                    {/* Expanded row: individual trades */}
                    {isOpen && holder.trades.length > 0 && (
                      <tr className="bg-white/2">
                        <td colSpan={10} className="px-3 py-3">
                          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-2">
                              Trade History ({holder.trades.length} trades)
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                              {holder.trades.slice(0, 20).map((trade, i) => (
                                <div
                                  key={`${trade.hashId || i}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/2 px-2.5 py-1.5 text-[11px]"
                                >
                                  <span className={`font-semibold w-8 ${trade.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>
                                    {trade.side}
                                  </span>
                                  <span className="text-white font-mono">{formatNumber(trade.shares, 0)} shares</span>
                                  <span className="text-slate-300 font-mono">@ {trade.price.toFixed(4)}</span>
                                  <span className="text-slate-400">{formatCurrency(trade.cost)}</span>
                                  <span className="text-slate-500 text-[10px]">
                                    {trade.timestamp > 0 ? formatDate(trade.timestamp) : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {holder.trades.length > 20 && (
                              <div className="mt-2 text-[10px] text-slate-500">
                                Showing 20 of {holder.trades.length} trades
                              </div>
                            )}
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
      </div>
    </div>
  )
}

export default EventHolders
