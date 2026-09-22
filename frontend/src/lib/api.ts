// Typed API client + a small data-fetching hook.
import { useEffect, useState } from 'react'

export interface Kpis {
  arr: number
  gross_margin_pct: number
  net_revenue: number
  burn_rate: number
  free_cash_flow: number
  cash_balance: number
  gross_gmv: number
  latest_month: string
}

export interface RevenueBridge {
  gross_gmv: number
  refunds_returns: number
  discounts_promos: number
  partner_payouts: number
  net_revenue: number
}

export interface TrendPoint { month: string; net_revenue: number; arr: number; gross_margin_pct: number }
export interface GeoPoint { geography: string; net_revenue: number; arr: number }

export interface EntitySnapshot {
  entity_id: string; entity_name: string; geography: string; country_code: string
  entity_type: string; is_parent: boolean; acquired_date: string | null
  acquisition_price_usd: number | null; employees: number; founded_year: number; description: string
  net_revenue: number; gross_margin_pct: number; ebitda: number; arr: number
  free_cash_flow: number; cash_balance: number; burn_rate: number; runway_months: number | null
}
export interface EntityTrend { month: string; entity_name: string; net_revenue: number; gross_margin_pct: number }
export interface EntitiesResp { snapshot: EntitySnapshot[]; trend: EntityTrend[] }

export interface CashSnapshot { entity_name: string; geography: string; cash_balance: number; burn_rate: number; free_cash_flow: number; runway_months: number | null }
export interface CashResp {
  snapshot: CashSnapshot[]
  totals: { cash_balance: number; burn_rate: number; free_cash_flow: number }
  runway_trend: { month: string; entity_name: string; runway_months: number }[]
  cash_trend: { month: string; entity_name: string; cash_balance: number }[]
}

export type SummaryUnit = 'usd' | 'pct'
export type FavorableWhen = 'up' | 'down'

export interface SummaryLine {
  metric: string
  unit: SummaryUnit
  current: number | null
  prior: number | null
  mom_pct: number | null
  yoy: number | null
  yoy_pct: number | null
  favorable_when: FavorableWhen
}
export interface SummaryEntityRow {
  metric: string
  unit: SummaryUnit
  favorable_when: FavorableWhen
  values: Record<string, number | null>
  mom: Record<string, number | null>
}
export interface SummaryResp {
  latest_month: string
  group: SummaryLine[]
  by_entity: {
    entities: { entity_id: string; entity_name: string }[]
    rows: SummaryEntityRow[]
  }
}

export interface GenieResponse {
  answer: string; sql: string; reasoning?: string; columns: string[]; rows: string[][]; conversation_id: string
}

// --- AI spend ------------------------------------------------------------
export interface AiOverviewTotals {
  ai_spend_usd: number; ai_budget_usd: number; budget_util_pct: number
  ai_pct_revenue: number; ai_pct_opex: number
  run_spend_usd: number; change_spend_usd: number; run_pct: number
  total_tokens: number; request_count: number; teams: number
}
export interface AiEntityRow {
  entity_id: string; entity_name: string
  ai_spend_usd: number; ai_budget_usd: number; budget_util_pct: number
  ai_pct_revenue: number; run_pct: number
}
export interface AiOverview {
  latest_month: string
  totals: AiOverviewTotals
  by_entity: AiEntityRow[]
}
export interface AiTrendPoint { month: string; ai_spend_usd: number; ai_budget_usd: number; ai_pct_revenue: number }
export interface ProviderMix { provider: string; tier: string; spend_usd: number; pct_of_group: number }
export interface TierSplit { tier: string; spend_usd: number; pct: number }
export interface Concentration { entity_id: string; entity_name: string; top_provider: string; top_pct: number; total_spend_usd: number }
export interface ModelRow { model: string; provider: string; tier: string; spend_usd: number; total_tokens: number; request_count: number; pct_of_group: number }
export interface AiProviders {
  group_mix: ProviderMix[]
  tier_split: TierSplit[]
  concentration: Concentration[]
  models: ModelRow[]
}

// Team-level attribution (default entity Coral Pay / ENT03).
export interface TeamRow {
  team: string; spend_usd: number; total_tokens: number; request_count: number
  top_model: string; top_model_pct: number; pct_of_entity: number
}
export interface TeamModelRow { model: string; provider: string; tier: string; spend_usd: number; total_tokens: number; pct: number }
export interface RoutingLever {
  model: string; premium_spend_usd: number; premium_tokens: number
  glm_cost_if_all: number; savings_if_80pct: number
}
export interface AiTeams {
  entity_id: string; entity_name: string; latest_month: string
  teams: TeamRow[]
  top_team: string | null
  top_team_model_mix: TeamModelRow[]
  lever: RoutingLever | null
}

export interface SynthesisResp {
  synthesis_markdown: string
  model: string
  generated_for_month: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json()
}

export const api = {
  kpis: () => get<Kpis>('/kpis'),
  summary: () => get<SummaryResp>('/summary'),
  revenueBridge: () => get<RevenueBridge>('/revenue-bridge'),
  trends: () => get<TrendPoint[]>('/trends'),
  geo: () => get<GeoPoint[]>('/geo'),
  entities: () => get<EntitiesResp>('/entities'),
  cash: () => get<CashResp>('/cash'),
  aiOverview: () => get<AiOverview>('/ai/overview'),
  aiTrend: () => get<AiTrendPoint[]>('/ai/trend'),
  aiProviders: () => get<AiProviders>('/ai/providers'),
  aiTeams: (entityId = 'ENT03') => get<AiTeams>(`/ai/teams?entity_id=${encodeURIComponent(entityId)}`),
  synthesis: () => get<SynthesisResp>('/synthesis'),
  askGenie: async (question: string, conversationId?: string): Promise<GenieResponse> => {
    const res = await fetch('/api/genie/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, conversation_id: conversationId }),
    })
    if (!res.ok) throw new Error(`Genie request failed: ${res.status}`)
    return res.json()
  },
}

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fn()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e) => { if (alive) setError(String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error }
}
