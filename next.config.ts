/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Connection keep-alive for faster repeated API fetches
  httpAgentOptions: {
    keepAlive: true,
  },

  headers: async () => [
    // Leaderboard: expensive computation — serve stale while revalidating in background
    {
      source: '/api/leaderboard',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=600' },
      ],
    },
    // Live orderbook: near-real-time, 10 s freshness
    {
      source: '/api/live-orderbook',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=10, stale-while-revalidate=20' },
      ],
    },
    // Single-token orderbook analytics
    {
      source: '/api/orderbook',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=30, stale-while-revalidate=60' },
      ],
    },
    // Trader detail: 2-min cache
    {
      source: '/api/traders/:wallet',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=120, stale-while-revalidate=240' },
      ],
    },
    // Everything else: 60 s
    {
      source: '/api/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=120' },
      ],
    },
  ],
}

module.exports = nextConfig

