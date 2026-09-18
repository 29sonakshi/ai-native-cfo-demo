import { useEffect, useRef, useState } from 'react'
import { Bot, Brain, Check, ChevronDown, ChevronRight, Code2, ExternalLink, Loader2, Send, Sparkles, User } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import type { GenieResponse } from '../lib/api'
import { fmtCell } from '../lib/format'
import { Card } from '../components/ui'

// Set VITE_GENIE_ONE_URL (see frontend/.env.example) to your workspace's Genie One
// URL, e.g. https://<your-workspace-host>/one, then rebuild the frontend.
const GENIE_ONE_URL = import.meta.env.VITE_GENIE_ONE_URL || '#'

// Mix of finance + AI-cost questions — the demo drill-down from symptom to lever.
const SUGGESTED = [
  'Which entity is dragging down group free cash flow?',
  'Why is Coral Pay burning cash?',
  'Which entities are over their AI budget, and by how much?',
  'How much of Coral Pay’s AI spend is on a single provider?',
  'What’s our group AI spend as a % of revenue, and is it growing?',
  'If we rerouted Coral Pay’s low-value AI tasks to a cheaper model, how much could we save?',
]

interface Turn {
  question: string
  response?: GenieResponse
  error?: string
  loading: boolean
}

// Render markdown-ish bold (**text**) and basic line breaks.
function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
  )
}

function isNumeric(v: string) {
  return v != null && v.trim() !== '' && !isNaN(Number(v))
}

// If result is a dimension + single numeric measure, show a small bar chart.
function ResultChart({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (columns.length !== 2 || rows.length < 2 || rows.length > 12) return null
  const allNumeric = rows.every((r) => isNumeric(r[1]))
  const dimNumeric = rows.every((r) => isNumeric(r[0]))
  if (!allNumeric || dimNumeric) return null
  const data = rows.map((r) => ({ name: r[0], value: Number(r[1]) }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={64}
          tickFormatter={(v) => Number(v).toLocaleString('en-US', { notation: 'compact' })} />
        <Tooltip content={({ active, payload, label }: any) => active && payload?.length ? (
          <div className="tooltip-card"><div className="t-label">{label}</div>
            <div className="t-row"><span>{columns[1]}</span><strong>{Number(payload[0].value).toLocaleString()}</strong></div></div>
        ) : null} cursor={{ fill: 'rgba(79,70,229,0.05)' }} />
        <Bar dataKey="value" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={64} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function ResultTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  if (!columns.length || !rows.length) return null
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table>
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{fmtCell(v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  if (!sql) return null
  return (
    <div className="sql-block">
      <button className="sql-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Code2 size={14} /> Generated SQL
      </button>
      {open && <pre className="sql-code">{sql}</pre>}
    </div>
  )
}

const THINKING_STEPS = [
  'Interpreting your question',
  'Identifying the right tables in Unity Catalog',
  'Generating SQL',
  'Running on the lakehouse',
  'Composing the answer',
]

// Live progress indicator shown while a Genie request is in flight.
function ThinkingPanel() {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setActive((a) => Math.min(a + 1, THINKING_STEPS.length - 1))
    }, 750)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="genie-thinking">
      <div className="genie-think-head">
        <Brain size={16} className="genie-think-brain" /> Thinking
        <span className="dots"><span>.</span><span>.</span><span>.</span></span>
      </div>
      <div className="genie-steps">
        {THINKING_STEPS.map((label, i) => {
          const state = i < active ? 'done' : i === active ? 'running' : 'pending'
          return (
            <div key={label} className={`genie-step ${state}`}>
              <span className="genie-step-mark">
                {state === 'done' ? <Check size={13} />
                  : state === 'running' ? <Loader2 size={13} className="genie-spin" />
                  : <span className="genie-dot" />}
              </span>
              <span className="genie-step-label">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GenieAnswer({ turn }: { turn: Turn }) {
  if (turn.loading) return <ThinkingPanel />
  if (turn.error) return <div className="msg-text" style={{ color: 'var(--red)' }}>{turn.error}</div>
  const r = turn.response!
  return (
    <div>
      {r.answer && <div className="msg-text">{renderText(r.answer)}</div>}
      {r.reasoning && (
        <div className="genie-reasoning">
          <Brain size={14} className="genie-reasoning-icon" />
          <span><em>Genie's read: {r.reasoning}</em></span>
        </div>
      )}
      <SqlBlock sql={r.sql} />
      {r.columns.length > 0 && <ResultChart columns={r.columns} rows={r.rows} />}
      {r.columns.length > 0 && <ResultTable columns={r.columns} rows={r.rows} />}
    </div>
  )
}

export function Genie() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const convId = useRef<string | undefined>(undefined)
  const logRef = useRef<HTMLDivElement>(null)

  async function ask(question: string) {
    if (!question.trim() || busy) return
    setBusy(true)
    setInput('')
    const idx = turns.length
    setTurns((t) => [...t, { question, loading: true }])
    setTimeout(() => logRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 50)
    try {
      const resp = await api.askGenie(question, convId.current)
      convId.current = resp.conversation_id
      setTurns((t) => t.map((x, i) => i === idx ? { ...x, loading: false, response: resp } : x))
    } catch (e) {
      setTurns((t) => t.map((x, i) => i === idx ? { ...x, loading: false, error: String(e) } : x))
    } finally {
      setBusy(false)
      setTimeout(() => logRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }), 80)
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* Genie One launchpad hero */}
      <Card className="gone-hero">
        <div className="gone-title">
          <span className="gone-glyph"><Sparkles size={20} /></span>
          Ask Meridian's Genie
        </div>
        <div className="gone-sub">
          Powered by Databricks Genie One — ask any question across finance and AI spend, and draft a
          board-ready action plan. One assistant over the whole business, grounded in governed data.
        </div>
        {GENIE_ONE_URL !== '#' && (
          <a className="gone-cta" href={GENIE_ONE_URL} target="_blank" rel="noopener noreferrer">
            Open in Genie One <ExternalLink size={16} />
          </a>
        )}
      </Card>

      {/* Suggested questions */}
      <Card>
        <div className="fs-block-title">Try asking</div>
        <div className="chips">
          {SUGGESTED.map((q) => (
            <button key={q} className="chip" disabled={busy} onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
      </Card>

      {/* In-app preview (Strategy-B fallback) */}
      <Card>
        <h2 className="section-title"><Sparkles size={18} color="#0d9488" /> Or preview in-app</h2>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 14 }}>
          A quick in-app preview backed by the same Genie agent — for the full experience (and to draft a
          document), open Genie One above.
        </div>
        <div className="chat-input">
          <input
            value={input}
            placeholder="Ask about Meridian's finances or AI spend…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask(input)}
            disabled={busy}
          />
          <button onClick={() => ask(input)} disabled={busy || !input.trim()}>
            <Send size={15} /> Ask
          </button>
        </div>
        {turns.length === 0 && <div className="empty-hint">Tip: click a suggested question above to get started.</div>}
      </Card>

      {turns.length > 0 && (
        <Card>
          <div className="chat-log" ref={logRef} style={{ maxHeight: 540, overflowY: 'auto' }}>
            {turns.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="msg msg-user">
                  <div className="msg-avatar"><User size={16} /></div>
                  <div className="msg-body"><div className="msg-role">You</div><div className="msg-text">{t.question}</div></div>
                </div>
                <div className="msg msg-genie">
                  <div className="msg-avatar"><Bot size={16} /></div>
                  <div className="msg-body"><div className="msg-role">Meridian Genie</div><GenieAnswer turn={t} /></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
