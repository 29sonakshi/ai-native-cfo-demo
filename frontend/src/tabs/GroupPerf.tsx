import { Activity, BarChart3, DollarSign, Flame, Percent, TrendingUp, Wallet } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useFetch } from '../lib/api'
import { fmtMoney, fmtMonthLabel, fmtPct } from '../lib/format'
import { FinancialSummary } from '../components/FinancialSummary'
import { Synthesizer } from '../components/Synthesizer'
import { Card, ErrorNote, KpiCard, KpiSkeletonRow, SectionTitle, Skeleton } from '../components/ui'

const GEO_COLORS: Record<string, string> = { US: '#6366f1', Canada: '#2dd4bf', Australia: '#fbbf24' }

function ChartTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-card">
      <div className="t-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div className="t-row" key={i}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{fmt ? fmt(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

export function GroupPerf() {
  const summary = useFetch(api.summary)
  const kpis = useFetch(api.kpis)
  const synthesis = useFetch(api.synthesis)
  const entities = useFetch(api.entities)
  const trends = useFetch(api.trends)
  const geo = useFetch(api.geo)

  return (
    <div className="grid" style={{ gap: 22 }}>
      {/* KPI row (top of tab) */}
      {kpis.loading ? <KpiSkeletonRow /> : kpis.error ? <ErrorNote msg={kpis.error} /> : kpis.data && (
        <div className="grid grid-4">
          <KpiCard label="ARR" value={fmtMoney(kpis.data.arr)} icon={<TrendingUp size={14} />}
            delta="Annual recurring revenue" sub={`As of ${fmtMonthLabel(kpis.data.latest_month)}`} accent="#a5b4fc" />
          <KpiCard label="Gross Margin" value={fmtPct(kpis.data.gross_margin_pct)} icon={<Percent size={14} />}
            delta="Consolidated" deltaDir="up" sub="SUM(gross profit) / SUM(net revenue)" accent="#2dd4bf" />
          <KpiCard label="Burn Rate" value={`${fmtMoney(kpis.data.burn_rate)}/mo`} icon={<Flame size={14} />}
            delta="Group cash burn" deltaDir="down" sub="Driven by Coral Pay" accent="#fbbf24" />
          <KpiCard label="Free Cash Flow" value={fmtMoney(kpis.data.free_cash_flow, { signed: true })} icon={<Activity size={14} />}
            delta={kpis.data.free_cash_flow >= 0 ? 'Group positive' : 'Group negative'}
            deltaDir={kpis.data.free_cash_flow >= 0 ? 'up' : 'down'} sub="Net of all entities"
            accent={kpis.data.free_cash_flow >= 0 ? '#34d399' : '#f87171'} />
        </div>
      )}
      {kpis.data && (
        <div className="grid grid-2">
          <KpiCard label="Net Revenue (mo)" value={fmtMoney(kpis.data.net_revenue)} icon={<DollarSign size={14} />}
            sub={`Gross GMV ${fmtMoney(kpis.data.gross_gmv)} this month`} />
          <KpiCard label="Cash Position" value={fmtMoney(kpis.data.cash_balance)} icon={<Wallet size={14} />}
            sub="Consolidated cash & equivalents" accent="#a5b4fc" />
        </div>
      )}

      {/* AI synthesis + financial summary, side by side on wide screens */}
      <div className="gp-split">
        <Synthesizer s={synthesis} />
        <FinancialSummary s={summary} compact />
      </div>

      {/* EBITDA by entity — who's profitable, who's burning */}
      <Card>
        <SectionTitle icon={<BarChart3 size={17} color="#2dd4bf" />}>EBITDA by Entity — who's profitable, who's burning</SectionTitle>
        {entities.loading ? <Skeleton h={340} /> : entities.error ? <ErrorNote msg={entities.error} /> : entities.data && (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={entities.data.snapshot} margin={{ top: 28, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="rgba(120,140,220,0.08)" vertical={false} />
              <XAxis dataKey="entity_name" tick={{ fill: '#94a3c8', fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
              <Tooltip content={<ChartTooltip fmt={(v: number) => fmtMoney(v, { signed: true })} />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <ReferenceLine y={0} stroke="rgba(148,163,184,0.45)" />
              <Bar dataKey="ebitda" name="EBITDA" radius={[6, 6, 0, 0]} maxBarSize={130} isAnimationActive={false}>
                {entities.data.snapshot.map((e, i) => <Cell key={i} fill={e.ebitda >= 0 ? '#34d399' : '#f87171'} />)}
                <LabelList dataKey="ebitda" position="top" formatter={(v: any) => fmtMoney(Number(v), { signed: true })} fill="#cbd5e1" fontSize={12.5} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid grid-2">
        {/* Net revenue trend */}
        <Card>
          <SectionTitle icon={<TrendingUp size={17} color="#6366f1" />}>Net Revenue Trend</SectionTitle>
          {trends.loading ? <Skeleton h={260} /> : trends.error ? <ErrorNote msg={trends.error} /> : trends.data && (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trends.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(120,140,220,0.08)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fmtMonthLabel} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<ChartTooltip fmt={fmtMoney} />} labelFormatter={fmtMonthLabel as any} />
                <Area type="monotone" dataKey="net_revenue" name="Net Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#nr)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Geo rollup */}
        <Card>
          <SectionTitle icon={<Activity size={17} color="#2dd4bf" />}>Net Revenue by Geography</SectionTitle>
          {geo.loading ? <Skeleton h={260} /> : geo.error ? <ErrorNote msg={geo.error} /> : geo.data && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={geo.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(120,140,220,0.08)" vertical={false} />
                <XAxis dataKey="geography" tick={{ fill: '#94a3c8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<ChartTooltip fmt={fmtMoney} />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                <Bar dataKey="net_revenue" name="Net Revenue" radius={[6, 6, 0, 0]} maxBarSize={90}>
                  {geo.data.map((g, i) => <Cell key={i} fill={GEO_COLORS[g.geography] || '#6366f1'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  )
}
