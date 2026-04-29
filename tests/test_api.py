"""API contract tests using FastAPI TestClient (no live PipeWire required)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from pap.api.http import build_app
from pap.daemon.control import AudioControl
from pap.daemon.diagnostics import Diagnostics
from pap.daemon.state_store import StateStore
from pap.pw.dump import _parse_raw_object

FIXTURES = Path(__file__).parent / "fixtures"


def _make_app():
    store = StateStore()
    diag = Diagnostics()

    # Stub out AudioControl (no wpctl on dev machine)
    control = AudioControl.__new__(AudioControl)
    control._store = store
    control.set_master_volume = AsyncMock(return_value=True)
    control.set_master_mute = AsyncMock(return_value=True)
    control.refresh_volume = AsyncMock()

    raw_list = json.loads((FIXTURES / "pw_dump_initial.json").read_text())
    for raw in raw_list:
        obj = _parse_raw_object(raw)
        if obj:
            store.apply_object(obj)
    store.update_master_volume(0.80, False)

    app = build_app(store=store, control=control, diag=diag)
    return app, store, control


class TestGraphEndpoint:
    def setup_method(self):
        self.app, self.store, self.control = _make_app()
        self.client = TestClient(self.app)

    def test_get_graph_ok(self):
        resp = self.client.get("/api/graph")
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "links" in data
        assert "master" in data
        assert data["master"]["volume"] == pytest.approx(0.80)

    def test_graph_has_nodes(self):
        resp = self.client.get("/api/graph")
        nodes = resp.json()["nodes"]
        names = [n["name"] for n in nodes]
        assert any("USB_Audio_Interface" in (n or "") for n in names)
        assert any("shairport" in (n or "").lower() for n in names)

    def test_graph_has_links(self):
        resp = self.client.get("/api/graph")
        links = resp.json()["links"]
        assert len(links) >= 1
        assert links[0]["output_node_id"] == 50


class TestControlEndpoints:
    def setup_method(self):
        self.app, self.store, self.control = _make_app()
        self.client = TestClient(self.app)

    def test_set_volume(self):
        resp = self.client.post("/api/control/volume", json={"volume": 0.5})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        self.control.set_master_volume.assert_awaited_once()

    def test_set_volume_clamped(self):
        resp = self.client.post("/api/control/volume", json={"volume": 2.0})
        assert resp.status_code == 422  # pydantic validation rejects > 1.5

    def test_set_mute(self):
        resp = self.client.post("/api/control/mute", json={"muted": True})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_set_volume_missing_field(self):
        resp = self.client.post("/api/control/volume", json={})
        assert resp.status_code == 422


class TestDiagnosticsEndpoints:
    def setup_method(self):
        self.app, self.store, self.control = _make_app()
        self.client = TestClient(self.app)

    def test_dump(self):
        resp = self.client.get("/api/diagnostics/dump")
        assert resp.status_code == 200
        data = resp.json()
        assert "graph_version" in data
        assert "nodes" in data
        assert "diagnostics" in data

    def test_raw_graph(self):
        resp = self.client.get("/api/diagnostics/raw-graph")
        assert resp.status_code == 200
        data = resp.json()
        assert "objects" in data

    def test_explain_node(self):
        resp = self.client.get("/api/diagnostics/node/40")
        assert resp.status_code == 200
        data = resp.json()
        assert "node" in data
        assert data["node"]["id"] == 40

    def test_explain_node_not_found(self):
        resp = self.client.get("/api/diagnostics/node/99999")
        assert resp.status_code == 404


class TestHealthEndpoint:
    def setup_method(self):
        self.app, _, _ = _make_app()
        self.client = TestClient(self.app)

    def test_health(self):
        resp = self.client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
