# Databricks notebook source
# MAGIC %md
# MAGIC # Meridian AI Cockpit — Create Genie Space
# MAGIC
# MAGIC This notebook creates the Genie space (data room) that powers the
# MAGIC natural-language Q&A in the Meridian CFO Cockpit app.
# MAGIC
# MAGIC **Prerequisites**: Run `01_generate_sample_data` first to create the
# MAGIC Unity Catalog tables.

# COMMAND ----------

dbutils.widgets.text("catalog", "meridian_demo", "UC Catalog")
dbutils.widgets.text("schema_cfo", "meridian_cfo", "CFO Schema")
dbutils.widgets.text("schema_ai", "meridian_ai", "AI Spend Schema")
dbutils.widgets.text("warehouse_id", "", "SQL Warehouse ID")

CATALOG = dbutils.widgets.get("catalog")
SCHEMA_CFO = dbutils.widgets.get("schema_cfo")
SCHEMA_AI = dbutils.widgets.get("schema_ai")
WAREHOUSE_ID = dbutils.widgets.get("warehouse_id")

assert WAREHOUSE_ID, "Please provide a SQL Warehouse ID in the widget above."

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# All tables that the Genie space will have access to
table_ids = [
    f"{CATALOG}.{SCHEMA_CFO}.dim_entity",
    f"{CATALOG}.{SCHEMA_CFO}.fact_financials_monthly",
    f"{CATALOG}.{SCHEMA_CFO}.fact_cash_monthly",
    f"{CATALOG}.{SCHEMA_CFO}.fact_revenue_bridge_monthly",
    f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_monthly",
    f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_by_provider",
    f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_by_team",
    f"{CATALOG}.{SCHEMA_AI}.fact_ai_spend_detail",
]

print(f"Tables for Genie space: {table_ids}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create the Genie Space
# MAGIC
# MAGIC The Genie space combines finance and AI-spend tables into a single
# MAGIC natural-language Q&A agent. The description provides context so Genie
# MAGIC understands the domain.

# COMMAND ----------

from databricks.sdk.service.dashboards import GenieCreateRequestTableIdentifier

space = w.genie.create(
    space_name="Meridian AI Cockpit Genie",
    warehouse_id=WAREHOUSE_ID,
    description=(
        "Meridian Bank CFO cockpit: group-level P&L, cash flow, revenue bridge, "
        "and AI infrastructure spend across Meridian Bank (US parent), Northcrest "
        "Financial (Canada subsidiary), and Coral Pay (Australia subsidiary). "
        "Finance data covers Jan 2024–May 2026; AI spend covers Jun 2025–May 2026. "
        "Coral Pay is the at-risk entity with negative FCF and ~10 months runway. "
        "AI spend tables track provider/model/team/workload breakdowns — Coral Pay is "
        "massively over-budget, driven by the Data Science team's heavy claude-opus-4-8 usage."
    ),
    table_identifiers=[
        GenieCreateRequestTableIdentifier(table_identifier=t)
        for t in table_ids
    ],
)

print(f"\nGenie Space created successfully!")
print(f"  Space ID:   {space.space_id}")
print(f"  Space Name: {space.space_name}")
print(f"\nCopy the Space ID into your app.yaml as GENIE_SPACE_ID.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Grant Permissions
# MAGIC
# MAGIC The app's service principal needs CAN_QUERY on the Genie space.
# MAGIC After you create the Databricks App, find the service principal name
# MAGIC (e.g., `app-xxxxx meridian-ai-cockpit`) and run the cell below.

# COMMAND ----------

# Uncomment and fill in after creating the app:
# from databricks.sdk.service.dashboards import GeniePermission, GeniePermissionLevel
# w.genie.update_permissions(
#     space_id=space.space_id,
#     permissions=[
#         GeniePermission(
#             principal="<app-service-principal-name>",
#             permission_level=GeniePermissionLevel.CAN_QUERY,
#         )
#     ],
# )
# print("Permissions granted.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Next Steps
# MAGIC
# MAGIC 1. Copy the **Space ID** printed above into `app.yaml` as `GENIE_SPACE_ID`.
# MAGIC 2. Create the Databricks App: `databricks apps create meridian-ai-cockpit`
# MAGIC 3. Deploy: `databricks apps deploy meridian-ai-cockpit --source-code-path <path>`
# MAGIC 4. Grant the app's service principal:
# MAGIC    - `USE CATALOG` and `SELECT` on the UC tables
# MAGIC    - `CAN_QUERY` on the Genie space (cell above)
# MAGIC    - Access to the SQL warehouse
# MAGIC    - Access to the Foundation Model serving endpoint (for AI synthesis)
