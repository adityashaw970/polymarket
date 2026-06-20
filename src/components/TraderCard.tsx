'use client'

import React from 'react'

import { SmartMoneyTrader } from '../types'
import { formatCurrency, formatDaysAgo, formatPercent, formatNumber } from '../utils'

interface TraderCardProps {
  trader: SmartMoneyTrader
  onClick?: (trader: SmartMoneyTrader) => void
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

export function TraderCard({ trader, onClick }: TraderCardProps) {
  const tone =
    trader.smartMoneyScore.totalScore >= 80
      ? 'border-emerald-400/30 bg-emerald-400/10'
      : trader.smartMoneyScore.totalScore >= 60
        ? 'border-sky-400/30 bg-sky-400/10'
        : 'border-white/10 bg-white/5'

  return (
    <button
      type="button"
      onClick={() => onClick?.(trader)}
      className={`group w-full rounded-3xl border p-4 text-left shadow-2xl shadow-slate-950/20 transition hover:-translate-y-0.5 hover:border-sky-400/40 ${tone}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">
            {formatDisplayName(trader.userDisplayName || trader.userUsername)}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
            {trader.proxyWallet.slice(0, 6)}...{trader.proxyWallet.slice(-4)}
          </div>
        </div>

        <div className="rounded-full bg-slate-950/80 px-3 py-1 text-xs font-semibold text-sky-300 ring-1 ring-sky-400/20">
          {trader.smartMoneyScore.totalScore}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">PnL</div>
          <div className={`mt-1 text-sm font-semibold ${trader.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {formatCurrency(trader.pnl)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Predictions</div>
          <div className="mt-1 text-sm font-semibold text-white">{formatNumber(trader.predictionsCount, 0)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Win rate</div>
          <div className="mt-1 text-sm font-semibold text-white">{formatPercent(trader.winRate)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Joined</div>
          <div className="mt-1 text-sm font-semibold text-white">{formatDaysAgo(trader.joinedDaysAgo)}</div>
        </div>
      </div>
    </button>
  )
}

export default TraderCard
