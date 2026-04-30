"""Tests for ws.py event normalization and per-node command dispatch."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from pap.api.ws import WSManager, normalize_link, normalize_node, serialize_event_normalized
from pap.daemon.control import AudioControl
from pap.daemon.state_store import StateStore
from pap.model.events import EventKind, ObjectAdded, ObjectChanged
from pap.model.graph import GraphObject, PipeWireType


def _make_node(node_id: int = 100, *, state: str = "running") -> GraphObject:
    return GraphObject(
        id=node_id,
        type=PipeWireType.NODE,
        info={
            "state": state,
            "props": {
                "node.name": "alsa.pcm.test",
                "node.description": "Test Node",
                "media.class": "Audio/Sink",
                "application.name": "TestApp",
            },
        },
    )


def _make_link(link_id: int = 200, *, out_node: int = 100, in_node: int = 101,
               state: str = "active") -> GraphObject:
    return GraphObject(
        id=link_id,
        type=PipeWireType.LINK,
        info={
            "output-node-id": out_node,
            "input-node-id": in_node,
            "output-port-id": 50,
            "input-port-id": 60,
            "state": state,
        },
    )


class TestNormalizers:
    def test_normalize_node_shape(self):
        node = _make_node(42)
        d = normalize_node(node)
        assert d["id"] == 42
        assert d["name"] == "alsa.pcm.test"
        assert d["description"] == "Test Node"
        assert d["media_class"] == "Audio/Sink"
        assert d["application"] == "TestApp"
        assert d["state"] == "running"
        assert d["is_running"] is True

    def test_normalize_node_with_no_state(self):
        node = GraphObject(id=42, type=PipeWireType.NODE, info={"props": {"node.name": "x"}})
        d = normalize_node(node)
        assert d["state"] is None
        assert d["is_running"] is False

    def test_normalize_link_shape(self):
        link = _make_link(109, out_node=82, in_node=88)
        d = normalize_link(link)
        assert d == {
            "id": 109,
            "output_node_id": 82,
            "input_node_id": 88,
            "state": "active",
        }


class TestSerializeEventNormalized:
    def test_object_added_link_uses_normalized_shape(self):
        event = ObjectAdded(obj=_make_link(109))
        out = serialize_event_normalized(event)
        assert out["kind"] == EventKind.OBJECT_ADDED.value
        assert "obj" in out
        assert out["obj"]["output_node_id"] == 100
        assert out["obj"]["input_node_id"] == 101
        # the raw `info` dict should NOT leak through
        assert "info" not in out["obj"]

    def test_object_added_node_uses_normalized_shape(self):
        event = ObjectAdded(obj=_make_node(42))
        out = serialize_event_normalized(event)
        assert out["obj"]["name"] == "alsa.pcm.test"
        assert out["obj"]["is_running"] is True

    def test_object_changed_link_includes_changed_fields(self):
        event = ObjectChanged(obj=_make_link(109, state="paused"), changed_fields=["state"])
        out = serialize_event_normalized(event)
        assert out["kind"] == EventKind.OBJECT_CHANGED.value
        assert out["changed_fields"] == ["state"]
        assert out["obj"]["state"] == "paused"


class TestUnlinkCommand:
    @pytest.mark.asyncio
    async def test_unlink_nodes_uses_pwlink_dash_d_link_id(self):
        store = StateStore()
        control = AudioControl.__new__(AudioControl)
        control._store = store
        manager = WSManager(store, control)
        store.apply_object(_make_link(109))

        ws = AsyncMock()
        with patch("pap.api.ws.pwlink.unlink_by_id", new=AsyncMock(return_value=True)) as mock:
            await manager._handle_command(ws, {"cmd": "unlink_nodes", "link_id": 109})
        mock.assert_awaited_once_with(109)


class TestNodeVolumeCommand:
    @pytest.mark.asyncio
    async def test_set_node_volume_dispatches_to_control(self):
        store = StateStore()
        control = AudioControl.__new__(AudioControl)
        control._store = store
        control.set_node_volume = AsyncMock(return_value=True)
        manager = WSManager(store, control)

        ws = AsyncMock()
        await manager._handle_command(ws, {"cmd": "set_node_volume", "node_id": 88, "volume": 0.6})
        control.set_node_volume.assert_awaited_once_with(88, 0.6)

    @pytest.mark.asyncio
    async def test_set_node_mute_dispatches_to_control(self):
        store = StateStore()
        control = AudioControl.__new__(AudioControl)
        control._store = store
        control.set_node_mute = AsyncMock(return_value=True)
        manager = WSManager(store, control)

        ws = AsyncMock()
        await manager._handle_command(ws, {"cmd": "set_node_mute", "node_id": 88, "muted": True})
        control.set_node_mute.assert_awaited_once_with(88, True)
