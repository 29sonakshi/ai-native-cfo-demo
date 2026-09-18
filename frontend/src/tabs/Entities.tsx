import { Building2, CalendarDays } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useFetch } from '../lib/api'
import type { EntitySnapshot, EntityTrend } from '../lib/api'
import { fmtMoney, fmtMonthLabel, fmtPct } from '../lib/format'
import { Card, ErrorNote, SectionTitle, Skeleton } from '../components/ui'

const ENTITY_COLORS: Record<string, string> = {
  'Meridian Bank': '#6366f1',
  'Northcrest Financial': '#2dd4bf',
  'Coral Pay': '#f87171',
}

function isRisk(e: EntitySnapshot) {
  return e.ebitda < 0 || e.free_cash_flow < 0
}

function EntityCard({ e }: { e: EntitySnapshot }) {
  const risk = isRisk(e)
  return (
    <Card className={`entity-card ${risk ? 'risk' : ''}`}>
      <div className="entity-head">
        <div>
          <div className="entity-name">{e.entity_name}</div>
          <div className="entity-geo">{e.geography} · founded {e.founded_year} · {e.employees.toLocaleString()} staff</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={`badge ${e.is_parent ? 'badge-parent' : 'badge-sub'}`}>{e.entity_type}</span>
          {e.acquired_date && (
            <span className="badge badge-acq"><CalendarDays size={11} /> acq {e.acquired_date}</span>
          )}
        </div>
      </div>
      <div>
        <div className="metric-row"><span>Net Revenue</span><span>{fmtMoney(e.net_revenue)}</span></div>
        <div className="metric-row"><span>Gross Margin</span><span style={{ color: e.gross_margin_pct < 0.5 ? 'var(--red)' : 'var(--text)' }}>{fmtPct(e.gross_margin_pct)}</span></div>
        <div className="metric-row"><span>EBITDA</span><span className={e.ebitda < 0 ? 'down' : 'up'}>{fmtMoney(e.ebitda, { signed: true })}</span></div>
        <div className="metric-row"><span>Free Cash Flow</span><span className={e.free_cash_flow < 0 ? 'down' : 'up'}>{fmtMoney(e.free_cash_flow, { signed: true })}</span></div>
        <div className="metric-row"><span>Cash Balance</span><span>{fmtMoney(e.cash_balance)}</span></div>
        {e.runway_months != null && (
          <div className="metric-row"><span>Runway</span><span className="down">{e.runway_months.toFixed(0)} months</span></div>
        )}
      </div>
      {risk && (
        <span className="badge badge-critical">At-risk: negative EBITDA / FCF</span>
      )}
    </Card>
  )
}

function MarginByEntity({ trend }: { trend: EntityTrend[] }) {
  // Pivot to wide format: { month, [entity_name]: gross_margin_pct }
  const byMonth: Record<string, any> = {}
  const names = new Set<string>()
  for (const r of trend) {
    names.add(r.entity_name)
    byMonth[r.month] = byMonth[r.month] || { month: r.month }
    byMonth[r.month][r.entity_name] = r.gross_margin_pct
  }
  const data = Object.values(byMonth).sort((a: any, b: any) => a.month.localeCompare(b.month))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(120,140,220,0.08)" vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonthLabel} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={30} />
        <YAxis tickFormatter={(v) => fmtPct(v, 0)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={46} domain={[0.3, 0.75]} />
        <Tooltip
          contentStyle={{ display: 'none' }}
          content={({ active, payload, label }: any) => active && payload?.length ? (
            <div className="tooltip-card">
              <div className="t-label">{fmtMonthLabel(label)}</div>
              {payload.map((p: any, i: number) => (
                <div className="t-row" key={i}><span style={{ color: p.color }}>{p.name}</span><strong>{fmtPct(p.value)}</strong></div>
              ))}
            </div>
          ) : null}
        />
        {[...names].map((n) => (
          <Line key={n} type="monotone" dataKey={n} name={n} stroke={ENTITY_COLORS[n] || '#94a3c8'} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function Entities() {
  const { data, loading, error } = useFetch(api.entities)
  return (
    <div className="grid" style={{ gap: 22 }}>
      <SectionTitle icon={<Building2 size={18} color="#6366f1" />}>Entity Performance — Meridian Bank Group</SectionTitle>
      {loading ? (
        <div className="grid grid-3">{[0, 1, 2].map((i) => <Card key={i}><Skeleton h={220} /></Card>)}</div>
      ) : error ? <ErrorNote msg={error} /> : data && (
        <>
          <div className="grid grid-3">
            {data.snapshot.map((e) => <EntityCard key={e.entity_id} e={e} />)}
          </div>
          <Card>
            <SectionTitle>Gross Margin by Entity Over Time</SectionTitle>
            <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
              {Object.entries(ENTITY_COLORS).map(([n, c]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-dim)' }}>
                  <span style={{ width: 12, height: 3, borderRadius: 2, background: c }} />{n}
                </div>
              ))}
            </div>
            <MarginByEntity trend={data.trend} />
          </Card>
        </>
      )}
    </div>
  )
}
