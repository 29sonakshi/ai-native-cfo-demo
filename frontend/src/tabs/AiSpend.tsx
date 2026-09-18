import { AlertTriangle, Boxes, Coins, Gauge, Layers, Network, Percent, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, useFetch } from '../lib/api'
import type { AiEntityRow } from '../lib/api'
import { fmtMoney, fmtMonthLabel, fmtPct } from '../lib/format'
import { Card, ErrorNote, KpiCard, KpiSkeletonRow, SectionTitle, Skeleton } from '../components/ui'

const GRID = 'rgba(15,23,42,0.06)'
const AXIS = '#64748b'
const AXIS_FAINT = '#94a3b8'
const INDIGO = '#4f46e5'
const SLATE = '#94a3b8'
const RED = '#dc2626'

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: '#d97706',
  OpenAI: '#0d9488',
  Google: '#4f46e5',
  'Z.ai': '#059669',
}
const TIER_COLORS: Record<string, string> = { Frontier: '#4f46e5', 'Open-weight': '#0d9488' }

function pctStr(n: number, d = 0) { return `${n.toFixed(d)}%` }

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

function DonutTooltip({ active, payload, fmt }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="tooltip-card">
      <div className="t-label">{p.name}</div>
      <div className="t-row"><span>Spend</span><strong>{fmt(p.value)}</strong></div>
    </div>
  )
}

function budgetColor(e: AiEntityRow) {
  return e.budget_util_pct > 1 ? RED : INDIGO
}

/**
 * AI Spend — a diagnostic, even-handed AI cost overview for the CFO.
 * Group totals first, then all three entities side by side. Coral Pay stands
 * out on its own (highest AI-%-of-revenue, over budget) — but the tab makes no
 * recommendation and names no culprit. The team-level drill, the runaway model,
 * the routing lever and the fix all live in Genie One (the CFO Q&A tab), so the
 * dashboard diagnoses and Genie prescribes.
 */
