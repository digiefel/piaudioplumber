"""Tests for pw/dump.py — JSON stream parser and object parsing."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from pap.model.graph import GraphObject, NodeState, PipeWireType
from pap.pw.dump import JsonStreamParser, _is_removal, _parse_raw_object

FIXTURES = Path(__file__).parent / "fixtures"


class TestJsonStreamParser:
    def test_single_object(self):
        parser = JsonStreamParser()
        results = parser.feed('{"id":1,"type":"foo"}')
        assert results == ['{"id":1,"type":"foo"}']

    def test_array(self):
        parser = JsonStreamParser()
        results = parser.feed('[{"id":1},{"id":2}]')
        assert len(results) == 1
        data = json.loads(results[0])
        assert isinstance(data, list)
        assert len(data) == 2

    def test_multi_line(self):
        parser = JsonStreamParser()
        chunk1 = '{\n  "id": 42,\n'
        chunk2 = '  "type": "PipeWire:Interface:Node"\n}'
        parser.feed(chunk1)
        results = parser.feed(chunk2)
        assert len(results) == 1
        data = json.loads(results[0])
        assert data["id"] == 42

    def test_nested(self):
        parser = JsonStreamParser()
        results = parser.feed('{"info":{"props":{"a":1}}}')
        assert len(results) == 1

    def test_string_with_braces(self):
        parser = JsonStreamParser()
        results = parser.feed('{"key":"value {with} braces"}')
        assert len(results) == 1
        data = json.loads(results[0])
        assert data["key"] == "value {with} braces"

    def test_multiple_objects_in_one_feed(self):
        parser = JsonStreamParser()
        results = parser.feed('{"id":1}{"id":2}')
        assert len(results) == 2

    def test_chunked_across_feeds(self):
        parser = JsonStreamParser()
        r1 = parser.feed('{"id":')
        assert r1 == []
        r2 = parser.feed("99}")
        assert len(r2) == 1
        assert json.loads(r2[0])["id"] == 99

    def test_initial_fixture(self):
        """Parse the full initial dump fixture."""
        raw = (FIXTURES / "pw_dump_initial.json").read_text()
        parser = JsonStreamParser()
        results = parser.feed(raw)
        assert len(results) == 1
        data = json.loads(results[0])
        assert isinstance(data, list)
        assert len(data) >= 7


class TestParseRawObject:
    def test_node(self):
        raw = {
            "id": 40,
            "type": "PipeWire:Interface:Node",
            "version": 3,
            "permissions": ["r", "w", "x"],
            "info": {
                "state": "running",
                "props": {
                    "node.name": "alsa_output.test",
                    "media.class": "Audio/Sink",
                },
            },
        }
        obj = _parse_raw_object(raw)
        assert obj is not None
        assert obj.id == 40
        assert obj.type == PipeWireType.NODE
        assert obj.is_node
        assert obj.node_state == NodeState.RUNNING
        assert obj.is_running
        assert obj.node_name == "alsa_output.test"
        assert obj.media_class == "Audio/Sink"

    def test_link(self):
        raw = {
            "id": 70,
            "type": "PipeWire:Interface:Link",
            "version": 1,
            "permissions": [],
            "info": {
                "output-node-id": 10,
                "input-node-id": 20,
                "state": "active",
                "error": None,
                "props": {},
            },
        }
        obj = _parse_raw_object(raw)
        assert obj is not None
        assert obj.is_link
        assert obj.link_output_node_id == 10
        assert obj.link_input_node_id == 20

    def test_removal_no_type(self):
        raw = {"id": 99, "type": None, "info": None}
        obj = _parse_raw_object(raw)
        assert obj is not None
        assert _is_removal(raw)

    def test_missing_id_returns_none(self):
        obj = _parse_raw_object({"type": "PipeWire:Interface:Node"})
        assert obj is None

    def test_full_fixture(self):
        """Parse every object in the initial dump fixture."""
        raw_list = json.loads((FIXTURES / "pw_dump_initial.json").read_text())
        objects = [_parse_raw_object(r) for r in raw_list]
        objects = [o for o in objects if o]
        assert len(objects) == len(raw_list)
        node_ids = [o.id for o in objects if o.is_node]
        assert 40 in node_ids  # USB audio sink
        assert 50 in node_ids  # AirPlay stream
        link_ids = [o.id for o in objects if o.is_link]
        assert 70 in link_ids
