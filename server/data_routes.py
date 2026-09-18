"""Data API endpoints backed by the Unity Catalog gold tables.

Results are cached in memory after the first call (the demo data is static).
"""
from fastapi import APIRouter

from .sqlexec import run_query

router = APIRouter()

_cache: dict[str, object] = {}


def _cached(key: str, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


@router.get("/kpis")
def kpis():
    """Group-level focus KPIs for the latest month."""
    def _run():
        rows = run_query(
            """
            WITH latest AS (SELECT MAX(month) m FROM fact_financials_monthly)
            SELECT
              SUM(f.arr)                              AS arr,
              SUM(f.gross_profit) / SUM(f.net_revenue) AS gross_margin_pct,
              SUM(f.net_revenue)                      AS net_revenue,
              SUM(c.burn_rate)                        AS burn_rate,
              SUM(c.free_cash_flow)                   AS free_cash_flow,
              SUM(c.cash_balance)                     AS cash_balance,
              SUM(b.gross_gmv)                        AS gross_gmv
            FROM fact_financials_monthly f
            JOIN fact_cash_monthly c ON f.month = c.month AND f.entity_id = c.entity_id
            JOIN fact_revenue_bridge_monthly b ON f.month = b.month AND f.entity_id = b.entity_id
            WHERE f.month = (SELECT m FROM latest)
            """
        )
        latest = run_query("SELECT CAST(MAX(month) AS STRING) AS latest_month FROM fact_financials_monthly")
        out = rows[0]
        out["latest_month"] = latest[0]["latest_month"]
        return out

    return _cached("kpis", _run)


@router.get("/revenue-bridge")
def revenue_bridge():
    """Group revenue bridge (waterfall) for the latest month."""
    def _run():
        return run_query(
            """
            SELECT
              SUM(gross_gmv)        AS gross_gmv,
              SUM(refunds_returns)  AS refunds_returns,
              SUM(discounts_promos) AS discounts_promos,
              SUM(partner_payouts)  AS partner_payouts,
              SUM(net_revenue)      AS net_revenue
            FROM fact_revenue_bridge_monthly
            WHERE month = (SELECT MAX(month) FROM fact_revenue_bridge_monthly)
            """
        )[0]

    return _cached("revenue-bridge", _run)


@router.get("/trends")
def trends():
    """Monthly group net revenue and ARR trend across all months."""
    def _run():
        return run_query(
            """
            SELECT
              CAST(month AS STRING) AS month,
              SUM(net_revenue)      AS net_revenue,
              SUM(arr)              AS arr,
              SUM(gross_profit) / SUM(net_revenue) AS gross_margin_pct
            FROM fact_financials_monthly
            GROUP BY month
            ORDER BY month
            """
        )

    return _cached("trends", _run)


@router.get("/geo")
def geo():
    """Latest-month net revenue rollup by geography."""
    def _run():
        return run_query(
            """
            SELECT geography,
                   SUM(net_revenue) AS net_revenue,
                   SUM(arr)         AS arr
            FROM fact_financials_monthly
            WHERE month = (SELECT MAX(month) FROM fact_financials_monthly)
            GROUP BY geography
            ORDER BY net_revenue DESC
            """
        )

    return _cached("geo", _run)


@router.get("/entities")
def entities():
    """Per-entity latest-month snapshot plus dim attributes."""
    def _run():
        snapshot = run_query(
            """
            WITH latest AS (SELECT MAX(month) m FROM fact_financials_monthly)
            SELECT
              d.entity_id, d.entity_name, d.geography, d.country_code,
              d.entity_type, d.is_parent,
              CAST(d.acquired_date AS STRING) AS acquired_date,
              d.acquisition_price_usd, d.employees, d.founded_year, d.description,
              f.net_revenue, f.gross_margin_pct, f.ebitda, f.arr,
              c.free_cash_flow, c.cash_balance, c.burn_rate, c.runway_months
            FROM dim_entity d
            JOIN fact_financials_monthly f
              ON d.entity_id = f.entity_id AND f.month = (SELECT m FROM latest)
            JOIN fact_cash_monthly c
              ON d.entity_id = c.entity_id AND c.month = (SELECT m FROM latest)
            ORDER BY f.net_revenue DESC
            """
        )
        # Net revenue trend by entity (for small-multiples / comparison chart).
        trend = run_query(
            """
            SELECT CAST(month AS STRING) AS month, entity_name,
                   net_revenue, gross_margin_pct
            FROM fact_financials_monthly
            ORDER BY month
            """
        )
        return {"snapshot": snapshot, "trend": trend}

    return _cached("entities", _run)


@router.get("/cash")
def cash():
    """Cash & liquidity: latest-month per-entity cash + runway, and runway trend."""
    def _run():
        snapshot = run_query(
            """
            WITH latest AS (SELECT MAX(month) m FROM fact_cash_monthly)
            SELECT
              c.entity_name, c.geography,
              c.cash_balance, c.burn_rate, c.free_cash_flow, c.runway_months
            FROM fact_cash_monthly c
            WHERE c.month = (SELECT m FROM latest)
            ORDER BY c.cash_balance DESC
            """
        )
        totals = run_query(
            """
            SELECT
              SUM(cash_balance)   AS cash_balance,
              SUM(burn_rate)      AS burn_rate,
              SUM(free_cash_flow) AS free_cash_flow
            FROM fact_cash_monthly
            WHERE month = (SELECT MAX(month) FROM fact_cash_monthly)
            """
        )[0]
        # Limit to the most recent 12 months so the shrinking-runway story is
        # legible (early months have very high runway that compresses the chart).
        runway_trend = run_query(
            """
            WITH latest AS (SELECT MAX(month) m FROM fact_cash_monthly)
            SELECT CAST(month AS STRING) AS month, entity_name, runway_months
            FROM fact_cash_monthly
            WHERE runway_months IS NOT NULL
              AND month >= add_months((SELECT m FROM latest), -11)
            ORDER BY month
            """
        )
        cash_trend = run_query(
            """
            SELECT CAST(month AS STRING) AS month, entity_name, cash_balance
            FROM fact_cash_monthly
            ORDER BY month
            """
        )
        return {
            "snapshot": snapshot,
            "totals": totals,
            "runway_trend": runway_trend,
            "cash_trend": cash_trend,
        }

    return _cached("cash", _run)


# Ordered line items for the financial summary table. Each tuple is
# (metric label, unit, favorable_when). 'usd' values are dollars; 'pct' is a
# 0-1 ratio. favorable_when='up' means an increase is good (green); 'down'
# means an increase is bad (red).
_SUMMARY_ITEMS = [
    ("Gross GMV", "usd", "up"),
    ("Refunds & Returns", "usd", "down"),
    ("Discounts & Promos", "usd", "down"),
    ("Partner Payouts", "usd", "down"),
    ("Net Revenue", "usd", "up"),
    ("COGS", "usd", "down"),
    ("Gross Profit", "usd", "up"),
    ("Gross Margin %", "pct", "up"),
    ("Opex", "usd", "down"),
    ("EBITDA", "usd", "up"),
    ("ARR", "usd", "up"),
    ("Free Cash Flow", "usd", "up"),
    ("Burn Rate", "usd", "down"),
    ("Cash Balance", "usd", "up"),
]

# Map each metric label to the SQL alias produced by the rollup query below.
_SUMMARY_KEYS = {
    "Gross GMV": "gross_gmv",
    "Refunds & Returns": "refunds_returns",
    "Discounts & Promos": "discounts_promos",
    "Partner Payouts": "partner_payouts",
    "Net Revenue": "net_revenue",
    "COGS": "cogs",
    "Gross Profit": "gross_profit",
    "Gross Margin %": "gross_margin_pct",
    "Opex": "opex",
    "EBITDA": "ebitda",
    "ARR": "arr",
    "Free Cash Flow": "free_cash_flow",
    "Burn Rate": "burn_rate",
    "Cash Balance": "cash_balance",
}

# Single SELECT body that rolls up every line item for one month, joined across
# the three fact tables. {agg} wraps each column so we can reuse it for the
# group total (SUM) and per-entity rows (no aggregation, grouped by entity).
def _summary_select(agg_open: str, agg_close: str) -> str:
    a, z = agg_open, agg_close
    return f"""
      {a}b.gross_gmv{z}                                    AS gross_gmv,
      {a}b.refunds_returns{z}                              AS refunds_returns,
      {a}b.discounts_promos{z}                             AS discounts_promos,
      {a}b.partner_payouts{z}                              AS partner_payouts,
      {a}f.net_revenue{z}                                  AS net_revenue,
      {a}f.cogs{z}                                         AS cogs,
      {a}f.gross_profit{z}                                 AS gross_profit,
      {a}f.gross_profit{z} / {a}f.net_revenue{z}           AS gross_margin_pct,
      {a}f.opex{z}                                         AS opex,
      {a}f.ebitda{z}                                       AS ebitda,
      {a}f.arr{z}                                          AS arr,
      {a}c.free_cash_flow{z}                               AS free_cash_flow,
      {a}c.burn_rate{z}                                    AS burn_rate,
      {a}c.cash_balance{z}                                 AS cash_balance
    """


_SUMMARY_FROM = """
    FROM fact_financials_monthly f
    JOIN fact_cash_monthly c ON f.month = c.month AND f.entity_id = c.entity_id
    JOIN fact_revenue_bridge_monthly b ON f.month = b.month AND f.entity_id = b.entity_id
"""


def compute_summary() -> dict:
    """Compute the financial summary payload (cached). Reused by /summary and
    the Claude synthesis route so both see identical numbers."""

    def _pct_change(curr, base):
        if curr is None or base is None or base == 0:
            return None
        return (curr - base) / abs(base)

    def _run():
        latest = run_query("SELECT CAST(MAX(month) AS STRING) AS m FROM fact_financials_monthly")[0]["m"]

        # Group rollup for latest, prior month (-1) and year-ago (-12).
        def _group_for(offset: int):
            sel = _summary_select("SUM(", ")")
            rows = run_query(
                f"""
                WITH latest AS (SELECT MAX(month) m FROM fact_financials_monthly)
                SELECT {sel}
                {_SUMMARY_FROM}
                WHERE f.month = add_months((SELECT m FROM latest), {offset})
                """
            )
            return rows[0] if rows else {}

        cur = _group_for(0)
        prior = _group_for(-1)
        yoy = _group_for(-12)

        group = []
        for metric, unit, fav in _SUMMARY_ITEMS:
            key = _SUMMARY_KEYS[metric]
            c_val = cur.get(key)
            p_val = prior.get(key)
            y_val = yoy.get(key)
            if unit == "pct":
                # Express change in percentage points (pp) of the ratio itself.
                mom = (c_val - p_val) if (c_val is not None and p_val is not None) else None
                yoy_chg = (c_val - y_val) if (c_val is not None and y_val is not None) else None
                group.append({
                    "metric": metric, "unit": unit,
                    "current": c_val, "prior": p_val,
                    "mom_pct": mom, "yoy": y_val, "yoy_pct": yoy_chg,
                    "favorable_when": fav,
                })
            else:
                group.append({
                    "metric": metric, "unit": unit,
                    "current": c_val, "prior": p_val,
                    "mom_pct": _pct_change(c_val, p_val),
                    "yoy": y_val, "yoy_pct": _pct_change(c_val, y_val),
                    "favorable_when": fav,
                })

        # Per-entity latest + prior (for MoM) — one row per entity per month.
        def _by_entity_for(offset: int):
            sel = _summary_select("", "")
            return run_query(
                f"""
                WITH latest AS (SELECT MAX(month) m FROM fact_financials_monthly)
                SELECT f.entity_id, f.entity_name, {sel}
                {_SUMMARY_FROM}
                WHERE f.month = add_months((SELECT m FROM latest), {offset})
                ORDER BY f.net_revenue DESC
                """
            )

        ent_cur = _by_entity_for(0)
        ent_prior = {r["entity_id"]: r for r in _by_entity_for(-1)}

        entities_meta = [
            {"entity_id": r["entity_id"], "entity_name": r["entity_name"]}
            for r in ent_cur
        ]
        rows_by_entity = []
        for metric, unit, fav in _SUMMARY_ITEMS:
            key = _SUMMARY_KEYS[metric]
            values: dict[str, object] = {}
            moms: dict[str, object] = {}
            for r in ent_cur:
                eid = r["entity_id"]
                c_val = r.get(key)
                p_val = ent_prior.get(eid, {}).get(key)
                values[eid] = c_val
                if unit == "pct":
                    moms[eid] = (c_val - p_val) if (c_val is not None and p_val is not None) else None
                else:
                    moms[eid] = _pct_change(c_val, p_val)
            rows_by_entity.append({
                "metric": metric, "unit": unit, "favorable_when": fav,
                "values": values, "mom": moms,
            })

        return {
            "latest_month": latest,
            "group": group,
            "by_entity": {"entities": entities_meta, "rows": rows_by_entity},
        }

    return _cached("summary", _run)


@router.get("/summary")
def summary():
    """Financial summary: group rollup (latest/prior/MoM/YoY) + per-entity latest."""
    return compute_summary()
