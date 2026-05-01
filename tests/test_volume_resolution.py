"""Tests for per-node volume resolution.

PipeWire stores `channelVolumes` as the cube of the linear value that wpctl
reports.  For Stream nodes, volume lives on the Node's own Props.  For
hardware nodes (Audio/Sink, Audio/Source), volume lives on the parent
Device's Route, matched by `Route.device == node.card.profile.device`.
"""
from __future__ import annotations

import math

import pytest

from pap.api.ws import _resolve_node_volume_mute, normalize_node
from pap.daemon.state_store import StateStore
from pap.model.graph import Graph, GraphObject, PipeWireType


# 0.512 = 0.8^3, so cube-root → 0.8 (matches what wpctl would report).
CUBED_80 = 0.512


def _node(node_id: int, media_class: str, **extra_props) -> GraphObject:
    props = {"media.class": media_class, **extra_props}
    return GraphObject(
        id=node_id,
        type=PipeWireType.NODE,
        info={"props": props, "state": "running"},
    )


def _node_with_props_block(node_id: int, media_class: str, props_block: dict) -> GraphObject:
    return GraphObject(
        id=node_id,
        type=PipeWireType.NODE,
        info={
            "props": {"media.class": media_class},
            "params": {"Props": [props_block]},
            "state": "running",
        },
    )


def _device_with_route(device_id: int, route_device: int, channel_volumes: list[float], muted: bool = False) -> GraphObject:
    return GraphObject(
        id=device_id,
        type=PipeWireType.DEVICE,
        info={
            "props": {"media.class": "Audio/Device"},
            "params": {
                "Route": [
                    {
                        "index": 0,
                        "device": route_device,
                        "props": {
                            "channelVolumes": channel_volumes,
                            "mute": muted,
                        },
                    }
                ]
            },
        },
    )


class TestStreamVolume:
    def test_stream_node_uses_own_props(self):
        node = _node_with_props_block(
            100, "Stream/Output/Audio",
            {"channelVolumes": [CUBED_80, CUBED_80], "mute": False},
        )
        graph = Graph(version=1, objects={100: node})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is not None
        assert math.isclose(v, 0.8, abs_tol=1e-6)
        assert m is False

    def test_stream_node_falls_back_to_volume_field(self):
        node = _node_with_props_block(
            100, "Stream/Input/Audio",
            {"volume": CUBED_80, "mute": True},  # no channelVolumes
        )
        graph = Graph(version=1, objects={100: node})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is not None
        assert math.isclose(v, 0.8, abs_tol=1e-6)
        assert m is True

    def test_stream_node_without_props_returns_none(self):
        node = _node(100, "Stream/Output/Audio")
        graph = Graph(version=1, objects={100: node})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is None
        assert m is None


class TestHardwareVolumeViaDevice:
    def test_audio_sink_reads_device_route(self):
        # Node 70 → device 50, profile_device 1
        # Device 50's Route with device=1 has the volume
        node = _node(70, "Audio/Sink", **{
            "device.id": "50",
            "card.profile.device": "1",
        })
        device = _device_with_route(50, route_device=1, channel_volumes=[CUBED_80, CUBED_80])
        graph = Graph(version=1, objects={70: node, 50: device})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is not None
        assert math.isclose(v, 0.8, abs_tol=1e-6)
        assert m is False

    def test_audio_source_reads_device_route(self):
        node = _node(71, "Audio/Source", **{
            "device.id": "50",
            "card.profile.device": "0",
        })
        # Two routes — only the matching one (device=0) should be used
        device = GraphObject(
            id=50,
            type=PipeWireType.DEVICE,
            info={
                "props": {"media.class": "Audio/Device"},
                "params": {
                    "Route": [
                        {"index": 0, "device": 0, "props": {"channelVolumes": [CUBED_80], "mute": True}},
                        {"index": 1, "device": 1, "props": {"channelVolumes": [0.001], "mute": False}},
                    ]
                },
            },
        )
        graph = Graph(version=1, objects={71: node, 50: device})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is not None
        assert math.isclose(v, 0.8, abs_tol=1e-6)
        assert m is True  # picked the device=0 route, not device=1

    def test_audio_sink_missing_device_returns_none(self):
        node = _node(70, "Audio/Sink", **{
            "device.id": "50",
            "card.profile.device": "1",
        })
        # Device 50 not in graph at all
        graph = Graph(version=1, objects={70: node})
        v, m = _resolve_node_volume_mute(node, graph)
        # Falls back to node's own Props which are absent → None
        assert v is None
        assert m is None

    def test_audio_sink_no_matching_route_returns_none(self):
        node = _node(70, "Audio/Sink", **{
            "device.id": "50",
            "card.profile.device": "999",  # no matching route
        })
        device = _device_with_route(50, route_device=1, channel_volumes=[CUBED_80])
        graph = Graph(version=1, objects={70: node, 50: device})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is None
        assert m is None

    def test_audio_node_without_device_id_fall_back(self):
        # Some nodes don't carry device.id; should fall back gracefully
        node = _node(70, "Audio/Sink")
        graph = Graph(version=1, objects={70: node})
        v, m = _resolve_node_volume_mute(node, graph)
        assert v is None
        assert m is None


class TestNormalizeNodeVolume:
    def test_normalize_includes_volume_and_muted(self):
        node = _node_with_props_block(
            100, "Stream/Output/Audio",
            {"channelVolumes": [CUBED_80, CUBED_80], "mute": False},
        )
        graph = Graph(version=1, objects={100: node})
        result = normalize_node(node, graph)
        assert "volume" in result
        assert "muted" in result
        assert math.isclose(result["volume"], 0.8, abs_tol=1e-6)
        assert result["muted"] is False

    def test_normalize_without_graph_falls_back_to_self(self):
        # Backward compat: no graph passed → uses node's own Props
        node = _node_with_props_block(
            100, "Stream/Output/Audio",
            {"channelVolumes": [CUBED_80, CUBED_80], "mute": False},
        )
        result = normalize_node(node)
        assert math.isclose(result["volume"], 0.8, abs_tol=1e-6)

    def test_normalize_without_volume_data(self):
        node = _node(100, "Audio/Sink")
        graph = Graph(version=1, objects={100: node})
        result = normalize_node(node, graph)
        assert result["volume"] is None
        assert result["muted"] is None


class TestStateStoreRepublishOnDeviceRouteChange:
    def test_device_route_change_republishes_affected_nodes(self):
        store = StateStore()
        node = _node(70, "Audio/Sink", **{"device.id": "50", "card.profile.device": "1"})
        device_v1 = _device_with_route(50, route_device=1, channel_volumes=[0.1])
        device_v2 = _device_with_route(50, route_device=1, channel_volumes=[CUBED_80])

        # Subscribe to events
        events = []

        def collect(e):
            events.append(e)

        store._subscribers.append(_FakeQueue(events))

        # Initial setup
        store.apply_object(node)
        store.apply_object(device_v1)
        events.clear()  # ignore initial adds

        # Apply a device update that changes Route — should trigger republish for node
        store.apply_object(device_v2)

        # We expect: 1 ObjectChanged for the device, then 1 ObjectChanged for the node
        kinds_and_ids = [(e.kind.value, e.obj.id if hasattr(e, "obj") else None) for e in events]
        assert ("object_changed", 50) in kinds_and_ids
        assert ("object_changed", 70) in kinds_and_ids


class _FakeQueue:
    """Minimal queue stub that records put_nowait into a list."""

    def __init__(self, sink: list):
        self._sink = sink

    def put_nowait(self, item):
        self._sink.append(item)
