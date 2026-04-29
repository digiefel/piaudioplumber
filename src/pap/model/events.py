"""Event types emitted by the graph watcher and state store."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel

from pap.model.graph import GraphObject


class EventKind(str, Enum):
    OBJECT_ADDED = "object_added"
    OBJECT_CHANGED = "object_changed"
    OBJECT_REMOVED = "object_removed"
    GRAPH_RESET = "graph_reset"
    CONNECTION_LOST = "connection_lost"
    CONNECTION_RESTORED = "connection_restored"
    VOLUME_CHANGED = "volume_changed"
    MUTE_CHANGED = "mute_changed"


class GraphEvent(BaseModel):
    kind: EventKind
    seq: int = 0


class ObjectAdded(GraphEvent):
    kind: EventKind = EventKind.OBJECT_ADDED
    obj: GraphObject


class ObjectChanged(GraphEvent):
    kind: EventKind = EventKind.OBJECT_CHANGED
    obj: GraphObject
    changed_fields: list[str] = []


class ObjectRemoved(GraphEvent):
    kind: EventKind = EventKind.OBJECT_REMOVED
    obj_id: int
    obj_type: str | None = None


class GraphReset(GraphEvent):
    kind: EventKind = EventKind.GRAPH_RESET


class ConnectionLost(GraphEvent):
    kind: EventKind = EventKind.CONNECTION_LOST


class ConnectionRestored(GraphEvent):
    kind: EventKind = EventKind.CONNECTION_RESTORED


class VolumeChanged(GraphEvent):
    kind: EventKind = EventKind.VOLUME_CHANGED
    node_id: int | None = None
    volume: float = 0.0
    is_master: bool = False


class MuteChanged(GraphEvent):
    kind: EventKind = EventKind.MUTE_CHANGED
    node_id: int | None = None
    muted: bool = False
    is_master: bool = False


AnyGraphEvent = (
    ObjectAdded
    | ObjectChanged
    | ObjectRemoved
    | GraphReset
    | ConnectionLost
    | ConnectionRestored
    | VolumeChanged
    | MuteChanged
)


def serialize_event(event: GraphEvent) -> dict[str, Any]:
    return event.model_dump(mode="json")


__all__ = [
    "EventKind",
    "GraphEvent",
    "ObjectAdded",
    "ObjectChanged",
    "ObjectRemoved",
    "GraphReset",
    "ConnectionLost",
    "ConnectionRestored",
    "VolumeChanged",
    "MuteChanged",
    "AnyGraphEvent",
    "serialize_event",
]
