// Number formatting helpers for the CFO cockpit.

export function fmtMoney(n: number | null | undefined, opts?: { signed?: boolean }): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  const sign = opts?.signed && n > 0 ? '+' : ''
  const abs = Math.abs(n)
  let val: string
  if (abs >= 1e9) val = `$${(n / 1e9).toFixed(2)}B`
  else if (abs >= 1e6) val = `$${(n / 1e6).toFixed(1)}M`
  else if (abs >= 1e3) val = `$${(n / 1e3).toFixed(1)}K`
  else val = `$${n.toFixed(0)}`
  return sign + val
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtMonths(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return `${n.toFixed(0)} mo`
}

export function fmtMonthLabel(iso: string): string {
  // "2026-05-01" -> "May '26"
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
}

// Format an arbitrary cell value coming from a Genie result (strings).
export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const num = Number(v)
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(num)) {
    if (Number.isInteger(num)) return num.toLocaleString('en-US')
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return String(v)
}
