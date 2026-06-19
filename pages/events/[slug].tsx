import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

import { APIResponse, EventAnalysisResponse } from '@/types'
import { formatCurrency, formatNumber } from '@/utils'
import { EventHolders } from '@/components/EventHolders'
import { OrderBookPanel } from '@/components/OrderBookPanel'

export default function EventPage() {
  const router = useRouter()
  const slug = typeof router.query.slug === 'string' ? router.query.slug : ''

  const [data, setData] = useState<EventAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady || !slug) return

    const run = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/analysis?limit=8`)
        const json = (await response.json()) as APIResponse<EventAnalysisResponse>

        if (!json.success) {
          throw new Error(json.error || 'Failed to load event')
        }

        setData(json.data)
        setError(null)
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load event')
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [router.isReady, slug])

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
        <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Event detail</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">{slug || 'Loading event...'}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Outcome groups, top holders, and smart-money signals for this Polymarket event.
        </p>
      </div>

      {loading && <div className="mt-6 text-sm text-slate-300">Loading event analysis...</div>}
      {error && <div className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div>}

      {data && (
        <div className="mt-6 space-y-6">
          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
            <h2 className="text-xl font-semibold text-white">{data.event.title}</h2>
            <p className="mt-2 text-sm text-slate-300">{data.event.description}</p>
          </section>

          <section className="grid gap-4">
            {data.outcomeMetrics.map((metric) => (
              <article key={metric.marketId} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{metric.eventTitle}</div>
                    <div className="text-sm text-slate-400">
                      Outcome {metric.outcome} - {formatNumber(metric.totalHolders, 0)} holders
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-sky-300">{metric.price.toFixed(3)}</div>
                </div>

                {/* Enriched Holders Table */}
                {metric.enrichedHolders && metric.enrichedHolders.length > 0 && (
                  <div className="mt-4">
                    <EventHolders
                      holders={metric.enrichedHolders}
                      marketTitle={metric.eventTitle}
                    />
                  </div>
                )}

                {/* Orderbook Analytics */}
                {metric.orderBookAnalytics && (
                  <div className="mt-4">
                    <OrderBookPanel
                      tokenId={metric.orderBookAnalytics.tokenId}
                      marketTitle={metric.eventTitle}
                    />
                  </div>
                )}

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Top holders</div>
                    <div className="mt-3 space-y-2">
                      {metric.topHolders.slice(0, 5).map((holder) => (
                        <div key={holder.proxyWallet} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">
                              {holder.userDisplayName || holder.userUsername || holder.proxyWallet.slice(0, 8)}
                            </div>
                            <div className="text-xs text-slate-400">{holder.outcome}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Size {formatNumber(holder.size, 0)} - PnL {formatCurrency(holder.cashPnl)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Smart money holders</div>
                    <div className="mt-3 space-y-2">
                      {metric.smartMoneyHolders.slice(0, 5).map((holder) => (
                        <div key={holder.wallet} className="rounded-2xl border border-sky-400/15 bg-sky-400/5 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">
                              {holder.displayName || holder.username || holder.wallet.slice(0, 8)}
                            </div>
                            <div className="text-xs text-sky-300">{holder.smartMoneyScore}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {formatNumber(holder.position.size, 0)} shares at {holder.position.avgPrice.toFixed(3)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/20 backdrop-blur">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Signals</div>
            <div className="mt-4 grid gap-3">
              {data.smartMoneySignals.map((signal) => (
                <div key={`${signal.type}-${signal.timestamp}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{signal.type}</div>
                    <div className="text-xs text-slate-400">{(signal.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div className="mt-1 text-sm text-slate-300">{signal.description}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
