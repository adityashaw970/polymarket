import type { NextApiRequest, NextApiResponse } from 'next'
import { polymarketAPI } from '../../../polymarket-api'
import { createErrorResponse, createSuccessResponse } from '../../../utils'
import { APIResponse } from '../../../types'

interface EventBrowseItem {
  slug: string
  title: string
  active: boolean
  closed: boolean
  volume24hr: number
  volumeAll: number
  liquidity: number
  endDate: string
  analysisUrl: string
  marketCount: number
}

interface BrowseResponse {
  events: EventBrowseItem[]
  total: number
  hint: string
}

/**
 * GET /api/events/browse
 *
 * Returns a list of events with their correct slugs so you can find the right
 * slug to use with /api/events/[eventSlug]/analysis.
 *
 * Query params:
 *   limit   = number of events to return (default 20, max 100)
 *   offset  = pagination offset (default 0)
 *   active  = "true" | "false" | omit for all
 *   q       = keyword filter (client-side, filters by title/slug)
 *   orderBy = "volume" | "liquidity" | "volumeAll" (default: volumeAll)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<APIResponse<BrowseResponse>>
) {
  if (req.method !== 'GET') {
    return res.status(405).json(createErrorResponse('Method not allowed'))
  }

  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt((req.query.limit as string) || '20', 10)))
    const offset = Math.max(0, Number.parseInt((req.query.offset as string) || '0', 10))
    const orderBy = (['volume', 'liquidity', 'volumeAll'].includes(req.query.orderBy as string)
      ? req.query.orderBy
      : 'volumeAll') as 'volume' | 'liquidity' | 'volumeAll'
    const keyword = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : ''

    // Build active/closed filter
    let activeFilter: boolean | undefined
    if (req.query.active === 'true') activeFilter = true
    else if (req.query.active === 'false') activeFilter = false
    // Default: only show non-closed events unless explicitly requested
    const showClosed = req.query.active === 'false' || req.query.closed === 'true'

    // Fetch more than requested to allow client-side keyword filtering
    const fetchLimit = keyword ? Math.min(200, limit * 10) : Math.min(200, limit * 4)

    const { events } = await polymarketAPI.getEvents({
      limit: fetchLimit,
      offset: keyword ? 0 : offset,
      active: activeFilter ?? true,
      closed: showClosed ? undefined : false,
      orderBy,
      ascending: false,
    })

    // Client-side filters: remove closed events unless requested, and apply keyword
    const filtered = events
      .filter(e => showClosed || !e.closed)
      .filter(e =>
        !keyword ||
        e.slug.toLowerCase().includes(keyword) ||
        e.title.toLowerCase().includes(keyword) ||
        e.description.toLowerCase().includes(keyword)
      )

    // Paginate after filtering
    const paginated = keyword ? filtered.slice(offset, offset + limit) : filtered

    const browseItems: EventBrowseItem[] = paginated.map(e => ({
      slug: e.slug,
      title: e.title,
      active: e.active,
      closed: e.closed,
      volume24hr: e.volume24hr,
      volumeAll: e.volumeAll,
      liquidity: e.liquidity,
      endDate: e.endDate,
      analysisUrl: `/api/events/${e.slug}/analysis`,
      marketCount: e.groupedMarkets?.length ?? 0,
    }))

    return res.status(200).json(
      createSuccessResponse({
        events: browseItems,
        total: filtered.length,
        hint: 'Use the "slug" field in /api/events/{slug}/analysis to analyze a specific event. Use ?q=bitcoin to search by keyword.',
      })
    )
  } catch (error) {
    console.error('Browse events error:', error)
    return res.status(500).json(
      createErrorResponse(error instanceof Error ? error.message : 'Internal server error')
    )
  }
}
