# Databricks notebook source
# MAGIC %md
# MAGIC # Meridian AI Cockpit — Sample Data Generator
# MAGIC
# MAGIC Run this notebook in a Databricks workspace to create the Unity Catalog
# MAGIC tables that power the Meridian Bank CFO Cockpit demo.
# MAGIC
# MAGIC **Before running**, set the widgets below to match your catalog/schema names.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

dbutils.widgets.text("catalog", "meridian_demo", "UC Catalog")
dbutils.widgets.text("schema_cfo", "meridian_cfo", "CFO Schema")
dbutils.widgets.text("schema_ai", "meridian_ai", "AI Spend Schema")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA_CFO = dbutils.widgets.get("schema_cfo")
SCHEMA_AI = dbutils.widgets.get("schema_ai")

print(f"Target: {CATALOG}.{SCHEMA_CFO} / {CATALOG}.{SCHEMA_AI}")

# COMMAND ----------

spark.sql(f"CREATE CATALOG IF NOT EXISTS {CATALOG}")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA_CFO}")
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA_AI}")
print("Catalog and schemas created.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Entity Dimension

# COMMAND ----------

from pyspark.sql import Row
from pyspark.sql.types import *
from datetime import date
import math

entities = [
    Row(
        entity_id="ENT01", entity_name="Meridian Bank", geography="US",
        country_code="US", reporting_currency="USD", entity_type="Parent",
        is_parent=True, acquired_date=None, acquisition_price_usd=None,
        employees=3200, founded_year=2014,
        description="Parent digital bank & payments platform, HQ San Francisco. Profitable, generates cash."
    ),
    Row(
        entity_id="ENT02", entity_name="Northcrest Financial", geography="Canada",
        country_code="CA", reporting_currency="USD", entity_type="Subsidiary",
        is_parent=False, acquired_date=date(2025, 4, 15), acquisition_price_usd=4.2e8,
        employees=640, founded_year=2017,
        description="Canadian digital lending & payments. Acquired 2025 — margin-accretive, improving gross margin."
    ),
    Row(
        entity_id="ENT03", entity_name="Coral Pay", geography="Australia",
        country_code="AU", reporting_currency="USD", entity_type="Subsidiary",
        is_parent=False, acquired_date=date(2025, 6, 30), acquisition_price_usd=5.1e8,
        employees=520, founded_year=2019,
        description="Australian payments / marketplace platform. Acquired 2025 — high GMV growth but cash-intensive: negative free cash flow and the shortest runway in the group."
    ),
]

schema_dim = StructType([
    StructField("entity_id", StringType()),
    StructField("entity_name", StringType()),
    StructField("geography", StringType()),
    StructField("country_code", StringType()),
    StructField("reporting_currency", StringType()),
    StructField("entity_type", StringType()),
    StructField("is_parent", BooleanType()),
    StructField("acquired_date", DateType()),
    StructField("acquisition_price_usd", DoubleType()),
    StructField("employees", IntegerType()),
    StructField("founded_year", IntegerType()),
    StructField("description", StringType()),
])

df_dim = spark.createDataFrame(entities, schema=schema_dim)
df_dim.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_CFO}.dim_entity")
spark.sql(f"COMMENT ON TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity IS 'Entity master for Meridian Bank group: the parent plus two recently-acquired subsidiaries.'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN entity_id COMMENT 'Unique entity identifier'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN entity_name COMMENT 'Entity / company name'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN geography COMMENT 'Primary operating geography (US, Canada, Australia)'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN country_code COMMENT 'ISO country code'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN reporting_currency COMMENT 'Reporting currency (all USD — consolidated)'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN entity_type COMMENT 'Parent or Subsidiary'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN is_parent COMMENT 'True for the parent holding entity (Meridian Bank)'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN acquired_date COMMENT 'Date the subsidiary was acquired by Meridian Bank (NULL for parent)'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN acquisition_price_usd COMMENT 'Acquisition purchase price in USD (NULL for parent)'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN employees COMMENT 'Approximate headcount'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN founded_year COMMENT 'Year founded'")
spark.sql(f"ALTER TABLE {CATALOG}.{SCHEMA_CFO}.dim_entity ALTER COLUMN description COMMENT 'Short business description and CFO storyline note'")
print("dim_entity created.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Financial Fact Tables (CFO Schema)
# MAGIC
# MAGIC Generates 29 months of data (Jan 2024 – May 2026) for three entities.
# MAGIC
# MAGIC Storyline:
# MAGIC - **ENT01 (Meridian Bank)**: Steady, profitable parent — 66% margin, positive FCF, growing ARR.
# MAGIC - **ENT02 (Northcrest Financial)**: Recently acquired, improving margin from 56% to 66%, turning FCF-positive.
# MAGIC - **ENT03 (Coral Pay)**: High-growth but cash-burning — low 42-43% margin, negative EBITDA/FCF, ~10 months runway at end.

# COMMAND ----------

from datetime import date
from dateutil.relativedelta import relativedelta
import random

random.seed(42)

# Month range: Jan 2024 – May 2026
start_month = date(2024, 1, 1)
months = [start_month + relativedelta(months=i) for i in range(29)]

# --- Entity profiles ---
# Each entity has a base net_revenue, monthly growth rate, starting gross margin,
# margin drift per month, opex-to-revenue ratio, and starting cash balance.

profiles = {
    "ENT01": {
        "name": "Meridian Bank", "geo": "US",
        "base_rev": 106_250_000, "growth": 0.0038,
        "start_gm": 0.6600, "gm_drift": 0.0007,
        "opex_ratio": 0.58, "opex_drift": -0.001,
        "start_cash": 2_400_000_000,
        # Revenue bridge ratios (fraction of gross GMV)
        "gmv_multiple": 1.42,  # gross_gmv = net_rev * gmv_multiple
        "refund_pct": 0.04, "discount_pct": 0.06, "partner_pct": 0.20,
    },
    "ENT02": {
        "name": "Northcrest Financial", "geo": "Canada",
        "base_rev": 28_169_134, "growth": 0.0020,
        "start_gm": 0.5600, "gm_drift": 0.0035,
        "opex_ratio": 0.56, "opex_drift": -0.002,
        "start_cash": 340_000_000,
        "gmv_multiple": 1.55, "refund_pct": 0.05, "discount_pct": 0.07, "partner_pct": 0.23,
    },
    "ENT03": {
        "name": "Coral Pay", "geo": "Australia",
        "base_rev": 5_522_798, "growth": 0.0050,
        "start_gm": 0.4200, "gm_drift": 0.0005,
        "opex_ratio": 1.05, "opex_drift": 0.002,
        "start_cash": 350_000_000,
        "gmv_multiple": 1.80, "refund_pct": 0.06, "discount_pct": 0.08, "partner_pct": 0.30,
    },
}

fin_rows = []
cash_rows = []
bridge_rows = []

for eid, p in profiles.items():
    cash = p["start_cash"]
    for i, m in enumerate(months):
        # Revenue with small noise
        noise = random.uniform(-0.005, 0.005)
        net_rev = p["base_rev"] * ((1 + p["growth"]) ** i) * (1 + noise)

        # Gross margin drifts
        gm = min(0.72, p["start_gm"] + p["gm_drift"] * i)
        cogs = net_rev * (1 - gm)
        gross_profit = net_rev * gm

        # Opex
        opex_ratio = p["opex_ratio"] + p["opex_drift"] * i * 0.1
        opex = net_rev * opex_ratio
        ebitda = gross_profit - opex
        arr = net_rev * 12 * (0.70 + 0.001 * i)  # ARR = ~70-73% of annualized revenue

        fin_rows.append(Row(
            month=m, entity_id=eid, entity_name=p["name"], geography=p["geo"],
            net_revenue=round(net_rev, 2), cogs=round(cogs, 2),
            gross_profit=round(gross_profit, 2),
            gross_margin_pct=round(gm, 4),
            opex=round(opex, 2), ebitda=round(ebitda, 2), arr=round(arr, 2),
        ))

        # Cash flow: FCF = EBITDA * 0.9 - net_rev * 0.045
        fcf = ebitda * 0.9 - net_rev * 0.045
        ocf = ebitda * 0.9
        icf = -net_rev * 0.045
        burn = max(0.0, -fcf)
        cash = cash + fcf
        runway = (cash / burn) if burn > 0 else None

        cash_rows.append(Row(
            month=m, entity_id=eid, entity_name=p["name"], geography=p["geo"],
            operating_cash_flow=round(ocf, 2), investing_cash_flow=round(icf, 2),
            financing_cash_flow=0.0,
            free_cash_flow=round(fcf, 2), burn_rate=round(burn, 2),
            cash_balance=round(cash, 2), runway_months=round(runway, 1) if runway else None,
        ))

        # Revenue bridge
        gmv = net_rev * p["gmv_multiple"]
        refunds = -gmv * p["refund_pct"]
        discounts = -gmv * p["discount_pct"]
        partner = -gmv * p["partner_pct"]
        bridge_nr = gmv + refunds + discounts + partner  # ≈ net_rev

        bridge_rows.append(Row(
            month=m, entity_id=eid, entity_name=p["name"], geography=p["geo"],
            gross_gmv=round(gmv, 2),
            refunds_returns=round(refunds, 2),
            discounts_promos=round(discounts, 2),
            partner_payouts=round(partner, 2),
            net_revenue=round(bridge_nr, 2),
        ))

print(f"Generated {len(fin_rows)} financials, {len(cash_rows)} cash, {len(bridge_rows)} bridge rows.")

# COMMAND ----------

# Write CFO fact tables
df_fin = spark.createDataFrame(fin_rows)
df_fin.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_CFO}.fact_financials_monthly")
spark.sql(f"COMMENT ON TABLE {CATALOG}.{SCHEMA_CFO}.fact_financials_monthly IS 'Monthly P&L metrics per entity: net revenue, COGS, gross profit, gross margin %, opex, EBITDA, and ARR.'")

