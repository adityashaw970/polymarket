import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

import { APIResponse, TraderActivityResponse } from '@/types'
import { formatCurrency, formatDaysAgo, formatNumber } from '@/utils'

export default function TraderPage() {
  const router = useRouter()
  const wallet = typeof router.query.wallet === 'string' ? router.query.wallet : ''

  const [data, setData] = useState<TraderActivityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady || !wallet) return

    const run = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/traders/${encodeURIComponent(wallet)}`)
        const json = (await response.json()) as APIResponse<TraderActivityResponse>

        if (!json.success) {
          throw new Error(json.error || 'Failed to load trader')
        }

        setData(json.data)
        setError(null)
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load trader')
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [router.isReady, wallet])

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
        <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Trader detail</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">{wallet || 'Loading trader...'}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Wallet activity, position sizing, and current market exposure.
        </p>
      </div>

      {loading && <div className="mt-6 text-sm text-slate-300">Loading trader details...</div>}
      {error && <div className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}

      {data && (
        <div className="mt-6 space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Score</div>
                <div className="mt-2 text-2xl font-semibold text-white">{data.trader.smartMoneyScore.totalScore}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">PnL</div>
                <div className={`mt-2 text-2xl font-semibold ${data.trader.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {formatCurrency(data.trader.pnl)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Predictions</div>
                <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data.trader.predictionsCount, 0)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Joined</div>
                <div className="mt-2 text-2xl font-semibold text-white">{formatDaysAgo(data.trader.joinedDaysAgo)}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Positions</div>
              <div className="mt-4 space-y-3">
                {data.positions.map((position) => (
                  <div key={`${position.marketId}-${position.outcome}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{position.marketTitle}</div>
                        <div className="text-xs text-slate-400">{position.outcome}</div>
                      </div>
                      <div className="text-sm font-semibold text-sky-300">{formatCurrency(position.currentValue)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4">
                      <div>Size {formatNumber(position.size, 0)}</div>
                      <div>Avg {position.avgPrice.toFixed(3)}</div>
                      <div>PnL {formatCurrency(position.cashPnl)}</div>
                      <div>Price {position.price.toFixed(3)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Recent trades</div>
                <div className="mt-4 space-y-3">
                  {data.recentTrades.map((trade) => (
                    <div key={trade.hashId || `${trade.marketId}-${trade.timestamp}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{trade.marketTitle}</div>
                          <div className="text-xs text-slate-400">{trade.outcome}</div>
                        </div>
                        <div className={trade.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>
                          {trade.side}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        {formatNumber(trade.sharesTraded, 0)} shares - {trade.pricePerShare.toFixed(3)} - {formatCurrency(trade.totalCost)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Market holdings</div>
                <div className="mt-4 space-y-3">
                  {data.marketHoldings.map((holding) => (
                    <div key={`${holding.marketId}-${holding.outcome}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{holding.eventTitle}</div>
                          <div className="text-xs text-slate-400">{holding.outcome}</div>
                        </div>
                        <div className="text-xs text-sky-300">{holding.smartMoneyHolders[0]?.smartMoneyScore ?? 0}</div>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        Current value {formatCurrency(holding.smartMoneyHolders[0]?.position.currentValue ?? 0)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
