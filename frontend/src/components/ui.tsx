import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>
}

export function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <h2 className="section-title">{icon}{children}</h2>
}

export function KpiCard({
  label, value, delta, deltaDir, sub, icon, accent,
}: {
  label: string; value: string; delta?: string; deltaDir?: 'up' | 'down'; sub?: string; icon?: ReactNode; accent?: string
}) {
  return (
    <Card className="kpi">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {delta && (
        <div className={`kpi-delta ${deltaDir}`}>
          {deltaDir === 'up' ? <ArrowUpRight size={15} /> : deltaDir === 'down' ? <ArrowDownRight size={15} /> : null}
          {delta}
        </div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </Card>
  )
}

export function Skeleton({ h = 80 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h, width: '100%' }} />
}

export function KpiSkeletonRow({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-4">
      {Array.from({ length: n }).map((_, i) => (
        <Card key={i}><Skeleton h={64} /></Card>
      ))}
    </div>
  )
}

export function ErrorNote({ msg }: { msg: string }) {
  return <Card style={{ borderColor: 'rgba(248,113,113,0.4)' }}><div style={{ color: 'var(--red)' }}>Failed to load: {msg}</div></Card>
}
