"""WebSocket event stream.

Clients connect and receive:
  1. A full graph snapshot as the first message (type: "snapshot")
  2. Incremental events as they happen (type: per EventKind)

Clients can also send commands over the WebSocket:
  {"cmd": "set_volume", "volume": 0.8}
  {"cmd": "set_mute", "muted": true}
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from pap.daemon.control import AudioControl
from pap.daemon.state_store import StateStore
from pap.model.events import serialize_event

logger = logging.getLogger(__name__)


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

        # Send initial snapshot
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

    async def _send_loop(
        self, ws: WebSocket, q: asyncio.Queue
    ) -> None:
        while True:
            event = await q.get()
            try:
                await ws.send_text(json.dumps(serialize_event(event)))
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
        else:
            logger.debug("Unknown WS command: %s", cmd)

    def _build_snapshot(self) -> dict[str, Any]:
        graph = self._store.graph
        master = self._store.master
        return {
            "type": "snapshot",
            "version": graph.version,
            "nodes": [
                {
                    "id": n.id,
                    "name": n.node_name,
                    "description": n.node_description,
                    "media_class": n.media_class,
                    "application": n.application_name,
                    "state": str(n.node_state) if n.node_state else None,
                    "is_running": n.is_running,
                    "type": str(n.type),
                    "props": n.props,
                }
                for n in graph.nodes
            ],
            "links": [
                {
                    "id": lk.id,
                    "output_node_id": lk.link_output_node_id,
                    "input_node_id": lk.link_input_node_id,
                    "state": str(lk.link_state) if lk.link_state else None,
                }
                for lk in graph.links
            ],
            "master": {
                "sink_node_id": master.sink_node_id,
                "sink_name": master.sink_name,
                "volume": master.volume,
                "muted": master.muted,
            },
        }


__all__ = ["WSManager"]
