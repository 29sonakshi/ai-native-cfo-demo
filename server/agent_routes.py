"""CFO Action Agent — diagnose an at-risk entity, model turnaround scenarios
deterministically in Python, then have Claude draft recommendations + a
board-ready narrative grounded ONLY in the computed numbers.

The scenario math mirrors how the demo data was generated, so it reproduces the
stored baseline (verified for Coral Pay: EBITDA ≈ -$14.6M, FCF ≈ -$14.0M,
runway ≈ 10mo). Results are cached in memory per entity; pass ?refresh=1.
"""
import json

from fastapi import APIRouter
from databricks.sdk.service.sql import StatementParameterListItem

from .llm import SYNTH_MODEL, complete
from .sqlexec import run_query

router = APIRouter()

_cache: dict[str, object] = {}

DEFAULT_ENTITY = "ENT03"


# --- Deterministic projection model --------------------------------------

def _project(net_rev: float, gross_margin: float, opex: float, cash: float):
    """Return (ebitda, fcf, burn, runway_months) for a given operating profile.

    Consistent with the data-generation model; FCF reflects EBITDA net of a
    working-capital / capex drag scaled to revenue. runway = None => cash-positive.
    """
    ebitda = net_rev * gross_margin - opex
    fcf = ebitda * 0.9 - net_rev * 0.045
    burn = max(0.0, -fcf)
    runway = (cash / burn) if burn > 0 else None
    return ebitda, fcf, burn, runway


def _scenario(name: str, lever: str, *, net_rev, gross_margin, opex, cash,
              baseline_runway):
    ebitda, fcf, burn, runway = _project(net_rev, gross_margin, opex, cash)
    if runway is None or baseline_runway is None:
        delta = None
    else:
        delta = runway - baseline_runway
    return {
        "name": name,
        "lever_description": lever,
        "ebitda": ebitda,
        "free_cash_flow": fcf,
        "burn_rate": burn,
        "runway_months": runway,
        "runway_delta_vs_baseline": delta,
    }


# --- Money formatting (for the Claude context only) ----------------------

def _fmt_money(v) -> str:
    if v is None:
        return "n/a"
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a / 1e3:.1f}K"
    return f"{sign}${a:.0f}"


def _fmt_runway(v) -> str:
    return "cash-positive" if v is None else f"{v:.0f} mo"


# --- Data pull ------------------------------------------------------------

def _pull_entity(entity_id: str) -> dict:
    rows = run_query(
        """
        WITH latest AS (SELECT MAX(month) m FROM fact_financials_monthly)
        SELECT
          d.entity_name, d.geography,
          f.net_revenue, f.cogs, f.gross_profit, f.gross_margin_pct,
          f.opex, f.ebitda,
          c.free_cash_flow, c.burn_rate, c.cash_balance, c.runway_months,
          CAST((SELECT m FROM latest) AS STRING) AS latest_month
        FROM dim_entity d
        JOIN fact_financials_monthly f
          ON d.entity_id = f.entity_id AND f.month = (SELECT m FROM latest)
        JOIN fact_cash_monthly c
          ON d.entity_id = c.entity_id AND c.month = (SELECT m FROM latest)
        WHERE d.entity_id = :eid
        """,
        parameters=[StatementParameterListItem(name="eid", value=entity_id)],
    )
    if not rows:
        raise RuntimeError(f"No financials found for entity {entity_id}")
    fcf_hist = run_query(
        """
        WITH latest AS (SELECT MAX(month) m FROM fact_cash_monthly)
        SELECT CAST(month AS STRING) AS month, free_cash_flow
        FROM fact_cash_monthly
        WHERE entity_id = :eid
          AND month >= add_months((SELECT m FROM latest), -5)
        ORDER BY month
        """,
        parameters=[StatementParameterListItem(name="eid", value=entity_id)],
    )
    rows[0]["fcf_history"] = fcf_hist
    return rows[0]


# --- Scenario engine ------------------------------------------------------

