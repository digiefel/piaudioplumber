"""In-memory normalized graph state store.

Pure — no I/O. Accepts GraphObject updates and maintains the current Graph.
Also maintains a ring buffer of recent events for diagnostics.
"""
from __future__ import annotations

import asyncio
import collections
import logging
from typing import Any

from pap.model.events import (
    AnyGraphEvent,
    EventKind,
    GraphReset,
    ObjectAdded,
    ObjectChanged,
    ObjectRemoved,
    VolumeChanged,
    MuteChanged,
)
from pap.model.graph import Graph, GraphObject
from pap.model.source import ActivityState, MasterBus, NormalizedSource, SourceKind

logger = logging.getLogger(__name__)

_EVENT_RING_SIZE = 500


class StateStore:
    """Holds the live PipeWire graph and a normalized source model.

    Consumers subscribe to events via an asyncio.Queue.
    """

    def __init__(self) -> None:
        self._graph = Graph()
        self._master = MasterBus()
        self._sources: dict[str, NormalizedSource] = {}
        self._subscribers: list[asyncio.Queue[AnyGraphEvent]] = []
        self._event_ring: collections.deque[AnyGraphEvent] = collections.deque(
            maxlen=_EVENT_RING_SIZE
        )
        self._seq = 0

    # ── public read-only accessors ──

    @property
    def graph(self) -> Graph:
        return self._graph

    @property
    def master(self) -> MasterBus:
        return self._master

    @property
    def sources(self) -> dict[str, NormalizedSource]:
        return dict(self._sources)

    def recent_events(self) -> list[AnyGraphEvent]:
        return list(self._event_ring)

    # ── mutation ──

    def reset(self) -> None:
        """Called when pw-dump restarts; clears all state."""
        self._graph = Graph()
        self._sources.clear()
        event = GraphReset(seq=self._next_seq())
        self._publish(event)
        logger.info("Graph state reset")

    def apply_object(self, obj: GraphObject) -> None:
        """Add or update an object in the graph."""
        old = self._graph.objects.get(obj.id)
        self._graph = self._graph.apply_update(obj)

        if old is None:
            event: AnyGraphEvent = ObjectAdded(obj=obj, seq=self._next_seq())
            logger.debug("Object added id=%s type=%s", obj.id, obj.type)
        else:
            changed_fields = _diff_fields(old, obj)
            event = ObjectChanged(obj=obj, changed_fields=changed_fields, seq=self._next_seq())
            logger.debug("Object changed id=%s fields=%s", obj.id, changed_fields)

        self._publish(event)

        # When a Device's Route changes (volume / mute on hardware), the
        # effective volume of every Node referencing this Device changes
        # too — but pw-dump only emits an event for the Device itself.
        # Republish ObjectChanged for each affected Node so WS clients can
        # update their per-node volume display without tracking devices.
        if obj.is_device and self._device_routes_changed(old, obj):
            self._republish_nodes_for_device(obj.id)

    def _device_routes_changed(self, old: GraphObject | None, new: GraphObject) -> bool:
        """True if the device's Route param differs between old and new."""
        if old is None:
            return True  # new device: republish so nodes pick up its routes
        old_routes = old.device_routes if old.is_device else []
        new_routes = new.device_routes
        return old_routes != new_routes

    def _republish_nodes_for_device(self, device_id: int) -> None:
        """Emit synthesized ObjectChanged events for Nodes referencing a Device."""
        for node in self._graph.nodes:
            try:
                node_dev_id = int(node.props.get("device.id"))
            except (TypeError, ValueError):
                continue
            if node_dev_id != device_id:
                continue
            event = ObjectChanged(
                obj=node,
                changed_fields=["device_route"],
                seq=self._next_seq(),
            )
            self._publish(event)

    def remove_object(self, obj_id: int) -> None:
        """Remove an object by ID."""
        obj = self._graph.objects.get(obj_id)
        if obj is None:
            return
        self._graph = self._graph.apply_removal(obj_id)
        event = ObjectRemoved(obj_id=obj_id, obj_type=str(obj.type), seq=self._next_seq())
        logger.debug("Object removed id=%s type=%s", obj_id, obj.type)
        self._publish(event)

    def update_master_volume(self, volume: float, muted: bool) -> None:
        self._master = MasterBus(
            sink_node_id=self._master.sink_node_id,
            sink_name=self._master.sink_name,
            volume=volume,
            muted=muted,
        )
        v_event = VolumeChanged(volume=volume, is_master=True, seq=self._next_seq())
        m_event = MuteChanged(muted=muted, is_master=True, seq=self._next_seq())
        self._publish(v_event)
        self._publish(m_event)

    def update_master_sink(self, node_id: int | None, sink_name: str | None) -> None:
        self._master = MasterBus(
            sink_node_id=node_id,
            sink_name=sink_name,
            volume=self._master.volume,
            muted=self._master.muted,
        )

    # ── subscriptions ──

    def subscribe(self, maxsize: int = 256) -> asyncio.Queue[AnyGraphEvent]:
        """Return a new queue that will receive all future events."""
        q: asyncio.Queue[AnyGraphEvent] = asyncio.Queue(maxsize=maxsize)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[AnyGraphEvent]) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    # ── diagnostics ──

    def dump(self) -> dict[str, Any]:
        """Return a full diagnostic snapshot."""
        return {
            "graph_version": self._graph.version,
            "object_count": len(self._graph.objects),
            "nodes": [
                {
                    "id": n.id,
                    "name": n.node_name,
                    "description": n.node_description,
                    "media_class": n.media_class,
                    "application": n.application_name,
                    "state": str(n.node_state) if n.node_state else None,
                    "is_running": n.is_running,
                }
                for n in self._graph.nodes
            ],
            "links": [
                {
                    "id": lk.id,
                    "output_node": lk.link_output_node_id,
                    "input_node": lk.link_input_node_id,
                    "state": str(lk.link_state) if lk.link_state else None,
                }
                for lk in self._graph.links
            ],
            "master": {
                "sink_node_id": self._master.sink_node_id,
                "sink_name": self._master.sink_name,
                "volume": self._master.volume,
                "muted": self._master.muted,
            },
            "sources": {k: v.model_dump() for k, v in self._sources.items()},
            "recent_events": [e.model_dump(mode="json") for e in list(self._event_ring)[-50:]],
        }

    # ── private ──

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _publish(self, event: AnyGraphEvent) -> None:
        self._event_ring.append(event)
        dead: list[asyncio.Queue[AnyGraphEvent]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue full; dropping event %s", event.kind)
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)


def _diff_fields(old: GraphObject, new: GraphObject) -> list[str]:
    """Return list of top-level field names that changed between two objects."""
    changed = []
    if old.type != new.type:
        changed.append("type")
    if old.info != new.info:
        changed.append("info")
    return changed


__all__ = ["StateStore"]
