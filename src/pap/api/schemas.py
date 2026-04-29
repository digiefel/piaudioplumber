"""API request/response schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class NodeSummary(BaseModel):
    id: int
    name: str | None = None
    description: str | None = None
    media_class: str | None = None
    application: str | None = None
    state: str | None = None
    is_running: bool = False
    props: dict[str, Any] = Field(default_factory=dict)


class LinkSummary(BaseModel):
    id: int
    output_node_id: int | None = None
    input_node_id: int | None = None
    state: str | None = None


class MasterState(BaseModel):
    sink_node_id: int | None = None
    sink_name: str | None = None
    volume: float = 1.0
    muted: bool = False


class GraphSnapshot(BaseModel):
    version: int
    nodes: list[NodeSummary]
    links: list[LinkSummary]
    master: MasterState
    raw_object_count: int


class VolumeRequest(BaseModel):
    volume: float = Field(..., ge=0.0, le=1.5)


class MuteRequest(BaseModel):
    muted: bool


class CommandResult(BaseModel):
    ok: bool
    message: str = ""


class DiagnosticsResponse(BaseModel):
    graph_version: int
    object_count: int
    nodes: list[dict[str, Any]]
    links: list[dict[str, Any]]
    master: dict[str, Any]
    sources: dict[str, Any]
    recent_events: list[dict[str, Any]]
    diagnostics: dict[str, Any]


__all__ = [
    "CommandResult",
    "DiagnosticsResponse",
    "GraphSnapshot",
    "LinkSummary",
    "MasterState",
    "MuteRequest",
    "NodeSummary",
    "VolumeRequest",
]
