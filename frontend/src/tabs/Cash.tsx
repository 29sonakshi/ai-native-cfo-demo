import { AlertTriangle, Banknote, Flame, TrendingDown, Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useFetch } from '../lib/api'
import type { CashResp } from '../lib/api'
import { fmtMoney, fmtMonthLabel } from '../lib/format'
import { Card, ErrorNote, KpiCard, KpiSkeletonRow, SectionTitle } from '../components/ui'

const ENTITY_COLORS: Record<string, string> = {
  'Meridian Bank': '#6366f1',
  'Northcrest Financial': '#2dd4bf',
  'Coral Pay': '#f87171',
}

function RunwayPanel({ data }: { data: CashResp }) {
  // Latest runway per entity (only those burning).
  const burning = data.snapshot.filter((s) => s.runway_months != null)
  // Build runway trend wide-format.
  const byMonth: Record<string, any> = {}
  const names = new Set<string>()
  for (const r of data.runway_trend) {
    names.add(r.entity_name)
    byMonth[r.month] = byMonth[r.month] || { month: r.month }
    byMonth[r.month][r.entity_name] = r.runway_months
  }
  const trend = Object.values(byMonth).sort((a: any, b: any) => a.month.localeCompare(b.month))

  return (
    <Card style={{ borderColor: burning.length ? 'rgba(248,113,113,0.35)' : undefined }}>
      <SectionTitle icon={<AlertTriangle size={17} color="#f87171" />}>Cash Runway — Critical Watch</SectionTitle>
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {data.snapshot.map((s) => {
          const critical = s.runway_months != null && s.runway_months <= 12
          return (
            <div key={s.entity_name} style={{
              padding: 16, borderRadius: 12,
              background: critical ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.07)',
              border: `1px solid ${critical ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.2)'}`,
            }}>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>{s.entity_name}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: critical ? 'var(--red)' : 'var(--emerald)' }}>
                {s.runway_months != null ? `${s.runway_months.toFixed(0)} mo` : 'Cash-positive'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
                {critical ? 'Burning cash — watch closely' : 'No burn'}
              </div>
            </div>
          )
        })}
      </div>
      {trend.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
            Runway trend (Coral Pay shrinking 18 → 10 months)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(120,140,220,0.08)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={fmtMonthLabel} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={26} />
              <YAxis tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}mo`} />
              <Tooltip content={({ active, payload, label }: any) => active && payload?.length ? (
                <div className="tooltip-card">
                  <div className="t-label">{fmtMonthLabel(label)}</div>
                  {payload.map((p: any, i: number) => (
                    <div className="t-row" key={i}><span style={{ color: p.color }}>{p.name}</span><strong>{p.value?.toFixed(0)} mo</strong></div>
                  ))}
                </div>
              ) : null} />
              {[...names].map((n) => (
                <Line key={n} type="monotone" dataKey={n} name={n} stroke={ENTITY_COLORS[n] || '#fbbf24'} strokeWidth={2.5} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Card>
  )
}

export function Cash() {
  const { data, loading, error } = useFetch(api.cash)
  return (
    <div className="grid" style={{ gap: 22 }}>
      <SectionTitle icon={<Banknote size={18} color="#2dd4bf" />}>Cash & Liquidity</SectionTitle>
      {loading ? <KpiSkeletonRow n={3} /> : error ? <ErrorNote msg={error} /> : data && (
        <>
          <div className="grid grid-3">
            <KpiCard label="Total Cash" value={fmtMoney(data.totals.cash_balance)} icon={<Wallet size={14} />} accent="#a5b4fc" sub="Consolidated across group" />
            <KpiCard label="Group Burn Rate" value={`${fmtMoney(data.totals.burn_rate)}/mo`} icon={<Flame size={14} />} accent="#fbbf24" deltaDir="down" delta="Monthly cash burn" sub="Concentrated in Coral Pay" />
            <KpiCard label="Group Free Cash Flow" value={fmtMoney(data.totals.free_cash_flow, { signed: true })} icon={<TrendingDown size={14} />}
              accent={data.totals.free_cash_flow >= 0 ? '#34d399' : '#f87171'} deltaDir={data.totals.free_cash_flow >= 0 ? 'up' : 'down'}
              delta={data.totals.free_cash_flow >= 0 ? 'Net positive' : 'Net negative'} />
          </div>

          <Card>
            <SectionTitle icon={<Wallet size={17} color="#6366f1" />}>Cash Balance by Entity</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.snapshot} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} layout="vertical">
                <CartesianGrid stroke="rgba(120,140,220,0.08)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtMoney(v)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="entity_name" tick={{ fill: '#94a3c8', fontSize: 12 }} axisLine={false} tickLine={false} width={140} />
                <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
                  <div className="tooltip-card"><div className="t-label">{payload[0].payload.entity_name}</div>
                    <div className="t-row"><span>Cash</span><strong>{fmtMoney(payload[0].value)}</strong></div></div>
                ) : null} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                <Bar dataKey="cash_balance" radius={[0, 6, 6, 0]} maxBarSize={44}>
                  {data.snapshot.map((s, i) => <Cell key={i} fill={ENTITY_COLORS[s.entity_name] || '#6366f1'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <RunwayPanel data={data} />
        </>
      )}
    </div>
  )
}
