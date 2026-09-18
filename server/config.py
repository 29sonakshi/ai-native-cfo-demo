"""Dual-mode auth + workspace configuration for the Meridian AI Cockpit app.

Local dev: uses the Databricks CLI profile (DATABRICKS_PROFILE).
Databricks Apps (remote): uses the auto-injected service principal credentials.
"""
import os
from functools import lru_cache

from databricks.sdk import WorkspaceClient

# Databricks Apps injects DATABRICKS_APP_NAME at runtime.
IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))

# All workspace-specific values come from environment variables (set in
# app.yaml for a deployed Databricks App, or via a local .env / shell for dev).
# See .env.example and the README setup runbook.
WAREHOUSE_ID = os.environ.get("WAREHOUSE_ID", "")
UC_CATALOG = os.environ.get("UC_CATALOG", "meridian_demo")
UC_SCHEMA = os.environ.get("UC_SCHEMA", "meridian_cfo")
UC_SCHEMA_AI = os.environ.get("UC_SCHEMA_AI", "meridian_ai")
# Combined finance + AI-spend Genie agent (Meridian AI Cockpit Genie).
GENIE_SPACE_ID = os.environ.get("GENIE_SPACE_ID", "")

# Fully-qualified names for the AI-spend gold tables (different schema than the
# unqualified finance tables, which resolve against UC_SCHEMA by default).
AI_SPEND_MONTHLY = f"{UC_CATALOG}.{UC_SCHEMA_AI}.fact_ai_spend_monthly"
AI_SPEND_BY_PROVIDER = f"{UC_CATALOG}.{UC_SCHEMA_AI}.fact_ai_spend_by_provider"
AI_SPEND_BY_TEAM = f"{UC_CATALOG}.{UC_SCHEMA_AI}.fact_ai_spend_by_team"
AI_SPEND_DETAIL = f"{UC_CATALOG}.{UC_SCHEMA_AI}.fact_ai_spend_detail"


@lru_cache(maxsize=1)
def get_workspace_client() -> WorkspaceClient:
    """Return an authenticated WorkspaceClient for the current environment."""
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    profile = os.environ.get("DATABRICKS_PROFILE")
    if profile:
        return WorkspaceClient(profile=profile)
    return WorkspaceClient()
