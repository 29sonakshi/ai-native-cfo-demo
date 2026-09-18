"""Thin helper around the Databricks Statement Execution API.

Returns rows as a list of dicts with values coerced to native Python types
based on the column type metadata (so numeric columns come back as float/int,
not strings).
"""
import time
from typing import Any

from databricks.sdk.service.sql import StatementState

from .config import UC_CATALOG, UC_SCHEMA, WAREHOUSE_ID, get_workspace_client

# UC / Databricks SQL type names that should be parsed as numbers.
_INT_TYPES = {"INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "LONG", "SHORT", "BYTE"}
_FLOAT_TYPES = {"FLOAT", "DOUBLE", "DECIMAL", "REAL", "NUMERIC"}


def _coerce(value: Any, type_name: str | None) -> Any:
    if value is None:
        return None
    if type_name is None:
        return value
    t = type_name.upper()
    try:
        if t in _INT_TYPES:
            return int(value)
        if t in _FLOAT_TYPES:
            return float(value)
        if t in ("BOOLEAN", "BOOL"):
            return str(value).lower() in ("true", "1", "t")
    except (ValueError, TypeError):
        return value
    return value


def run_query(statement: str, parameters: list | None = None) -> list[dict[str, Any]]:
    """Execute a SQL statement against the configured warehouse/schema.

    Polls until the statement reaches a terminal state and returns typed rows.
    """
    w = get_workspace_client()
    resp = w.statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        catalog=UC_CATALOG,
        schema=UC_SCHEMA,
        statement=statement,
        parameters=parameters,
        wait_timeout="50s",
    )

    # Poll while pending/running (warehouse may be auto-starting).
    statement_id = resp.statement_id
    while resp.status and resp.status.state in (StatementState.PENDING, StatementState.RUNNING):
        time.sleep(1.0)
        resp = w.statement_execution.get_statement(statement_id)

    if not resp.status or resp.status.state != StatementState.SUCCEEDED:
        msg = "Unknown error"
        if resp.status and resp.status.error:
            msg = resp.status.error.message
        raise RuntimeError(f"SQL statement failed: {msg}")

    columns = resp.manifest.schema.columns if resp.manifest and resp.manifest.schema else []
    col_names = [c.name for c in columns]
    col_types = [c.type_name.value if c.type_name else None for c in columns]

    data = resp.result.data_array if resp.result and resp.result.data_array else []
    rows: list[dict[str, Any]] = []
    for raw in data:
        row = {}
        for i, name in enumerate(col_names):
            row[name] = _coerce(raw[i], col_types[i])
        rows.append(row)
    return rows
