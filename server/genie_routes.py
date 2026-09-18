"""Genie proxy: forwards a natural-language question to the CFO Genie space
and returns the text answer, generated SQL, and result rows."""
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .config import GENIE_SPACE_ID, get_workspace_client

router = APIRouter()


class AskRequest(BaseModel):
    question: str
    conversation_id: str | None = None


def _extract(space_id: str, message) -> dict[str, Any]:
    """Pull text answer + generated SQL + result rows out of a GenieMessage."""
    answer_text = ""
    sql = ""
    reasoning = ""
    query_att_id = None

    for att in (message.attachments or []):
        if att.text and att.text.content:
            answer_text += (att.text.content + "\n")
        if att.query:
            sql = att.query.query or ""
            # Genie's natural-language interpretation of the question.
            reasoning = att.query.description or ""
            query_att_id = att.attachment_id

    columns: list[str] = []
    rows: list[list[Any]] = []

    if query_att_id:
        w = get_workspace_client()
        try:
            res = w.genie.get_message_query_result_by_attachment(
                space_id, message.conversation_id, message.message_id, query_att_id
            )
            sr = res.statement_response
            if sr and sr.manifest and sr.manifest.schema:
                columns = [c.name for c in sr.manifest.schema.columns]
            if sr and sr.result and sr.result.data_array:
                rows = sr.result.data_array
        except Exception as exc:  # noqa: BLE001
            answer_text += f"\n(Could not load query result: {exc})"

    return {
        "answer": answer_text.strip(),
        "sql": sql.strip(),
        "reasoning": reasoning.strip(),
        "columns": columns,
        "rows": rows,
        "conversation_id": message.conversation_id,
    }


@router.post("/genie/ask")
def genie_ask(req: AskRequest):
    w = get_workspace_client()
    if req.conversation_id:
        message = w.genie.create_message_and_wait(
            GENIE_SPACE_ID, req.conversation_id, req.question
        )
    else:
        message = w.genie.start_conversation_and_wait(GENIE_SPACE_ID, req.question)
    return _extract(GENIE_SPACE_ID, message)
