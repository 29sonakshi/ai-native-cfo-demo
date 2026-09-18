import { ArrowDownRight, ArrowUpRight, Table2 } from 'lucide-react'
import type { SummaryEntityRow, SummaryLine, SummaryResp, SummaryUnit, FavorableWhen } from '../lib/api'
import { fmtMoney, fmtMonthLabel, fmtPct } from '../lib/format'
import { Card, ErrorNote, SectionTitle, Skeleton } from './ui'

// Which line items begin a visual section (faint divider + label feel).
const SECTION_STARTS: Record<string, string> = {
  'Gross GMV': 'Revenue Bridge',
  'Net Revenue': 'P&L',
  'Free Cash Flow': 'Cash',
}
const KEY_LINES = new Set(['Net Revenue', 'Gross Profit', 'EBITDA'])
const ENTITY_KEY_LINES = ['Net Revenue', 'Gross Profit', 'Gross Margin %', 'EBITDA', 'ARR', 'Free Cash Flow', 'Burn Rate', 'Cash Balance']

function fmtVal(v: number | null, unit: SummaryUnit): string {
  if (v === null || v === undefined) return '—'
  return unit === 'pct' ? fmtPct(v) : fmtMoney(v)
}

// Render a MoM/YoY delta, colored by favorable_when (not just by sign).
function Delta({ value, unit, fav }: { value: number | null; unit: SummaryUnit; fav: FavorableWhen }) {
  if (value === null || value === undefined || isNaN(value)) return <span className="delta-na">—</span>
  const up = value > 0
  const favorable = fav === 'up' ? up : !up
  // pp delta for percentage rows; otherwise a percent-of-base change.
  const text = unit === 'pct'
    ? `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`
    : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
  return (
    <span className={`fs-delta ${favorable ? 'good' : 'bad'}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {text}
    </span>
  )
}

function GroupTable({ rows }: { rows: SummaryLine[] }) {
  return (
    <div className="fs-scroll">
      <table className="fs-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Latest</th>
            <th className="num">Prior Mo</th>
            <th className="num">MoM</th>
            <th className="num">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const section = SECTION_STARTS[r.metric]
            const key = KEY_LINES.has(r.metric)
            return (
              <tr key={r.metric} className={`${section ? 'fs-section-start' : ''} ${key ? 'fs-key' : ''}`}>
                <td className="fs-metric">
                  {section && <span className="fs-section-tag">{section}</span>}
                  {r.metric}
                </td>
                <td className="num strong">{fmtVal(r.current, r.unit)}</td>
                <td className="num dim">{fmtVal(r.prior, r.unit)}</td>
                <td className="num"><Delta value={r.mom_pct} unit={r.unit} fav={r.favorable_when} /></td>
                <td className="num"><Delta value={r.yoy_pct} unit={r.unit} fav={r.favorable_when} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EntityTable({ data }: { data: SummaryResp['by_entity'] }) {
  const rowMap: Record<string, SummaryEntityRow> = {}
  for (const r of data.rows) rowMap[r.metric] = r
  return (
    <div className="fs-scroll">
      <table className="fs-table fs-entity">
        <thead>
          <tr>
            <th>Metric</th>
            {data.entities.map((e) => <th key={e.entity_id} className="num">{e.entity_name}</th>)}
          </tr>
        </thead>
        <tbody>
          {ENTITY_KEY_LINES.map((metric) => {
            const row = rowMap[metric]
            if (!row) return null
            const key = KEY_LINES.has(metric)
            return (
              <tr key={metric} className={key ? 'fs-key' : ''}>
                <td className="fs-metric">{metric}</td>
                {data.entities.map((e) => {
                  const v = row.values[e.entity_id]
                  const mom = row.mom[e.entity_id]
                  const negative = typeof v === 'number' && v < 0
                  return (
                    <td key={e.entity_id} className="num">
                      <div className={`fs-cell-val ${negative ? 'neg' : ''}`}>{fmtVal(v ?? null, row.unit)}</div>
                      <div className="fs-cell-mom"><Delta value={mom ?? null} unit={row.unit} fav={row.favorable_when} /></div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function FinancialSummary({ s, compact }: { s: { data: SummaryResp | null; loading: boolean; error: string | null }; compact?: boolean }) {
  return (
    <Card>
      <SectionTitle icon={<Table2 size={17} color="#2dd4bf" />}>
        Financial Summary — Group{s.data ? ` (${fmtMonthLabel(s.data.latest_month)})` : ''}
      </SectionTitle>
      <div className="fs-caption">MoM = vs prior month · YoY = vs same month last year · Gross Margin shown in percentage points (pp)</div>
      {s.loading ? (
        <Skeleton h={420} />
      ) : s.error ? (
        <ErrorNote msg={s.error} />
      ) : s.data ? (
        <div className={`fs-layout${compact ? ' fs-layout-stacked' : ''}`}>
          <div className="fs-block">
            <div className="fs-block-title">Group rollup</div>
            <GroupTable rows={s.data.group} />
          </div>
          <div className="fs-block">
            <div className="fs-block-title">By entity (latest, with MoM)</div>
            <EntityTable data={s.data.by_entity} />
          </div>
        </div>
      ) : null}
    </Card>
  )
}