export function AiSpend() {
  const overview = useFetch(api.aiOverview)
  const trend = useFetch(api.aiTrend)
  const providers = useFetch(api.aiProviders)

  const t = overview.data?.totals
  const runPct = t ? Math.round(t.run_pct * 100) : 0
  const changePct = 100 - runPct

  // AI as % of revenue by entity — the anomaly, one bar towering over the rest.
  const pctRevBars = (overview.data?.by_entity ?? [])
    .map((e) => ({ name: e.entity_name, pct: e.ai_pct_revenue, isCoral: e.entity_id === 'ENT03' }))
    .sort((a, b) => b.pct - a.pct)

  // Actual vs budget by entity.
  const entityBudgetBars = (overview.data?.by_entity ?? []).map((e) => ({
    name: e.entity_name, actual: e.ai_spend_usd, budget: e.ai_budget_usd, _e: e,
  }))

  const frontier = providers.data?.tier_split.find((s) => s.tier === 'Frontier')?.pct ?? 0
  const openw = providers.data?.tier_split.find((s) => s.tier === 'Open-weight')?.pct ?? 0

  return (
    <div className="grid" style={{ gap: 22 }}>
      <SectionTitle icon={<Coins size={18} color={INDIGO} />}>AI Spend — what the group spends on AI, by entity and model</SectionTitle>

      {/* Group KPI row */}
      {overview.loading ? <KpiSkeletonRow /> : overview.error ? <ErrorNote msg={overview.error} /> : t && (
        <div className="grid grid-4">
          <KpiCard label="Group AI Spend (MTD)" value={fmtMoney(t.ai_spend_usd)} icon={<Coins size={14} />}
            delta="all entities" sub={overview.data ? fmtMonthLabel(overview.data.latest_month) : ''} accent={INDIGO} />
          <KpiCard label="AI as % of Revenue" value={fmtPct(t.ai_pct_revenue, 1)} icon={<Percent size={14} />}
            delta="group blended" sub={`${fmtPct(t.ai_pct_opex, 1)} of opex`} accent="#0d9488" />
          <KpiCard label="Budget Utilization" value={fmtPct(t.budget_util_pct, 0)} icon={<Gauge size={14} />}
            delta={t.budget_util_pct > 1 ? 'Over plan' : 'Within plan'} deltaDir={t.budget_util_pct > 1 ? 'down' : 'up'}
            sub="group vs plan" accent={t.budget_util_pct > 1 ? '#d97706' : '#059669'} />
          <KpiCard label="Frontier vs Open-weight" value={`${Math.round(frontier)} / ${Math.round(openw)}`} icon={<Layers size={14} />}
            delta="share of group spend" sub="premium vs open-weight models" accent="#d97706" />
        </div>
      )}

      {/* All-entity comparison: the anomaly + actual vs budget */}
      <div className="grid grid-2">
        <Card>
          <SectionTitle icon={<Percent size={17} color={INDIGO} />}>AI as % of revenue — by entity</SectionTitle>
          {overview.loading ? <Skeleton h={260} /> : pctRevBars.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pctRevBars} margin={{ top: 20, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fill: AXIS_FAINT, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip fmt={(v: number) => fmtPct(v, 2)} />} cursor={{ fill: 'rgba(79,70,229,0.05)' }} />
                <Bar dataKey="pct" name="AI % of revenue" radius={[5, 5, 0, 0]} maxBarSize={80} isAnimationActive={false}>
                  {pctRevBars.map((b, i) => <Cell key={i} fill={b.isCoral ? RED : SLATE} />)}
                  <LabelList dataKey="pct" position="top" formatter={(v: any) => fmtPct(Number(v), Number(v) > 0.05 ? 1 : 2)} style={{ fill: AXIS, fontSize: 12, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="fs-caption" style={{ marginTop: 8 }}>
            Most entities spend well under 1% of revenue on AI. One does not.
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<Coins size={17} color={INDIGO} />}>AI spend by entity — actual vs budget</SectionTitle>
          {overview.loading ? <Skeleton h={260} /> : entityBudgetBars.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={entityBudgetBars} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: AXIS_FAINT, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<ChartTooltip fmt={fmtMoney} />} cursor={{ fill: 'rgba(79,70,229,0.05)' }} />
                <Bar dataKey="budget" name="Budget" fill="#cbd5e1" radius={[5, 5, 0, 0]} maxBarSize={54} isAnimationActive={false} />
                <Bar dataKey="actual" name="Actual" radius={[5, 5, 0, 0]} maxBarSize={54} isAnimationActive={false}>
                  {entityBudgetBars.map((e, i) => <Cell key={i} fill={budgetColor(e._e)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="fs-caption" style={{ marginTop: 8 }}>
            Two entities sit under plan (indigo); one is well over (red).
          </div>
        </Card>
      </div>

      {/* Provider & tier mix (group) */}
      {providers.loading ? <Skeleton h={280} /> : providers.error ? <ErrorNote msg={providers.error} /> : providers.data && (
        <>
          <div className="grid grid-2">
            <Card>
              <SectionTitle icon={<Network size={17} color={INDIGO} />}>Spend by provider — group</SectionTitle>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={providers.data.group_mix} dataKey="spend_usd" nameKey="provider" cx="50%" cy="50%"
                    innerRadius={66} outerRadius={104} paddingAngle={2} isAnimationActive={false}
                    label={(p: any) => `${p.provider} ${p.pct_of_group.toFixed(0)}%`}
                    labelLine={false} stroke="#fff" strokeWidth={2}>
                    {providers.data.group_mix.map((p, i) => <Cell key={i} fill={PROVIDER_COLORS[p.provider] || '#94a3b8'} />)}
                  </Pie>
                  <Tooltip content={<DonutTooltip fmt={fmtMoney} />} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <SectionTitle icon={<Layers size={17} color="#0d9488" />}>Frontier vs open-weight — group</SectionTitle>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={providers.data.tier_split} dataKey="spend_usd" nameKey="tier" cx="50%" cy="50%"
                    innerRadius={66} outerRadius={104} paddingAngle={2} isAnimationActive={false}
                    label={(p: any) => `${p.tier} ${p.pct.toFixed(0)}%`}
                    labelLine={false} stroke="#fff" strokeWidth={2}>
                    {providers.data.tier_split.map((s, i) => <Cell key={i} fill={TIER_COLORS[s.tier] || '#94a3b8'} />)}
                  </Pie>
                  <Tooltip content={<DonutTooltip fmt={fmtMoney} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="fs-caption" style={{ marginTop: 6 }}>
                Premium frontier models do the heavy lifting — but not every task needs one.
              </div>
            </Card>
          </div>

          {/* AI % of revenue trend (group) */}
          <Card>
            <SectionTitle icon={<TrendingUp size={17} color="#0d9488" />}>Group AI spend as % of revenue — over time</SectionTitle>
            {trend.loading ? <Skeleton h={220} /> : trend.error ? <ErrorNote msg={trend.error} /> : trend.data && (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tickFormatter={fmtMonthLabel} tick={{ fill: AXIS_FAINT, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} tick={{ fill: AXIS_FAINT, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                  <Tooltip content={<ChartTooltip fmt={(v: number) => fmtPct(v, 2)} />} labelFormatter={fmtMonthLabel as any} />
                  <Line type="monotone" dataKey="ai_pct_revenue" name="AI % of revenue" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Provider concentration by entity */}
          <Card>
            <SectionTitle icon={<AlertTriangle size={17} color="#d97706" />}>Provider concentration — by entity</SectionTitle>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Entity</th><th>Dominant provider</th>
                    <th style={{ textAlign: 'right' }}>% on one provider</th>
                    <th style={{ textAlign: 'right' }}>Total AI spend</th>
                    <th>Concentration</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.data.concentration.map((c) => {
                    const high = c.top_pct >= 60
                    return (
                      <tr key={c.entity_id}>
                        <td style={{ fontWeight: 600 }}>{c.entity_name}</td>
                        <td>{c.top_provider}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: high ? 'var(--red)' : 'var(--text)' }}>{pctStr(c.top_pct, 0)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(c.total_spend_usd)}</td>
                        <td><span className={`badge ${high ? 'badge-critical' : 'badge-ok'}`}>{high ? 'HIGH' : 'OK'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="fs-caption" style={{ marginTop: 10 }}>
              How much of each entity's AI spend rides on a single provider — a cost and availability risk worth watching.
            </div>
          </Card>

          {/* Model breakdown (group) */}
          <Card>
            <SectionTitle icon={<Boxes size={17} color={INDIGO} />}>Model breakdown — group, latest month</SectionTitle>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Model</th><th>Provider</th><th>Tier</th>
                    <th style={{ textAlign: 'right' }}>Spend</th>
                    <th style={{ textAlign: 'right' }}>% of group</th>
                    <th style={{ textAlign: 'right' }}>Requests</th>
                    <th style={{ textAlign: 'right' }}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.data.models.map((m) => (
                    <tr key={m.model}>
                      <td style={{ fontWeight: 600 }}>{m.model}</td>
                      <td>{m.provider}</td>
                      <td><span className={`badge ${m.tier === 'Frontier' ? 'badge-parent' : 'badge-sub'}`}>{m.tier}</span></td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(m.spend_usd)}</td>
                      <td style={{ textAlign: 'right' }}>{pctStr(m.pct_of_group, 1)}</td>
                      <td style={{ textAlign: 'right' }}>{m.request_count.toLocaleString('en-US')}</td>
                      <td style={{ textAlign: 'right' }}>{m.total_tokens.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fs-caption" style={{ marginTop: 10 }}>
              Spend, request volume and tokens per model — straight from the AI Gateway usage logs. Ask Genie in the next tab to dig into who's driving it.
            </div>
          </Card>

          {/* Run vs change */}
          {t && (
            <Card>
              <SectionTitle icon={<Layers size={17} color="#d97706" />}>Run the bank vs change the bank</SectionTitle>
              <div style={{ display: 'flex', height: 42, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--card-border)' }}>
                <div style={{ width: `${runPct}%`, background: '#64748b', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                  Run {runPct}%
                </div>
                <div style={{ width: `${changePct}%`, background: 'linear-gradient(135deg,#4f46e5,#14b8a6)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                  Change {changePct}%
                </div>
              </div>
              <div className="grid grid-2" style={{ marginTop: 16 }}>
                <div className="metric-row"><span>Run the bank (keep lights on)</span><span>{fmtMoney(t.run_spend_usd)}</span></div>
                <div className="metric-row"><span>Change the bank (transform)</span><span>{fmtMoney(t.change_spend_usd)}</span></div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
