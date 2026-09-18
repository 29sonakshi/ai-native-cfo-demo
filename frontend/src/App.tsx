import { useState } from 'react'
import { Coins, LayoutDashboard, Sparkles } from 'lucide-react'
import { GroupPerf } from './tabs/GroupPerf'
import { AiSpend } from './tabs/AiSpend'
import { Genie } from './tabs/Genie'

type TabId = 'group' | 'ai' | 'genie'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'group', label: 'Group Perf', icon: <LayoutDashboard size={16} /> },
  { id: 'ai', label: 'AI Spend', icon: <Coins size={16} /> },
  { id: 'genie', label: 'CFO Q&A', icon: <Sparkles size={16} /> },
]

export default function App() {
  const [tab, setTab] = useState<TabId>('group')

  return (
    <div className="app">
      <header className="header">
        <div className="wordmark">
          <div className="logo-badge">
            <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
              <path d="M14 46V20l18 13 18-13v26" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Meridian Bank</div>
            <div className="brand-sub">CFO Cockpit</div>
          </div>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          Consolidated financials + AI spend · <strong>USD</strong><br />
          Powered by Databricks AI/BI Genie
        </div>
      </header>

      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>

      {tab === 'group' && <GroupPerf />}
      {tab === 'ai' && <AiSpend />}
      {tab === 'genie' && <Genie />}
    </div>
  )
}
