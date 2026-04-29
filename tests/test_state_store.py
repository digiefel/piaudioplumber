"""Tests for daemon/state_store.py."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from pap.daemon.state_store import StateStore
from pap.model.events import EventKind, ObjectAdded, ObjectRemoved, GraphReset
from pap.model.graph import GraphObject, PipeWireType, NodeState
from pap.pw.dump import _parse_raw_object

FIXTURES = Path(__file__).parent / "fixtures"


def _load_fixture_objects() -> list[GraphObject]:
    raw_list = json.loads((FIXTURES / "pw_dump_initial.json").read_text())
    return [o for o in (_parse_raw_object(r) for r in raw_list) if o]


class TestStateStore:
    def test_initial_empty(self):
        store = StateStore()
        assert store.graph.version == 0
        assert len(store.graph.objects) == 0

    def test_apply_object_adds(self):
        store = StateStore()
        objs = _load_fixture_objects()
        for o in objs:
            store.apply_object(o)
        assert len(store.graph.nodes) >= 4

    def test_apply_object_publishes_event(self):
        store = StateStore()
        q = store.subscribe()
        obj = _parse_raw_object({
            "id": 99,
            "type": "PipeWire:Interface:Node",
            "version": 1,
            "permissions": [],
            "info": {"state": "idle", "props": {"node.name": "test.node"}},
        })
        store.apply_object(obj)
        event = q.get_nowait()
        assert event.kind == EventKind.OBJECT_ADDED

    def test_apply_object_change_publishes_changed(self):
        store = StateStore()
        obj1 = _parse_raw_object({
            "id": 10,
            "type": "PipeWire:Interface:Node",
            "version": 1,
            "permissions": [],
            "info": {"state": "idle", "props": {}},
        })
        store.apply_object(obj1)
        q = store.subscribe()
        obj2 = _parse_raw_object({
            "id": 10,
            "type": "PipeWire:Interface:Node",
            "version": 2,
            "permissions": [],
            "info": {"state": "running", "props": {}},
        })
        store.apply_object(obj2)
        event = q.get_nowait()
        assert event.kind == EventKind.OBJECT_CHANGED
        assert event.obj.id == 10

    def test_remove_object(self):
        store = StateStore()
        objs = _load_fixture_objects()
        for o in objs:
            store.apply_object(o)
        q = store.subscribe()
        store.remove_object(50)  # AirPlay stream node
        assert 50 not in store.graph.objects
        event = q.get_nowait()
        assert event.kind == EventKind.OBJECT_REMOVED
        assert event.obj_id == 50

    def test_reset_clears_objects(self):
        store = StateStore()
        objs = _load_fixture_objects()
        for o in objs:
            store.apply_object(o)
        q = store.subscribe()
        store.reset()
        assert len(store.graph.objects) == 0
        event = q.get_nowait()
        assert event.kind == EventKind.GRAPH_RESET

    def test_volume_update(self):
        store = StateStore()
        q = store.subscribe()
        store.update_master_volume(0.75, False)
        assert store.master.volume == 0.75
        assert not store.master.muted
        v_event = q.get_nowait()
        assert v_event.kind == EventKind.VOLUME_CHANGED
        m_event = q.get_nowait()
        assert m_event.kind == EventKind.MUTE_CHANGED

    def test_unsubscribe(self):
        store = StateStore()
        q = store.subscribe()
        store.unsubscribe(q)
        obj = _parse_raw_object({
            "id": 1,
            "type": "PipeWire:Interface:Node",
            "version": 1,
            "permissions": [],
            "info": {"props": {}},
        })
        store.apply_object(obj)
        assert q.empty()

    def test_dump_contains_expected_keys(self):
        store = StateStore()
        dump = store.dump()
        assert "graph_version" in dump
        assert "nodes" in dump
        assert "links" in dump
        assert "master" in dump
        assert "recent_events" in dump

    def test_recent_events_ring(self):
        store = StateStore()
        objs = _load_fixture_objects()
        for o in objs:
            store.apply_object(o)
        events = store.recent_events()
        assert len(events) > 0
