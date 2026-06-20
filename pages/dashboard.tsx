import { Head } from 'next/document';
import dynamic from 'next/dynamic'

const ScoutDashboard = dynamic(
  () => import('@/components/ScoutDashboard').then((mod) => mod.ScoutDashboard),
  { ssr: false }
)

export default function DashboardPage() {
  return (<>
  
  <ScoutDashboard />
  </>);
}
