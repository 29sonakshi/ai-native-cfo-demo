import { Bar, BarChart, Cell, Customized, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RevenueBridge } from '../lib/api'
import { fmtMoney } from '../lib/format'

interface Step {
  label: string
  base: number      // transparent offset
  value: number     // visible bar height (absolute)
  signed: number    // actual signed contribution (for tooltip + label)
  top: number       // running total at the TOP of this bar (for connectors)
  bottom: number    // running total at the BOTTOM of this bar (for connectors)
  pct: number       // share of gross GMV (signed: negative for deductions)
  kind: 'total' | 'down'
}

// Build floating-bar waterfall steps from the revenue bridge.
function buildSteps(b: RevenueBridge): Step[] {
  const steps: Step[] = []
  const gmv = b.gross_gmv || 1
  let running = b.gross_gmv

  steps.push({
    label: 'Gross GMV', base: 0, value: b.gross_gmv, signed: b.gross_gmv,
    top: b.gross_gmv, bottom: 0, pct: 1, kind: 'total',
  })

  const deductions: [string, number][] = [
    ['Refunds & Returns', b.refunds_returns],
    ['Discounts & Promos', b.discounts_promos],
    ['Partner Payouts', b.partner_payouts],
  ]
  for (const [label, amt] of deductions) {
    const top = running
    running -= amt
    steps.push({
      label, base: running, value: amt, signed: -amt,
      top, bottom: running, pct: -(amt / gmv), kind: 'down',
    })
  }

  steps.push({
    label: 'Net Revenue', base: 0, value: b.net_revenue, signed: b.net_revenue,
    top: b.net_revenue, bottom: 0, pct: b.net_revenue / gmv, kind: 'total',
  })
  return steps
}

function pctLabel(p: number): string {
  const sign = p < 0 ? '−' : ''
  return `${sign}${Math.abs(p * 100).toFixed(1)}%`
}

function WaterfallTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d: Step = payload[0].payload
  return (
    <div className="tooltip-card">
      <div className="t-label">{d.label}</div>
      <div className="t-row">
        <span>{d.kind === 'down' ? 'Deduction' : 'Amount'}</span>
        <strong style={{ color: d.kind === 'down' ? 'var(--red)' : 'var(--teal)' }}>
          {fmtMoney(d.signed, { signed: d.kind === 'down' })}
        </strong>
      </div>
      <div className="t-row">
        <span>% of Gross GMV</span>
        <strong style={{ color: d.kind === 'down' ? 'var(--red)' : 'var(--teal)' }}>
          {pctLabel(d.pct)}
        </strong>
      </div>
      {d.label === 'Net Revenue' && (
        <div className="t-row">
          <span>Take rate</span>
          <strong style={{ color: 'var(--teal)' }}>{(d.pct * 100).toFixed(1)}%</strong>
        </div>
      )}
    </div>
  )
}

// Custom label renderer: draws the $ value (and % of GMV) just ABOVE each bar's
// top edge so even tiny slivers (Refunds / Discounts) stay legible.
function ValueLabel(props: any) {
  const { x, y, width, index, steps } = props
  const s: Step = steps[index]
  if (!s) return null
  const cx = x + width / 2
  const isDown = s.kind === 'down'
  const money = fmtMoney(s.signed, { signed: false })
  const moneyText = isDown ? `−${money.replace('-', '')}` : money
  const color = isDown ? '#fca5a5' : '#5eead4'
  // Place labels above the top of the bar. `y` is the top of the visible bar.
  const valY = y - 20
  const pctY = y - 7
  return (
    <g>
      <text x={cx} y={valY} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={color}>
        {moneyText}
      </text>
      <text x={cx} y={pctY} textAnchor="middle" fontSize={10.5} fontWeight={500} fill="#8ea0c8">
        {pctLabel(s.pct)}
        {s.label === 'Net Revenue' ? ' take rate' : ''}
      </text>
    </g>
  )
}

const R = 5 // top corner radius of the visible bars
const MAX_BAR = 70

// Custom shape for the visible "value" bar — just a rounded-top rectangle.
// IMPORTANT: this must be a pure render with no side effects. (A previous
// version mutated a shared `positions` array here to draw connectors; in the
// production bundle that array was non-extensible and the assignment threw
// "Cannot add property 0, object is not extensible", crashing the whole app.)
function ValueBar(props: any) {
  const { x, y, width, height, fill } = props
  const r = Math.min(R, height)
  const barPath = `M${x},${y + height}
    L${x},${y + r}
    Q${x},${y} ${x + r},${y}
    L${x + width - r},${y}
    Q${x + width},${y} ${x + width},${y + r}
    L${x + width},${y + height} Z`
  return <path d={barPath} fill={fill} />
}

// Waterfall "tie" connector lines, drawn as a Customized layer that reads the
// chart's computed x/y scales — no render-time mutation. Each connector is a
// horizontal dashed line at the running-total level shared between consecutive
// steps (steps[i].top), linking the right edge of bar i-1 to the left edge of
// bar i. Robust across Recharts versions: we look up the scales defensively.
function Connectors(props: any) {
  const { steps } = props
  const xMap = props.xAxisMap || props.xAxisMaps
  const yMap = props.yAxisMap || props.yAxisMaps
  if (!xMap || !yMap) return null
  const xAxis = xMap[Object.keys(xMap)[0]]
  const yAxis = yMap[Object.keys(yMap)[0]]
  const xScale = xAxis?.scale
  const yScale = yAxis?.scale
  if (!xScale || !yScale) return null
  const band = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 0
  const barW = Math.min(band, MAX_BAR)
  const centerOf = (s: Step) => (xScale(s.label) ?? 0) + band / 2
  const lines = []
  for (let i = 1; i < steps.length; i++) {
    const y = yScale(steps[i].top)
    const x1 = centerOf(steps[i - 1]) + barW / 2
    const x2 = centerOf(steps[i]) - barW / 2
    lines.push(
      <line key={i} x1={x1} y1={y} x2={x2} y2={y}
        stroke="#5eead4" strokeOpacity={0.42} strokeWidth={1.5} strokeDasharray="2 3" />
    )
  }
  return <g>{lines}</g>
}

export function Waterfall({ data }: { data: RevenueBridge }) {
  const steps = buildSteps(data)
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={steps} margin={{ top: 44, right: 12, left: 4, bottom: 8 }}>
        <XAxis dataKey="label" tick={{ fill: '#94a3c8', fontSize: 11.5 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: '#6b7aa3', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<WaterfallTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="w" maxBarSize={MAX_BAR} isAnimationActive={false} shape={<ValueBar />}>
          {steps.map((s, i) => (
            <Cell key={i} fill={s.kind === 'total' ? '#6366f1' : '#f87171'} />
          ))}
          <LabelList dataKey="value" content={(p: any) => <ValueLabel {...p} steps={steps} />} />
        </Bar>
        <Customized component={(p: any) => <Connectors {...p} steps={steps} />} />
      </BarChart>
    </ResponsiveContainer>
  )
}
