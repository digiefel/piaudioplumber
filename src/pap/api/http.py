"""FastAPI application factory."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from pap.api.schemas import (
    CommandResult,
    DiagnosticsResponse,
    GraphSnapshot,
    LinkSummary,
    MasterState,
    MuteRequest,
    NodeSummary,
    VolumeRequest,
)
from pap.api.ws import WSManager
from pap.daemon.control import AudioControl
from pap.daemon.diagnostics import Diagnostics
from pap.daemon.state_store import StateStore

logger = logging.getLogger(__name__)

_STATIC_DIR = Path(__file__).parent.parent.parent.parent / "web" / "ui" / "dist"


def build_app(
    store: StateStore,
    control: AudioControl,
    diag: Diagnostics,
) -> FastAPI:
    app = FastAPI(title="piaudioplumber", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    ws_manager = WSManager(store=store, control=control)

    # ── WebSocket ──

    @app.websocket("/api/events")
    async def websocket_events(ws: WebSocket) -> None:
        await ws_manager.connect(ws)

    # ── Graph ──

    @app.get("/api/graph", response_model=GraphSnapshot)
    async def get_graph() -> GraphSnapshot:
        graph = store.graph
        master = store.master
        return GraphSnapshot(
            version=graph.version,
            raw_object_count=len(graph.objects),
            nodes=[
                NodeSummary(
                    id=n.id,
                    name=n.node_name,
                    description=n.node_description,
                    media_class=n.media_class,
                    application=n.application_name,
                    state=str(n.node_state) if n.node_state else None,
                    is_running=n.is_running,
                    props=n.props,
                )
                for n in graph.nodes
            ],
            links=[
                LinkSummary(
                    id=lk.id,
                    output_node_id=lk.link_output_node_id,
                    input_node_id=lk.link_input_node_id,
                    state=str(lk.link_state) if lk.link_state else None,
                )
                for lk in graph.links
            ],
            master=MasterState(
                sink_node_id=master.sink_node_id,
                sink_name=master.sink_name,
                volume=master.volume,
                muted=master.muted,
            ),
        )

    # ── Control ──

    @app.post("/api/control/volume", response_model=CommandResult)
    async def set_volume(req: VolumeRequest) -> CommandResult:
        ok = await control.set_master_volume(req.volume)
        return CommandResult(ok=ok, message="" if ok else "wpctl failed")

    @app.post("/api/control/mute", response_model=CommandResult)
    async def set_mute(req: MuteRequest) -> CommandResult:
        ok = await control.set_master_mute(req.muted)
        return CommandResult(ok=ok, message="" if ok else "wpctl failed")

    # ── Diagnostics ──

    @app.get("/api/diagnostics/dump")
    async def diagnostics_dump() -> JSONResponse:
        store_dump = store.dump()
        store_dump["diagnostics"] = diag.dump()
        return JSONResponse(content=store_dump)

    @app.get("/api/diagnostics/raw-graph")
    async def raw_graph() -> JSONResponse:
        objects = {
            str(obj_id): {
                "id": obj.id,
                "type": str(obj.type),
                "version": obj.version,
                "info": obj.info,
            }
            for obj_id, obj in store.graph.objects.items()
        }
        return JSONResponse(content={"objects": objects, "version": store.graph.version})

    @app.get("/api/diagnostics/node/{node_id}")
    async def explain_node(node_id: int) -> JSONResponse:
        obj = store.graph.objects.get(node_id)
        if obj is None:
            return JSONResponse(content={"error": f"Node {node_id} not found"}, status_code=404)
        decisions = diag.for_subject(str(node_id))
        return JSONResponse(
            content={
                "node": {
                    "id": obj.id,
                    "type": str(obj.type),
                    "name": obj.node_name,
                    "description": obj.node_description,
                    "media_class": obj.media_class,
                    "application": obj.application_name,
                    "state": str(obj.node_state) if obj.node_state else None,
                    "is_running": obj.is_running,
                    "props": obj.props,
                    "raw_info": obj.info,
                },
                "decisions": decisions,
            }
        )

    # ── Health ──

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "graph_version": store.graph.version}

    # ── Static web UI (built React app) ──
    if _STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
        logger.info("Serving web UI from %s", _STATIC_DIR)
    else:
        logger.info("Web UI not built yet (expected at %s)", _STATIC_DIR)

    return app


__all__ = ["build_app"]