def _build_scenarios(a: dict) -> tuple[dict, list[dict]]:
    net_rev = a["net_revenue"]
    gm = a["gross_margin_pct"]
    opex = a["opex"]
    cash = a["cash_balance"]

    b_ebitda, b_fcf, b_burn, b_runway = _project(net_rev, gm, opex, cash)
    baseline = {
        "name": "Today (baseline)",
        "lever_description": "Current operating profile, no action",
        "ebitda": b_ebitda,
        "free_cash_flow": b_fcf,
        "burn_rate": b_burn,
        "runway_months": b_runway,
        "runway_delta_vs_baseline": 0.0 if b_runway is not None else None,
    }

    scenarios = [
        _scenario(
            "Cut operating costs 20%",
            "Reduce opex by 20% via operating efficiencies (marketing/CAC, vendors, tooling, automation)",
            net_rev=net_rev, gross_margin=gm, opex=opex * 0.80, cash=cash,
            baseline_runway=b_runway,
        ),
        _scenario(
            "Lift gross margin to 55%",
            "Raise gross margin to 55% (take-rate / partner-payout repricing)",
            net_rev=net_rev, gross_margin=max(gm, 0.55), opex=opex, cash=cash,
            baseline_runway=b_runway,
        ),
        _scenario(
            "Combined turnaround",
            "Cut opex 15% AND lift gross margin to 52%",
            net_rev=net_rev, gross_margin=max(gm, 0.52), opex=opex * 0.85,
            cash=cash, baseline_runway=b_runway,
        ),
        _scenario(
            "Raise $150M capital",
            "Inject $150M cash; economics (margin/opex) unchanged",
            net_rev=net_rev, gross_margin=gm, opex=opex, cash=cash + 150e6,
            baseline_runway=b_runway,
        ),
    ]

    # Path to break-even: FCF = 0 requires ebitda = net_rev * 0.05, i.e. the
    # operating profile must deliver gross_profit - opex = net_rev * (0.045/0.9).
    required_ebitda = net_rev * 0.05
    current_gp = net_rev * gm
    # Monthly combined gap (margin gain + cost cut) needed to reach break-even.
    monthly_gap = required_ebitda - (current_gp - opex)
    annual_gap = monthly_gap * 12
    # Express as an equivalent opex cut at today's margin.
    opex_cut_pct = (monthly_gap / opex) if opex else None
    breakeven = {
        "name": "Path to break-even",
        "lever_description": (
            f"Needs ~{_fmt_money(annual_gap)} of combined annual margin gain + "
            f"cost cuts — roughly a "
            f"{opex_cut_pct * 100:.0f}% opex cut at today's "
            f"{gm * 100:.0f}% margin"
        ),
        "ebitda": required_ebitda,
        "free_cash_flow": 0.0,
        "burn_rate": 0.0,
        "runway_months": None,  # cash-positive at break-even
        "runway_delta_vs_baseline": None,
        "is_breakeven": True,
        "monthly_gap": monthly_gap,
        "annual_gap": annual_gap,
        "opex_cut_pct": opex_cut_pct,
    }
    scenarios.append(breakeven)

    return baseline, scenarios


# --- Claude narration -----------------------------------------------------

_SYSTEM = """You are "Meridian Action Agent", a sharp turnaround CFO advisor at \
Meridian Bank's group holding company. You are given an at-risk entity's \
pre-computed baseline financials and a set of turnaround scenarios whose numbers \
have ALREADY been calculated. Your job is to diagnose and recommend.

Strict rules:
- Use ONLY the numbers in the user message. NEVER invent or estimate figures. \
Every dollar/percent/month you cite must appear in the provided context.
- Be concrete, executive-grade, and honest about how large the gap is.
- NEVER recommend reducing headcount, layoffs, staff/workforce cuts, hiring \
freezes, or any people-related reductions. Do NOT use the word "headcount" in \
any form (not even "non-headcount"), and do not mention staffing, people, or \
workforce at all. Describe cost actions ONLY by their concrete lever: \
renegotiating partner payouts, marketing/customer-acquisition (CAC) spend \
efficiency, vendor / tooling / infrastructure costs, process automation, and pricing.
- Return ONLY valid JSON (no markdown fences, no prose around it) with EXACTLY \
these keys:
  {
    "situation": "<2-3 sentence diagnosis: the burn, the root cause (spend \
exceeds revenue at a low gross margin), and the runway>",
    "recommendations": [
      {"title": "<short imperative action>", "detail": "<1-2 sentences tying it \
to a specific lever and its computed impact>"}
    ],
    "board_narrative": "<a single 4-5 sentence board-ready paragraph (max ~120 \
words) the CFO can paste into an update>"
  }
- Provide 3-4 recommendations, prioritized (most impactful first). Tie them to \
the real levers: fix the low gross margin (renegotiate partner payouts / lift \
take-rate), improve marketing/CAC efficiency and reduce vendor, tooling and \
infrastructure costs, reprice, and/or secure bridge funding to extend \
runway while the economics are fixed. Be clear that raising capital alone \
extends runway but does NOT fix the burn."""


