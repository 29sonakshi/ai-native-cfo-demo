"""Claude-powered natural-language synthesis of the financial summary.

Grounds the model in the REAL computed numbers (no hallucinated figures) and
returns a tight, executive-tone markdown read. The result is cached in memory
(the demo data is static); pass ?refresh=1 to regenerate.
"""
from fastapi import APIRouter

from .data_routes import compute_summary
from .llm import SYNTH_MODEL, complete

router = APIRouter()

_cache: dict[str, object] = {}


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


def _fmt_pct(v) -> str:
    return "n/a" if v is None else f"{v * 100:.1f}%"


def _dir(v, *, pp=False) -> str:
    if v is None:
        return "flat"
    unit = "pp" if pp else "%"
    arrow = "up" if v > 0 else "down" if v < 0 else "flat"
    return f"{arrow} {abs(v) * 100:.1f}{unit}"


def _build_context(summary: dict) -> str:
    """Build a compact, factual context string from the summary numbers."""
    by_metric = {r["metric"]: r for r in summary["group"]}
    lines = [f"Reporting month: {summary['latest_month']}", "", "GROUP ROLLUP (latest month):"]

    for m in ["ARR", "Net Revenue", "Gross Margin %", "EBITDA", "Free Cash Flow",
              "Burn Rate", "Cash Balance"]:
        r = by_metric.get(m)
        if not r:
            continue
        is_pct = r["unit"] == "pct"
        cur = _fmt_pct(r["current"]) if is_pct else _fmt_money(r["current"])
        mom = _dir(r["mom_pct"], pp=is_pct)
        yoy = _dir(r["yoy_pct"], pp=is_pct)
        lines.append(f"- {m}: {cur} (MoM {mom}, YoY {yoy})")

    # Per-entity ARR / FCF / margin so the model can ground entity-level claims.
    ents = summary["by_entity"]["entities"]
    rows = {r["metric"]: r for r in summary["by_entity"]["rows"]}
    lines.append("")
    lines.append("BY ENTITY (latest month):")
    for e in ents:
        eid = e["entity_id"]
        nr = rows.get("Net Revenue", {}).get("values", {}).get(eid)
        gm = rows.get("Gross Margin %", {}).get("values", {}).get(eid)
        fcf = rows.get("Free Cash Flow", {}).get("values", {}).get(eid)
        burn = rows.get("Burn Rate", {}).get("values", {}).get(eid)
        cash = rows.get("Cash Balance", {}).get("values", {}).get(eid)
        lines.append(
            f"- {e['entity_name']}: net revenue {_fmt_money(nr)}, "
            f"gross margin {_fmt_pct(gm)}, free cash flow {_fmt_money(fcf)}, "
            f"burn {_fmt_money(burn)}/mo, cash {_fmt_money(cash)}"
        )
    return "\n".join(lines)


_SYSTEM = """You are "Meridian Synthesizer", a sharp CFO finance analyst at \
Meridian Bank's group holding company. You write concise executive synthesis \
for the CFO from a pre-computed financial summary.

Strict rules:
- Use ONLY the numbers provided in the user message. Never invent or estimate \
figures. If a number is not given, do not cite it.
- Be tight: 4-6 sentences OR a few short bullet points. Executive tone. Markdown.
- Cite specific real numbers (ARR, net revenue, gross margin, free cash flow, \
cash) with their MoM/YoY direction.

Structure your read so it covers, in order:
1. One opening sentence: overall read of group health.
2. The headline numbers with direction (ARR, net revenue, gross margin, FCF, cash).
3. The KEY RISK: identify the entity with the weakest free cash flow from the supplied \
figures. Discuss burn or runway only when that exact number is present in the context.
4. The POSITIVE: Northcrest (Canada) is margin-accretive to the group.
5. End with a short line starting with "**Watch:**" giving ONE recommended action."""


def _generate(summary: dict) -> dict:
    context = _build_context(summary)
    user = (
        "Here is the latest Meridian group financial summary. Write the CFO "
        "synthesis per your instructions.\n\n" + context
    )
    try:
        md = complete(_SYSTEM, user, temperature=0.3, max_tokens=700)
    except Exception as exc:  # noqa: BLE001 — never 500 the page on FM errors
        md = (
            "_The Meridian Synthesizer is temporarily unavailable._\n\n"
            "Group financials loaded successfully; AI synthesis could not be "
            f"generated right now ({type(exc).__name__})."
        )
    return {
        "synthesis_markdown": md,
        "model": SYNTH_MODEL,
        "generated_for_month": summary["latest_month"],
    }


@router.get("/synthesis")
def synthesis(refresh: int = 0):
    """AI synthesis of the financial summary (cached; ?refresh=1 to regenerate)."""
    if refresh or "synthesis" not in _cache:
        _cache["synthesis"] = _generate(compute_summary())
    return _cache["synthesis"]
