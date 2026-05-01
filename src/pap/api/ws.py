"""WebSocket event stream.

Clients connect and receive:
  1. A full graph snapshot as the first message (type: "snapshot")
  2. Incremental events as they happen (type: per EventKind)

Clients can also send commands over the WebSocket:
  {"cmd": "set_volume", "volume": 0.8}
  {"cmd": "set_mute", "muted": true}
  {"cmd": "set_node_volume", "node_id": 88, "volume": 0.8}
  {"cmd": "set_node_mute", "node_id": 88, "muted": true}
  {"cmd": "link_nodes", "output_node_id": 82, "input_node_id": 88}
  {"cmd": "unlink_nodes", "link_id": 109}
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from pap.daemon.control import AudioControl
from pap.daemon.state_store import StateStore
from pap.model.events import EventKind, ObjectAdded, ObjectChanged, serialize_event
from pap.model.graph import Graph, GraphObject
from pap.pw import pwlink

logger = logging.getLogger(__name__)


def _resolve_node_volume_mute(
    n: GraphObject, graph: Graph
) -> tuple[float | None, bool | None]:
    """Return (volume_linear, muted) for a node, or (None, None) if not exposed.

    Stream nodes carry volume on their own Props.  Hardware nodes
    (Audio/Sink, Audio/Source) hold their effective volume on the parent
    Device's Route, matched by `Route.device == node.card.profile.device`.
    All values returned are cube-rooted so they compare directly to what
    `wpctl get-volume` reports.
    """
    mc = n.media_class or ""
    # Stream nodes (per-app volume)
    if mc.startswith("Stream/"):
        v = n.node_volume_self
        m = n.node_muted_self
        if v is not None or m is not None:
            return v, m

    # Hardware nodes: look up the parent Device's Route
    if mc.startswith("Audio/"):
        try:
            dev_id = int(n.props.get("device.id"))
            prof_dev = int(n.props.get("card.profile.device"))
        except (TypeError, ValueError):
            # Fall back to the node's own Props if the device link isn't there
            return n.node_volume_self, n.node_muted_self

        device = graph.objects.get(dev_id)
        if device is None or not device.is_device:
            return n.node_volume_self, n.node_muted_self

        for route in device.device_routes:
            if route.get("device") != prof_dev:
                continue
            rprops = route.get("props") or {}
            chans = rprops.get("channelVolumes")
            mute = rprops.get("mute")
            volume: float | None = None
            if isinstance(chans, list) and chans:
                avg = sum(chans) / len(chans)
                volume = avg ** (1 / 3)
            else:
                v = rprops.get("volume")
                if isinstance(v, (int, float)):
                    volume = v ** (1 / 3)
            return volume, (bool(mute) if mute is not None else None)

    # Anything else: try the node's own Props
    return n.node_volume_self, n.node_muted_self


def normalize_node(n: GraphObject, graph: Graph | None = None) -> dict[str, Any]:
    """Snapshot/event shape for a Node — same fields the frontend expects.

    `graph` is required to resolve volume for hardware nodes (whose volume
    lives on the parent Device's Route).  When omitted (e.g. unit tests
    that don't care about volume), volume/muted will fall back to the
    node's own Props if available, else None.
    """
    if graph is not None:
        volume, muted = _resolve_node_volume_mute(n, graph)
    else:
        volume, muted = n.node_volume_self, n.node_muted_self
    return {
        "id": n.id,
        "name": n.node_name,
        "description": n.node_description,
        "media_class": n.media_class,
        "application": n.application_name,
        "state": n.node_state.value if n.node_state else None,
        "is_running": n.is_running,
        "type": str(n.type),
        "props": n.props,
        "volume": volume,
        "muted": muted,
    }


def normalize_link(lk: GraphObject) -> dict[str, Any]:
    """Snapshot/event shape for a Link — flat fields, no nested info."""
    return {
        "id": lk.id,
        "output_node_id": lk.link_output_node_id,
        "input_node_id": lk.link_input_node_id,
        "state": lk.link_state.value if lk.link_state else None,
    }


def serialize_event_normalized(event: Any, graph: Graph | None = None) -> dict[str, Any]:
    """Like serialize_event, but for ObjectAdded/ObjectChanged of Nodes/Links,
    replace the raw `obj` with the snapshot-shape dict so wire format matches.

    `graph` allows volume resolution for Node events (hardware nodes need
    the parent Device's Route info).
    """
    if isinstance(event, (ObjectAdded, ObjectChanged)):
        obj = event.obj
        base = {"kind": event.kind.value, "seq": event.seq}
        if event.kind == EventKind.OBJECT_CHANGED and isinstance(event, ObjectChanged):
            base["changed_fields"] = event.changed_fields
        if obj.is_node:
            base["obj"] = normalize_node(obj, graph)
            return base
        if obj.is_link:
            base["obj"] = normalize_link(obj)
            return base
    return serialize_event(event)


class WSManager:
    """Manages all active WebSocket connections."""

    def __init__(self, store: StateStore, control: AudioControl) -> None:
        self._store = store
        self._control = control
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.add(ws)
        logger.debug("WS client connected (total=%d)", len(self._connections))

        snapshot = self._build_snapshot()
        await ws.send_text(json.dumps(snapshot))

        q = self._store.subscribe()
        try:
            recv_task = asyncio.create_task(self._recv_loop(ws))
            send_task = asyncio.create_task(self._send_loop(ws, q))
            done, pending = await asyncio.wait(
                [recv_task, send_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            self._store.unsubscribe(q)
            self._connections.discard(ws)
            logger.debug("WS client disconnected (total=%d)", len(self._connections))

    async def _send_loop(self, ws: WebSocket, q: asyncio.Queue) -> None:
        while True:
            event = await q.get()
            try:
                payload = serialize_event_normalized(event, self._store.graph)
                await ws.send_text(json.dumps(payload))
            except Exception:
                break

    async def _recv_loop(self, ws: WebSocket) -> None:
        async for raw in ws.iter_text():
            try:
                msg = json.loads(raw)
                await self._handle_command(ws, msg)
            except json.JSONDecodeError:
                pass
            except Exception:
                logger.exception("WS command error")

    async def _handle_command(self, ws: WebSocket, msg: dict[str, Any]) -> None:
        cmd = msg.get("cmd")
        if cmd == "set_volume":
            volume = float(msg.get("volume", 1.0))
            ok = await self._control.set_master_volume(volume)
            await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        elif cmd == "set_mute":
            muted = bool(msg.get("muted", False))
            ok = await self._control.set_master_mute(muted)
            await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        elif cmd == "set_node_volume":
            node_id = msg.get("node_id")
            volume = float(msg.get("volume", 1.0))
            if node_id is not None:
                ok = await self._control.set_node_volume(int(node_id), volume)
                await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        elif cmd == "set_node_mute":
            node_id = msg.get("node_id")
            muted = bool(msg.get("muted", False))
            if node_id is not None:
                ok = await self._control.set_node_mute(int(node_id), muted)
                await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        elif cmd == "link_nodes":
            output_node_id = msg.get("output_node_id")
            input_node_id = msg.get("input_node_id")
            if output_node_id is not None and input_node_id is not None:
                ok = await pwlink.link_nodes(int(output_node_id), int(input_node_id))
                await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        elif cmd == "unlink_nodes":
            link_id = msg.get("link_id")
            if link_id is not None:
                ok = await pwlink.unlink_by_id(int(link_id))
                await ws.send_text(json.dumps({"type": "cmd_result", "cmd": cmd, "ok": ok}))
        else:
            logger.debug("Unknown WS command: %s", cmd)

    def _build_snapshot(self) -> dict[str, Any]:
        graph = self._store.graph
        master = self._store.master
        return {
            "type": "snapshot",
            "version": graph.version,
            "nodes": [normalize_node(n, graph) for n in graph.nodes],
            "links": [normalize_link(lk) for lk in graph.links],
            "master": {
                "sink_node_id": master.sink_node_id,
                "sink_name": master.sink_name,
                "volume": master.volume,
                "muted": master.muted,
            },
        }


__all__ = ["WSManager", "normalize_node", "normalize_link", "serialize_event_normalized"]