def _build_context(a: dict, baseline: dict, scenarios: list[dict]) -> str:
    lines = [
        f"ENTITY: {a['entity_name']} ({a['geography']})",
        f"REPORTING MONTH: {a['latest_month']}",
        "",
        "BASELINE ACTUALS (latest month):",
        f"- Net revenue: {_fmt_money(a['net_revenue'])}",
        f"- COGS: {_fmt_money(a['cogs'])}",
        f"- Gross profit: {_fmt_money(a['gross_profit'])} "
        f"(gross margin {a['gross_margin_pct'] * 100:.0f}%)",
        f"- Opex: {_fmt_money(a['opex'])}",
        f"- EBITDA: {_fmt_money(baseline['ebitda'])}",
        f"- Free cash flow: {_fmt_money(baseline['free_cash_flow'])}/mo",
        f"- Monthly burn: {_fmt_money(baseline['burn_rate'])}",
        f"- Cash balance: {_fmt_money(a['cash_balance'])}",
        f"- Runway: {_fmt_runway(baseline['runway_months'])}",
        "",
        "TURNAROUND SCENARIOS (already computed — do not recompute):",
    ]
    for s in scenarios:
        delta = s.get("runway_delta_vs_baseline")
        delta_txt = ""
        if delta is not None:
            delta_txt = f", runway {'+' if delta >= 0 else ''}{delta:.0f}mo vs today"
        lines.append(
            f"- {s['name']} ({s['lever_description']}): "
            f"EBITDA {_fmt_money(s['ebitda'])}, FCF {_fmt_money(s['free_cash_flow'])}/mo, "
            f"burn {_fmt_money(s['burn_rate'])}, runway {_fmt_runway(s['runway_months'])}"
            f"{delta_txt}"
        )
    return "\n".join(lines)


def _fallback(a: dict, baseline: dict, scenarios: list[dict], reason: str) -> dict:
    burn = _fmt_money(baseline["burn_rate"])
    runway = _fmt_runway(baseline["runway_months"])
    return {
        "situation": (
            f"{a['entity_name']} ({a['geography']}) is burning {burn} per month "
            f"at a {a['gross_margin_pct'] * 100:.0f}% gross margin, with operating "
            f"spend well above revenue. At the current burn, only {runway} of "
            f"runway remains. (AI narration unavailable: {reason}.)"
        ),
        "recommendations": [
            {"title": "Lift gross margin", "detail": "Renegotiate partner payouts "
             "and lift take-rate to close the margin gap that drives the burn."},
            {"title": "Cut operating costs", "detail": "A 20% opex reduction "
             "materially extends runway while the economics are repaired."},
            {"title": "Secure bridge funding", "detail": "Raising capital extends "
             "runway but does not fix the burn — pair it with the levers above."},
        ],
        "board_narrative": (
            f"{a['entity_name']} remains our key liquidity watch item, burning "
            f"{burn} per month against a {a['gross_margin_pct'] * 100:.0f}% gross "
            f"margin and roughly {runway} of runway. The root cause is structural: "
            f"operating spend exceeds revenue at a thin margin. Management is "
            f"pursuing margin repair and cost discipline, with a bridge financing "
            f"option to preserve optionality while the unit economics are fixed."
        ),
        "_fallback": True,
    }


def _extract_json(raw: str) -> dict:
    """Pull the first balanced JSON object out of an LLM response.

    Tolerates ```json fences, leading/trailing prose, and code blocks — the
    model occasionally wraps or annotates its output despite instructions.
    """
    text = raw.strip()
    # Strip a leading fence if present.
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
    # Scan for the first balanced {...}, ignoring braces inside strings.
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unbalanced JSON object")


def _generate(entity_id: str) -> dict:
    a = _pull_entity(entity_id)
    baseline, scenarios = _build_scenarios(a)

    context = _build_context(a, baseline, scenarios)
    user = (
        "Diagnose this at-risk entity and draft the CFO action plan per your "
        "instructions. Remember: return ONLY the JSON object.\n\n" + context
    )

    narration: dict
    try:
        raw = complete(_SYSTEM, user, temperature=0.3, max_tokens=1800)
        parsed = _extract_json(raw)
        narration = {
            "situation": str(parsed.get("situation", "")).strip(),
            "recommendations": [
                {"title": str(r.get("title", "")).strip(),
                 "detail": str(r.get("detail", "")).strip()}
                for r in parsed.get("recommendations", [])
                if isinstance(r, dict)
            ],
            "board_narrative": str(parsed.get("board_narrative", "")).strip(),
        }
        if not narration["situation"] or not narration["recommendations"]:
            raise ValueError("incomplete narration")
    except Exception as exc:  # noqa: BLE001 — never 500 on FM/parse errors
        narration = _fallback(a, baseline, scenarios, type(exc).__name__)

    return {
        "entity_id": entity_id,
        "entity_name": a["entity_name"],
        "geography": a["geography"],
        "generated_for_month": a["latest_month"],
        "situation": narration["situation"],
        "baseline": baseline,
        "scenarios": scenarios,
        "recommendations": narration["recommendations"],
        "board_narrative": narration["board_narrative"],
        "model": SYNTH_MODEL,
    }


@router.get("/agent/plan")
def agent_plan(entity_id: str = DEFAULT_ENTITY, refresh: int = 0):
    """Build a turnaround action plan for an at-risk entity (cached per entity)."""
    key = f"plan:{entity_id}"
    if refresh or key not in _cache:
        _cache[key] = _generate(entity_id)
    return _cache[key]
