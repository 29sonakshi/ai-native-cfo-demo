"""AI-spend API endpoints backed by the meridian_ai gold tables.

The finance tables (meridian_cfo) resolve unqualified against the default
schema; the AI-spend tables live in a different schema so they are referenced
by their fully-qualified names (AI_SPEND_MONTHLY / AI_SPEND_BY_PROVIDER).
Results are cached in memory after the first call (the demo data is static).
"""
from fastapi import APIRouter

from .config import (
    AI_SPEND_BY_PROVIDER,
    AI_SPEND_BY_TEAM,
    AI_SPEND_DETAIL,
    AI_SPEND_MONTHLY,
)
from .sqlexec import run_query

router = APIRouter()

_cache: dict[str, object] = {}


def _cached(key: str, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


@router.get("/ai/overview")
def ai_overview():
    """Latest-month group totals + per-entity AI-spend snapshot."""
    def _run():
        totals = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_MONTHLY})
            SELECT
              SUM(ai_spend_usd)                       AS ai_spend_usd,
              SUM(ai_budget_usd)                      AS ai_budget_usd,
              SUM(ai_spend_usd) / SUM(ai_budget_usd)  AS budget_util_pct,
              SUM(ai_spend_usd) / SUM(net_revenue)    AS ai_pct_revenue,
              SUM(ai_spend_usd) / SUM(opex)           AS ai_pct_opex,
              SUM(run_spend_usd)                      AS run_spend_usd,
              SUM(change_spend_usd)                   AS change_spend_usd,
              SUM(run_spend_usd) / SUM(ai_spend_usd)  AS run_pct
            FROM {AI_SPEND_MONTHLY}
            WHERE month = (SELECT m FROM latest)
            """
        )[0]
        by_entity = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_MONTHLY})
            SELECT entity_id, entity_name,
                   ai_spend_usd, ai_budget_usd, budget_util_pct,
                   ai_pct_revenue, run_pct
            FROM {AI_SPEND_MONTHLY}
            WHERE month = (SELECT m FROM latest)
            ORDER BY ai_spend_usd DESC
            """
        )
        # Token / request volume (not on the monthly fact) — from the detail grain.
        vol = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_DETAIL})
            SELECT SUM(total_tokens) AS total_tokens,
                   SUM(request_count) AS request_count,
                   COUNT(DISTINCT team) AS teams
            FROM {AI_SPEND_DETAIL}
            WHERE month = (SELECT m FROM latest)
            """
        )[0]
        totals["total_tokens"] = vol["total_tokens"]
        totals["request_count"] = vol["request_count"]
        totals["teams"] = vol["teams"]
        latest = run_query(f"SELECT CAST(MAX(month) AS STRING) AS m FROM {AI_SPEND_MONTHLY}")[0]["m"]
        return {"latest_month": latest, "totals": totals, "by_entity": by_entity}

    return _cached("ai_overview", _run)


@router.get("/ai/teams")
def ai_teams(entity_id: str = "ENT03"):
    """Team-level AI-spend attribution for one entity (default Coral Pay / ENT03):
    the per-team breakdown, the top team's model mix, and the Opus->GLM routing lever.
    This is the core of the 'which teams are burning the AI budget' story.
    """
    # entity_id is a query param — whitelist it so it can be safely inlined.
    eid = entity_id if entity_id in ("ENT01", "ENT02", "ENT03") else "ENT03"

    def _sql_str(s: str) -> str:
        return s.replace("'", "''")

    def _run():
        latest = run_query(f"SELECT CAST(MAX(month) AS STRING) AS m FROM {AI_SPEND_BY_TEAM}")[0]["m"]
        ent = run_query(
            f"SELECT DISTINCT entity_name FROM {AI_SPEND_BY_TEAM} WHERE entity_id = '{eid}'"
        )
        entity_name = ent[0]["entity_name"] if ent else eid

        teams = run_query(
            f"""
            SELECT team,
                   spend_usd,
                   total_tokens,
                   request_count,
                   top_model,
                   top_model_pct / 100.0  AS top_model_pct,
                   pct_of_entity / 100.0  AS pct_of_entity
            FROM {AI_SPEND_BY_TEAM}
            WHERE entity_id = '{eid}' AND month = DATE('{latest}')
            ORDER BY spend_usd DESC
            """
        )
        top_team = teams[0]["team"] if teams else None

        # Model mix for the top (runaway) team — the entity->team->model drill.
        model_mix = []
        if top_team:
            model_mix = run_query(
                f"""
                SELECT model, provider, tier,
                       spend_usd, total_tokens,
                       spend_usd / SUM(spend_usd) OVER () AS pct
                FROM {AI_SPEND_DETAIL}
                WHERE entity_id = '{eid}' AND month = DATE('{latest}')
                  AND team = '{_sql_str(top_team)}'
                GROUP BY model, provider, tier, spend_usd, total_tokens
                ORDER BY spend_usd DESC
                """
            )

        # The routing lever: what the top team spends on the premium frontier model,
        # and what those same tokens would cost on the cheap open-weight model (GLM, ~$0.8/Mtok)
        # if 80% of that volume were re-routed.
        lever = run_query(
            f"""
            SELECT
              MAX(model)                                              AS model,
              ROUND(SUM(spend_usd), 0)                                AS premium_spend_usd,
              SUM(total_tokens)                                       AS premium_tokens,
              ROUND(SUM(total_tokens) / 1e6 * 0.8, 0)                 AS glm_cost_if_all,
              ROUND((SUM(spend_usd) - SUM(total_tokens) / 1e6 * 0.8) * 0.8, 0) AS savings_if_80pct
            FROM {AI_SPEND_DETAIL}
            WHERE entity_id = '{eid}' AND month = DATE('{latest}')
              AND team = '{_sql_str(top_team or "")}' AND tier = 'Frontier'
              AND model = 'claude-opus-4-8'
            """
        )
        return {
            "entity_id": eid,
            "entity_name": entity_name,
            "latest_month": latest,
            "teams": teams,
            "top_team": top_team,
            "top_team_model_mix": model_mix,
            "lever": lever[0] if lever else None,
        }

    return _cached(f"ai_teams_{eid}", _run)


@router.get("/ai/trend")
def ai_trend():
    """Monthly group AI spend vs budget and AI-as-%-of-revenue across all months."""
    def _run():
        return run_query(
            f"""
            SELECT CAST(month AS STRING)              AS month,
                   SUM(ai_spend_usd)                  AS ai_spend_usd,
                   SUM(ai_budget_usd)                 AS ai_budget_usd,
                   SUM(ai_spend_usd)/SUM(net_revenue) AS ai_pct_revenue
            FROM {AI_SPEND_MONTHLY}
            GROUP BY month
            ORDER BY month
            """
        )

    return _cached("ai_trend", _run)


@router.get("/ai/providers")
def ai_providers():
    """Latest-month provider mix, tier split, per-entity concentration, model breakdown."""
    def _run():
        group_mix = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_BY_PROVIDER})
            SELECT provider,
                   MAX(tier) AS tier,
                   SUM(spend_usd) AS spend_usd,
                   100.0 * SUM(spend_usd) / SUM(SUM(spend_usd)) OVER () AS pct_of_group
            FROM {AI_SPEND_BY_PROVIDER}
            WHERE month = (SELECT m FROM latest)
            GROUP BY provider
            ORDER BY spend_usd DESC
            """
        )
        tier_split = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_BY_PROVIDER})
            SELECT tier,
                   SUM(spend_usd) AS spend_usd,
                   100.0 * SUM(spend_usd) / SUM(SUM(spend_usd)) OVER () AS pct
            FROM {AI_SPEND_BY_PROVIDER}
            WHERE month = (SELECT m FROM latest)
            GROUP BY tier
            ORDER BY spend_usd DESC
            """
        )
        # Per-entity dominant-provider concentration.
        concentration = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_BY_PROVIDER}),
            by_ent_prov AS (
              SELECT entity_id, entity_name, provider, SUM(spend_usd) AS spend_usd
              FROM {AI_SPEND_BY_PROVIDER}
              WHERE month = (SELECT m FROM latest)
              GROUP BY entity_id, entity_name, provider
            ),
            ranked AS (
              SELECT entity_id, entity_name, provider, spend_usd,
                     SUM(spend_usd) OVER (PARTITION BY entity_id) AS total_spend_usd,
                     ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY spend_usd DESC) AS rn
              FROM by_ent_prov
            )
            SELECT entity_id, entity_name,
                   provider AS top_provider,
                   100.0 * spend_usd / total_spend_usd AS top_pct,
                   total_spend_usd
            FROM ranked
            WHERE rn = 1
            ORDER BY top_pct DESC
            """
        )
        models = run_query(
            f"""
            WITH latest AS (SELECT MAX(month) m FROM {AI_SPEND_BY_PROVIDER})
            SELECT model, MAX(provider) AS provider, MAX(tier) AS tier,
                   SUM(spend_usd) AS spend_usd, SUM(total_tokens) AS total_tokens,
                   SUM(request_count) AS request_count,
                   100.0 * SUM(spend_usd) / SUM(SUM(spend_usd)) OVER () AS pct_of_group
            FROM {AI_SPEND_BY_PROVIDER}
            WHERE month = (SELECT m FROM latest)
            GROUP BY model
            ORDER BY spend_usd DESC
            """
        )
        return {
            "group_mix": group_mix,
            "tier_split": tier_split,
            "concentration": concentration,
            "models": models,
        }

    return _cached("ai_providers", _run)
