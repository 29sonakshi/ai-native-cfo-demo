import { useState } from 'react'
import {
  AlertTriangle, Bot, Check, ClipboardCopy, Sparkles, Target, Wand2,
} from 'lucide-react'
import { api } from '../lib/api'
import type { AgentPlanResp } from '../lib/api'
import { fmtMoney } from '../lib/format'
import { Card, ErrorNote } from '../components/ui'

const ENTITIES: { id: string; name: string }[] = [
  { id: 'ENT03', name: 'Coral Pay' },
  { id: 'ENT01', name: 'Meridian Bank' },
  { id: 'ENT02', name: 'Northcrest Financial' },
]

const STAGES = (entityName: string) => [
  `Pulling ${entityName} financials…`,
  'Modeling turnaround scenarios…',
  'Drafting recommendations & board narrative…',
]

function fmtRunway(v: number | null): string {
  return v === null ? 'Cash-positive' : `${v.toFixed(0)} mo`
}

function fmtDelta(v: number | null): { txt: string; positive: boolean } | null {
  if (v === null) return null
  const rounded = Math.round(v)
  if (rounded === 0) return { txt: '—', positive: false }
  return { txt: `${rounded > 0 ? '+' : ''}${rounded} mo`, positive: rounded > 0 }
}

// --- Progressive "agent thinking" reveal ---------------------------------

function ThinkingPanel({ stages, active }: { stages: string[]; active: number }) {
  return (
    <Card className="agent-thinking">
      <div className="agent-think-head">
        <span className="synth-glyph"><Bot size={16} /></span>
        Action Agent working…
      </div>
      <div className="agent-stages">
        {stages.map((s, i) => {
          const done = i < active
          const running = i === active
          return (
            <div key={i} className={`agent-stage ${done ? 'done' : running ? 'running' : 'pending'}`}>
              <span className="agent-stage-mark">
                {done ? <Check size={14} /> : (
                  <span className="agent-num">{i + 1}</span>
                )}
              </span>
              <span className="agent-stage-text">
                {s}
                {running && <span className="dots"><span>.</span><span>.</span><span>.</span></span>}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// --- Scenarios table ------------------------------------------------------

function ScenariosCard({ plan }: { plan: AgentPlanResp }) {
  const rows = [{ ...plan.baseline, _baseline: true }, ...plan.scenarios]
  return (
    <Card>
      <h2 className="section-title"><Target size={17} color="#a5b4fc" /> Turnaround scenarios</h2>
      <div className="fs-caption">Deterministically modeled from {plan.entity_name}'s latest-month operating profile.</div>
      <div className="fs-scroll">
        <table className="fs-table agent-scn">
          <thead>
            <tr>
              <th>Scenario</th>
              <th className="num">Resulting burn</th>
              <th className="num">Runway</th>
              <th className="num">Δ vs today</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s: any, i) => {
              const delta = fmtDelta(s.runway_delta_vs_baseline)
              return (
                <tr key={i} className={s._baseline ? 'fs-key' : s.is_breakeven ? 'agent-breakeven' : ''}>
                  <td className="fs-metric strong">
                    {s.name}
                    <span className="agent-lever">{s.lever_description}</span>
                  </td>
                  <td className="num">{s.is_breakeven ? '$0' : `${fmtMoney(s.burn_rate)}/mo`}</td>
                  <td className="num strong">{fmtRunway(s.runway_months)}</td>
                  <td className="num">
                    {delta ? (
                      <span className={`fs-delta ${delta.positive ? 'good' : ''}`}>{delta.txt}</span>
                    ) : <span className="delta-na">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// --- Recommendations ------------------------------------------------------

function RecommendationsCard({ plan }: { plan: AgentPlanResp }) {
  return (
    <Card>
      <h2 className="section-title"><Sparkles size={17} color="#2dd4bf" /> Recommended actions</h2>
      <ol className="agent-recs">
        {plan.recommendations.map((r, i) => (
          <li key={i} className="agent-rec">
            <span className="agent-rec-num">{i + 1}</span>
            <div>
              <div className="agent-rec-title">{r.title}</div>
              <div className="agent-rec-detail">{r.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// --- Board narrative ------------------------------------------------------

function BoardNarrativeCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <Card className="agent-board">
      <div className="agent-board-head">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Draft board narrative</h2>
        <button className="agent-copy" onClick={copy}>
          {copied ? <><Check size={14} /> Copied</> : <><ClipboardCopy size={14} /> Copy</>}
        </button>
      </div>
      <blockquote className="agent-quote">{text}</blockquote>
    </Card>
  )
}

// --- Tab ------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function ActionAgent() {
  const [entityId, setEntityId] = useState('ENT03')
  const [plan, setPlan] = useState<AgentPlanResp | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const entityName = ENTITIES.find((e) => e.id === entityId)?.name ?? 'entity'

  async function build() {
    if (busy) return
    setBusy(true)
    setError(null)
    setPlan(null)
    setStage(0)
    // Staged "agentic" reveal layered over the single fetch.
    const fetchP = api.agentPlan(entityId)
    try {
      await sleep(650); setStage(1)
      await sleep(750); setStage(2)
      const result = await fetchP
      await sleep(450)
      setPlan(result)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <Card className="synth-card">
        <div className="synth-head">
          <div className="synth-title">
            <span className="synth-glyph"><Wand2 size={16} /></span>
            CFO Action Agent
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 16, position: 'relative' }}>
          Pick an at-risk entity and the agent will diagnose the problem, model turnaround scenarios
          on the real numbers, and draft prioritized recommendations plus a board-ready narrative.
        </div>
        <div className="agent-controls">
          <label className="agent-select">
            <span>Entity</span>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} disabled={busy}>
              {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <button className="agent-build" onClick={build} disabled={busy}>
            <Wand2 size={16} /> {busy ? 'Building…' : 'Build action plan'}
          </button>
        </div>
      </Card>

      {busy && <ThinkingPanel stages={STAGES(entityName)} active={stage} />}

      {error && <ErrorNote msg={error} />}

      {plan && !busy && (
        <>
          <Card className="agent-situation">
            <h2 className="section-title"><AlertTriangle size={17} color="#f87171" /> Situation</h2>
            <p className="agent-situation-text">{plan.situation}</p>
          </Card>
          <ScenariosCard plan={plan} />
          <RecommendationsCard plan={plan} />
          <BoardNarrativeCard text={plan.board_narrative} />
        </>
      )}
    </div>
  )
}
