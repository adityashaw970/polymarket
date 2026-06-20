import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../polymarket-api'
import { createSuccessResponse, createErrorResponse } from '../../utils'
import { APIResponse, GammaEvent } from '../../types'

interface SearchResult {
  slug: string
  title: string
  description: string
  active: boolean
  closed: boolean
  volume24hr: number
  volumeAll: number
  liquidity: number
  endDate: string
  marketCount: number
  tags: string[]
  analysisUrl: string
  orderbookUrl: string
  hint: string
}

interface SearchResponse {
  query: string
  total: number
  results: SearchResult[]
  tip: string
}

function dedupeEvents(events: GammaEvent[]): GammaEvent[] {
  const seen = new Set<string>()
  return events.filter(e => {
    if (seen.has(e.slug)) return false
    seen.add(e.slug)
    return true
  })
}

/**
 * GET /api/search?q=<query>
 *
 * Universal search endpoint. Accepts any keyword, team name, topic, or slug
 * and returns matching Polymarket events with their analysis and orderbook URLs.
 *
 * Query parameters:
 *   q        = search query (required) — e.g. "bitcoin", "US election", "Giants"
 *   limit    = max results (default 10, max 50)
 *   active   = "true" | "false" | omit for all
 *   category = "sports" | "politics" | "crypto" | "all" (optional filter)
 *
 * Examples:
 *   /api/search?q=san francisco giants
 *   /api/search?q=bitcoin price
 *   /api/search?q=US election 2024
 *   /api/search?q=world cup&category=sports
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<SearchResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) {
    return res.status(400).json(
      createErrorResponse('Missing ?q= parameter. Example: /api/search?q=bitcoin')
    )
  }

  const limit = Math.min(50, Math.max(1, Number.parseInt((req.query.limit as string) || '10', 10)))
  const activeFilter =
    req.query.active === 'true' ? true :
    req.query.active === 'false' ? false :
    undefined

  const kw = q.toLowerCase()

  try {
    // ── Multi-strategy search ──────────────────────────────────────────────

    // Strategy 1: exact slug match
    // Strategy 2: broad active events fetched then keyword-filtered
    const [bySlug, byActive, byClosed] = await Promise.allSettled([
      polymarketAPI.getEvents({ slug: q.replace(/\s+/g, '-').toLowerCase(), limit: 5 }),
      polymarketAPI.getEvents({
        limit: 200,
        active: activeFilter ?? true,
        closed: activeFilter === false,
        orderBy: 'volumeAll',
        ascending: false,
      }),
      // Also search closed markets if user didn't filter
      activeFilter === undefined
        ? polymarketAPI.getEvents({
            limit: 100,
            active: false,
            closed: true,
            orderBy: 'volumeAll',
            ascending: false,
          })
        : Promise.resolve({ events: [], count: 0 }),
    ])

    const candidates: GammaEvent[] = []

    if (bySlug.status === 'fulfilled') {
      candidates.push(...bySlug.value.events)
    }

    // Keyword filter on both active and closed
    const allBrowsed: GammaEvent[] = []
    if (byActive.status === 'fulfilled') allBrowsed.push(...byActive.value.events)
    if (byClosed.status === 'fulfilled') allBrowsed.push(...byClosed.value.events)

    // Score each event by keyword relevance
    const scored = allBrowsed
      .map(e => {
        let score = 0
        const slug = e.slug.toLowerCase()
        const title = e.title.toLowerCase()
        const desc = (e.description ?? '').toLowerCase()

        // Exact slug match = highest score
        if (slug === kw || slug === kw.replace(/\s+/g, '-')) score += 100
        // Title starts with query = very high
        if (title.startsWith(kw)) score += 80
        // Slug or title contains full query
        if (slug.includes(kw.replace(/\s+/g, '-')) || slug.includes(kw)) score += 60
        if (title.includes(kw)) score += 50
        // Individual word matches
        const words = kw.split(/\s+/).filter(w => w.length > 2)
        for (const word of words) {
          if (slug.includes(word)) score += 15
          if (title.includes(word)) score += 12
          if (desc.includes(word)) score += 5
        }
        // Tag matches
        for (const tag of e.tags) {
          if (typeof tag === 'string' && tag.toLowerCase().includes(kw)) score += 20
        }

        return { event: e, score }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ event }) => event)

    candidates.push(...scored)

    const unique = dedupeEvents(candidates).slice(0, limit)

    if (unique.length === 0) {
      return res.status(200).json(
        createSuccessResponse({
          query: q,
          total: 0,
          results: [],
          tip:
            `No events found for "${q}". Try broader terms or use ` +
            `/api/events/browse to see all active events.`,
        })
      )
    }

    const results: SearchResult[] = unique.map(e => ({
      slug: e.slug,
      title: e.title,
      description: (e.description ?? '').slice(0, 200) + ((e.description ?? '').length > 200 ? '…' : ''),
      active: e.active,
      closed: e.closed,
      volume24hr: e.volume24hr,
      volumeAll: e.volumeAll,
      liquidity: e.liquidity,
      endDate: e.endDate,
      marketCount: e.groupedMarkets?.length ?? 0,
      tags: e.tags.map(t => (typeof t === 'string' ? t : String(t))),
      analysisUrl: `/api/events/${e.slug}/analysis`,
      orderbookUrl: `/api/events/${e.slug}/orderbook`,
      hint: `Use the analysis URL for smart-money + holder analytics, orderbook URL for L2/L3 book data`,
    }))

    return res.status(200).json(
      createSuccessResponse({
        query: q,
        total: unique.length,
        results,
        tip:
          `Found ${unique.length} event(s) for "${q}". ` +
          `Use the "analysisUrl" for full smart-money analysis, or "orderbookUrl" for ` +
          `real-time L2/L3 orderbook analytics (bid/ask imbalance, whale activity, slippage, etc.).`,
      })
    )
  } catch (error) {
    console.error('[search] Error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
