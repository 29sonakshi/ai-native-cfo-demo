"""Meridian Bank CFO Cockpit — FastAPI entry point.

Serves the data + Genie APIs and the built React frontend (SPA).
"""
import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.ai_routes import router as ai_router
from server.data_routes import router as data_router
from server.genie_routes import router as genie_router
from server.synthesis_routes import router as synthesis_router

app = FastAPI(title="Meridian Bank AI Cockpit")

app.include_router(data_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(genie_router, prefix="/api")
app.include_router(synthesis_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the built React frontend.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(FRONTEND_DIR):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")),
        name="assets",
    )

    # The SPA entry point must never be cached by the browser: hashed asset
    # filenames change on every deploy, so a stale cached index.html would point
    # at deleted /assets/* files and 404 -> blank screen. no-cache forces the
    # browser to revalidate index.html each load while the immutable hashed
    # assets stay cacheable.
    _NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return {"error": "not found"}
        candidate = os.path.join(FRONTEND_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(
            os.path.join(FRONTEND_DIR, "index.html"), headers=_NO_CACHE
        )
