import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SynthesisResp } from '../lib/api'

// --- Minimal markdown renderer -------------------------------------------
// Handles the subset the model emits: paragraphs, bullet lists, and inline
// **bold** / _italic_. Avoids pulling in a markdown dependency.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Split on **bold** and _italic_ tokens, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  parts.forEach((p, i) => {
    if (!p) return
    if (p.startsWith('**') && p.endsWith('**')) {
      out.push(<strong key={`${keyBase}-b-${i}`}>{p.slice(2, -2)}</strong>)
    } else if (p.startsWith('_') && p.endsWith('_')) {
      out.push(<em key={`${keyBase}-i-${i}`}>{p.slice(1, -1)}</em>)
    } else {
      out.push(p)
    }
  })
  return out
}

function Markdown({ md }: { md: string }) {
  const lines = md.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []
  let bi = 0

  const flushList = () => {
    if (list.length) {
      const items = list
      blocks.push(
        <ul className="synth-list" key={`ul-${bi++}`}>
          {items.map((it, i) => <li key={i}>{inline(it, `li-${bi}-${i}`)}</li>)}
        </ul>,
      )
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flushList(); continue }
    // Horizontal rule (---, ***, ___) -> divider.
    if (/^([-*_])\1{2,}$/.test(line)) { flushList(); blocks.push(<hr className="synth-hr" key={`hr-${bi++}`} />); continue }
    // ATX headings (#, ##, ###) -> a styled subheading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) { flushList(); blocks.push(<div className="synth-h" key={`h-${bi++}`}>{inline(heading[2], `h-${bi}`)}</div>); continue }
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) { list.push(bullet[1]); continue }
    flushList()
    blocks.push(<p className="synth-p" key={`p-${bi++}`}>{inline(line, `p-${bi}`)}</p>)
  }
  flushList()
  return <div className="synth-body">{blocks}</div>
}

// --- Card -----------------------------------------------------------------

export function Synthesizer({
  s,
}: {
  s: { data: SynthesisResp | null; loading: boolean; error: string | null }
}) {
  return (
    <div className="card synth-card">
      <div className="synth-head">
        <div className="synth-title">
          <span className="synth-glyph"><Sparkles size={16} /></span>
          AI Insights
        </div>
      </div>

      {s.loading ? (
        <div className="synth-shimmer">
          <div className="skeleton synth-line" style={{ width: '94%' }} />
          <div className="skeleton synth-line" style={{ width: '88%' }} />
          <div className="skeleton synth-line" style={{ width: '76%' }} />
          <div className="skeleton synth-line" style={{ width: '60%' }} />
          <div className="synth-generating">Generating AI synthesis…</div>
        </div>
      ) : s.error ? (
        <div className="synth-body"><p className="synth-p">AI synthesis unavailable: {s.error}</p></div>
      ) : s.data ? (
        <Markdown md={s.data.synthesis_markdown} />
      ) : null}
    </div>
  )
}
