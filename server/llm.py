"""Foundation Model client for the Meridian CFO app.

Uses an OpenAI-compatible client pointed at the Databricks serving-endpoints
gateway. Dual-mode auth:

* Local dev: token comes from the configured CLI profile (DATABRICKS_PROFILE).
* Databricks Apps (remote): the auto-injected service principal token. Note
  that DATABRICKS_HOST on remote is just a hostname (no scheme) so we prepend
  https:// before using it as the OpenAI base_url.
"""
import os
from functools import lru_cache

from openai import OpenAI

from .config import IS_DATABRICKS_APP, get_workspace_client

# Chosen Foundation Model endpoint. Best available Claude 4.x Sonnet in this
# workspace (see `databricks serving-endpoints list`). Overridable via env.
SYNTH_MODEL = os.environ.get("SYNTH_MODEL", "databricks-claude-sonnet-4-6")


def _workspace_host() -> str:
    """Return the workspace host WITH an https:// scheme."""
    if IS_DATABRICKS_APP:
        host = os.environ.get("DATABRICKS_HOST", "")
        if host and not host.startswith("http"):
            host = f"https://{host}"
        return host
    return get_workspace_client().config.host


def _auth_token() -> str:
    """Return a bearer token valid for the current environment."""
    w = get_workspace_client()
    if w.config.token:
        return w.config.token
    # OAuth / U2M / service-principal flows: token is None, use authenticate().
    headers = w.config.authenticate()
    if headers and "Authorization" in headers:
        return headers["Authorization"].replace("Bearer ", "")
    raise RuntimeError("Could not obtain a Databricks auth token for FM API")


@lru_cache(maxsize=1)
def get_llm_client() -> OpenAI:
    base_url = f"{_workspace_host()}/serving-endpoints"
    return OpenAI(api_key=_auth_token(), base_url=base_url)


def complete(system_prompt: str, user_prompt: str, *, temperature: float = 0.3,
             max_tokens: int = 700) -> str:
    """Single-shot chat completion against the synthesis model."""
    client = get_llm_client()
    resp = client.chat.completions.create(
        model=SYNTH_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()