df_cash = spark.createDataFrame(cash_rows)
df_cash.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_CFO}.fact_cash_monthly")
spark.sql(f"COMMENT ON TABLE {CATALOG}.{SCHEMA_CFO}.fact_cash_monthly IS 'Monthly cash flow & liquidity per entity: operating/investing/financing cash flow, free cash flow, burn rate, end-of-month cash balance, and runway in months.'")

df_bridge = spark.createDataFrame(bridge_rows)
df_bridge.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_CFO}.fact_revenue_bridge_monthly")
spark.sql(f"COMMENT ON TABLE {CATALOG}.{SCHEMA_CFO}.fact_revenue_bridge_monthly IS 'Monthly revenue bridge per entity: Gross GMV less Refunds & Returns, Discounts & Promos, and Partner Payouts equals Net Revenue. The hero waterfall chart.'")

print("CFO fact tables written.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. AI Spend Tables (AI Schema)
# MAGIC
# MAGIC 12 months of AI spend data (Jun 2025 – May 2026) across 3 entities,
# MAGIC 5 teams, 4 providers (5 models), 2 workloads (run/change).
# MAGIC
# MAGIC Key story: Coral Pay (ENT03) is massively over-budget on AI, with the
# MAGIC Data Science team's heavy use of claude-opus-4-8 (frontier tier) as the
# MAGIC main culprit — routing 80% of that to glm-5-3 (open-weight) would save ~$500K/month.

# COMMAND ----------

# AI data: Jun 2025 – May 2026
ai_months = [date(2025, 6, 1) + relativedelta(months=i) for i in range(12)]

# Provider/model definitions
models = [
    {"provider": "Anthropic", "tier": "Frontier", "model": "claude-opus-4-8"},
    {"provider": "Anthropic", "tier": "Frontier", "model": "claude-sonnet-5"},
    {"provider": "OpenAI", "tier": "Frontier", "model": "gpt-5-6"},
    {"provider": "Google", "tier": "Frontier", "model": "gemini-3-pro"},
    {"provider": "Z.ai", "tier": "Open-weight", "model": "glm-5-3"},
]

teams = [
    "Customer Support Copilot",
    "Data Science (ad-hoc)",
    "Engineering Copilots",
    "Fraud & Risk ML",
    "Growth / Personalization",
]

# Base monthly AI spend per entity
ai_profiles = {
    "ENT01": {"name": "Meridian Bank", "geo": "US", "base_spend": 584_400, "budget": 1_150_000, "growth": 0.055},
    "ENT02": {"name": "Northcrest Financial", "geo": "Canada", "base_spend": 183_670, "budget": 390_000, "growth": 0.055},
    "ENT03": {"name": "Coral Pay", "geo": "Australia", "base_spend": 1_669_726, "budget": 1_000_000, "growth": 0.055},
}

# Team spend allocation (fraction of entity total) — Coral Pay's Data Science is the runaway team
team_alloc = {
    "ENT01": {"Customer Support Copilot": 0.238, "Data Science (ad-hoc)": 0.190, "Engineering Copilots": 0.190, "Fraud & Risk ML": 0.286, "Growth / Personalization": 0.095},
    "ENT02": {"Customer Support Copilot": 0.212, "Data Science (ad-hoc)": 0.242, "Engineering Copilots": 0.152, "Fraud & Risk ML": 0.303, "Growth / Personalization": 0.091},
    "ENT03": {"Customer Support Copilot": 0.150, "Data Science (ad-hoc)": 0.483, "Engineering Copilots": 0.083, "Fraud & Risk ML": 0.233, "Growth / Personalization": 0.050},
}

# Team -> primary model mapping (for top_model in by_team table)
team_primary_model = {
    "Customer Support Copilot": "gpt-5-6",
    "Data Science (ad-hoc)": "claude-opus-4-8",  # This is the problem for ENT03
    "Engineering Copilots": "claude-opus-4-8",
    "Fraud & Risk ML": "glm-5-3",
    "Growth / Personalization": "gemini-3-pro",
}

# Override for ENT01/ENT02 Data Science — they use glm-5-3 (cheap) as primary
team_primary_model_overrides = {
    "ENT01": {"Data Science (ad-hoc)": "glm-5-3"},
    "ENT02": {"Data Science (ad-hoc)": "glm-5-3"},
}

# Run vs change split
RUN_PCT = 0.619  # for ENT01/ENT02
RUN_PCT_ENT03 = 0.4333

ai_monthly_rows = []
ai_provider_rows = []
ai_team_rows = []
ai_detail_rows = []

for eid, ap in ai_profiles.items():
    for mi, m in enumerate(ai_months):
        total_spend = ap["base_spend"] * ((1 + ap["growth"]) ** mi)
        budget = ap["budget"]

        # Get corresponding net_rev and opex from the financial data for this month
        # (approximate: look up from fin_rows)
        fin_match = [r for r in fin_rows if r.entity_id == eid and r.month == m]
        net_rev = fin_match[0].net_revenue if fin_match else total_spend * 10
        opex = fin_match[0].opex if fin_match else total_spend * 5

        run_pct = RUN_PCT if eid != "ENT03" else RUN_PCT_ENT03
        run_spend = total_spend * run_pct
        change_spend = total_spend * (1 - run_pct)

        ai_monthly_rows.append(Row(
            month=m, entity_id=eid, entity_name=ap["name"], geography=ap["geo"],
            ai_spend_usd=round(total_spend, 2),
            ai_budget_usd=float(budget),
            budget_util_pct=round(total_spend / budget, 4),
            run_spend_usd=round(run_spend, 2),
            change_spend_usd=round(change_spend, 2),
            run_pct=round(run_pct, 4),
            net_revenue=round(net_rev, 2),
            opex=round(opex, 2),
            ai_pct_revenue=round(total_spend / net_rev, 4),
            ai_pct_opex=round(total_spend / opex, 4),
        ))

        # --- By provider ---
        # Distribute spend across models. Coral Pay is Anthropic-heavy (opus).
        if eid == "ENT03":
            model_split = {"claude-opus-4-8": 0.517, "claude-sonnet-5": 0.133, "gpt-5-6": 0.167, "gemini-3-pro": 0.033, "glm-5-3": 0.150}
        elif eid == "ENT01":
            model_split = {"claude-opus-4-8": 0.114, "claude-sonnet-5": 0.190, "gpt-5-6": 0.219, "gemini-3-pro": 0.057, "glm-5-3": 0.419}
        else:  # ENT02
            model_split = {"claude-opus-4-8": 0.000, "claude-sonnet-5": 0.121, "gpt-5-6": 0.212, "gemini-3-pro": 0.061, "glm-5-3": 0.606}

        for mod_info in models:
            mod = mod_info["model"]
            frac = model_split.get(mod, 0)
            if frac == 0:
                continue
            mod_spend = total_spend * frac
            # Token count: frontier models ~$10-30/Mtok, open-weight ~$0.8/Mtok
            cost_per_mtok = 0.8 if mod_info["tier"] == "Open-weight" else (30.0 if "opus" in mod else 9.0)
            tokens = int(mod_spend / cost_per_mtok * 1_000_000)
            reqs = 30 * max(1, int(frac * 4))  # 30-120 requests

            ai_provider_rows.append(Row(
                month=m, entity_id=eid, entity_name=ap["name"],
                provider=mod_info["provider"], tier=mod_info["tier"], model=mod,
                spend_usd=round(mod_spend, 2), total_tokens=tokens, request_count=reqs,
            ))

        # --- By team ---
        allocs = team_alloc[eid]
        for team_name in teams:
            t_frac = allocs[team_name]
            t_spend = total_spend * t_frac
            # Tokens: rough estimate based on spend
            t_tokens = int(t_spend / 2.0 * 1_000_000)  # ~$2/Mtok average
            t_reqs = 60
            primary = team_primary_model_overrides.get(eid, {}).get(team_name, team_primary_model[team_name])
            primary_pct = random.uniform(55, 90)

            ai_team_rows.append(Row(
                month=m, entity_id=eid, entity_name=ap["name"],
                team=team_name, spend_usd=round(t_spend, 2),
                total_tokens=t_tokens, request_count=t_reqs,
                top_model=primary, top_model_pct=round(primary_pct, 1),
                pct_of_entity=round(t_frac * 100, 1),
            ))

            # --- Detail: split each team into run/change x 2 models ---
            for workload, w_pct in [("run", run_pct), ("change", 1 - run_pct)]:
                w_spend = t_spend * w_pct
                # Split between primary model (60%) and secondary (40%)
                primary_mod_info = next(mi for mi in models if mi["model"] == primary)
                secondary_choices = [mi for mi in models if mi["model"] != primary]
                secondary_mod = random.choice(secondary_choices)

                for mod_i, (mod_def, s_pct) in enumerate([(primary_mod_info, 0.6), (secondary_mod, 0.4)]):
                    d_spend = w_spend * s_pct
                    cost_per_mtok = 0.8 if mod_def["tier"] == "Open-weight" else (30.0 if "opus" in mod_def["model"] else 9.0)
                    d_tokens = int(d_spend / cost_per_mtok * 1_000_000)
                    d_reqs = 30

                    ai_detail_rows.append(Row(
                        month=m, entity_id=eid, entity_name=ap["name"],
                        team=team_name, workload=workload,
                        provider=mod_def["provider"], tier=mod_def["tier"],
                        model=mod_def["model"],
                        spend_usd=round(d_spend, 2),
                        total_tokens=d_tokens, request_count=d_reqs,
                    ))

print(f"AI rows: monthly={len(ai_monthly_rows)}, provider={len(ai_provider_rows)}, team={len(ai_team_rows)}, detail={len(ai_detail_rows)}")

# COMMAND ----------

# Write AI tables
df_ai_monthly = spark.createDataFrame(ai_monthly_rows)
df_ai_monthly.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_monthly")

df_ai_prov = spark.createDataFrame(ai_provider_rows)
df_ai_prov.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_by_provider")

df_ai_team = spark.createDataFrame(ai_team_rows)
df_ai_team.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_by_team")

df_ai_detail = spark.createDataFrame(ai_detail_rows)
df_ai_detail.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_detail")

print("All AI spend tables written.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verification

# COMMAND ----------

for schema in [SCHEMA_CFO, SCHEMA_AI]:
    print(f"\n--- {CATALOG}.{schema} ---")
    tables = spark.sql(f"SHOW TABLES IN {CATALOG}.{schema}").collect()
    for t in tables:
        tname = f"{CATALOG}.{schema}.{t.tableName}"
        cnt = spark.sql(f"SELECT COUNT(*) AS cnt FROM {tname}").collect()[0]["cnt"]
        print(f"  {t.tableName}: {cnt} rows")

print("\nDone! All sample data tables created successfully.")
