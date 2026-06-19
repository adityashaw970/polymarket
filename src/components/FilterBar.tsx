'use client'

import React from 'react'

type FilterBarProps = {
  eventSlug: string
  onEventSlugChange: (value: string) => void
  limit: number
  onLimitChange: (value: number) => void
  minScore: number
  onMinScoreChange: (value: number) => void
  minPnL: number
  onMinPnLChange: (value: number) => void
  maxPredictions: number
  onMaxPredictionsChange: (value: number) => void
  sortBy: string
  onSortByChange: (value: string) => void
  onSubmit: () => void
  loading?: boolean
}

const sortOptions = [
  { value: 'smartScore', label: 'Smart score' },
  { value: 'pnl', label: 'PnL' },
  { value: 'profitPerPrediction', label: 'Profit / prediction' },
  { value: 'winRate', label: 'Win rate' },
  { value: 'predictionsCount', label: 'Fewest predictions' },
  { value: 'joinedDaysAgo', label: 'Most recent joiners' },
  { value: 'volume', label: 'Volume' },
  { value: 'riskScore', label: 'Risk score' },
]

export function FilterBar({
  eventSlug,
  onEventSlugChange,
  limit,
  onLimitChange,
  minScore,
  onMinScoreChange,
  minPnL,
  onMinPnLChange,
  maxPredictions,
  onMaxPredictionsChange,
  sortBy,
  onSortByChange,
  onSubmit,
  loading = false,
}: FilterBarProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/20 backdrop-blur">
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Event slug</span>
          <input
            value={eventSlug}
            onChange={(event) => onEventSlugChange(event.target.value)}
            placeholder="2024-us-election or any slug"
            className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Limit</span>
            <input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Sort by</span>
            <select
              value={sortBy}
              onChange={(event) => onSortByChange(event.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-950">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Min score</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(event) => onMinScoreChange(Number(event.target.value))}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Min PnL</span>
            <input
              type="number"
              value={minPnL}
              onChange={(event) => onMinPnLChange(Number(event.target.value))}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Max predictions</span>
            <input
              type="number"
              min={1}
              value={maxPredictions}
              onChange={(event) => onMaxPredictionsChange(Number(event.target.value))}
              className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
            />
          </label>
        </div>

        <div className="flex items-end justify-end">
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="w-full rounded-2xl bg-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {loading ? 'Refreshing...' : 'Run custom scan'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FilterBar
