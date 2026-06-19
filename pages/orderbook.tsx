import dynamic from 'next/dynamic'
import Head from 'next/head'

const OrderbookDashboard = dynamic(
  () => import('@/components/OrderbookDashboard').then(m => m.OrderbookDashboard),
  { ssr: false }
)

export default function OrderbookPage() {
  return (
    <>
      <Head>
        <title>Real-Time Orderbook Analytics | Polymarket</title>
        <meta
          name="description"
          content="Live L2/L3 orderbook analytics for any Polymarket event — bid/ask imbalance, whale activity, spoofing detection, slippage, volatility and more."
        />
      </Head>
      <OrderbookDashboard />
    </>
  )
}
