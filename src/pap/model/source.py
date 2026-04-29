"""Normalized source/sink model — the user-facing representation of PipeWire nodes."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SourceKind(str, Enum):
    HARDWARE_INPUT = "hardware_input"
    HARDWARE_OUTPUT = "hardware_output"
    SOFTWARE_SOURCE = "software_source"
    SOFTWARE_SINK = "software_sink"
    VIRTUAL = "virtual"
    UNKNOWN = "unknown"


class ActivityState(str, Enum):
    ACTIVE = "active"
    IDLE = "idle"
    UNKNOWN = "unknown"


class NormalizedSource(BaseModel):
    """A user-facing source: one or more PipeWire nodes classified together."""

    id: str
    label: str
    kind: SourceKind = SourceKind.UNKNOWN
    node_ids: list[int] = Field(default_factory=list)
    activity: ActivityState = ActivityState.UNKNOWN
    activity_reason: str = ""
    media_title: str | None = None
    media_artist: str | None = None
    media_album: str | None = None
    cover_art_url: str | None = None
    volume: float | None = None
    muted: bool = False
    props: dict[str, Any] = Field(default_factory=dict)


class MasterBus(BaseModel):
    """Virtual master bus state."""

    sink_node_id: int | None = None
    sink_name: str | None = None
    volume: float = 1.0
    muted: bool = False


__all__ = [
    "SourceKind",
    "ActivityState",
    "NormalizedSource",
    "MasterBus",
]
