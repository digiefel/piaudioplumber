"""PipeWire graph object models."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PipeWireType(str, Enum):
    CORE = "PipeWire:Interface:Core"
    MODULE = "PipeWire:Interface:Module"
    NODE = "PipeWire:Interface:Node"
    PORT = "PipeWire:Interface:Port"
    LINK = "PipeWire:Interface:Link"
    DEVICE = "PipeWire:Interface:Device"
    CLIENT = "PipeWire:Interface:Client"
    METADATA = "PipeWire:Interface:Metadata"
    FACTORY = "PipeWire:Interface:Factory"
    PROFILER = "PipeWire:Interface:Profiler"


class NodeState(str, Enum):
    CREATING = "creating"
    SUSPENDED = "suspended"
    IDLE = "idle"
    RUNNING = "running"
    ERROR = "error"


class PortDirection(str, Enum):
    INPUT = "input"
    OUTPUT = "output"


class LinkState(str, Enum):
    INIT = "init"
    UNLINKED = "unlinked"
    ALLOCATING = "allocating"
    PAUSED = "paused"
    ACTIVE = "active"
    ERROR = "error"
    PREPARING = "preparing"


class NodeInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    state: NodeState | None = None
    error: str | None = None
    props: dict[str, Any] = Field(default_factory=dict)
    max_input_ports: int = Field(0, alias="max-input-ports")
    max_output_ports: int = Field(0, alias="max-output-ports")
    n_input_ports: int = Field(0, alias="n-input-ports")
    n_output_ports: int = Field(0, alias="n-output-ports")


class PortInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    direction: PortDirection | None = None
    props: dict[str, Any] = Field(default_factory=dict)


class LinkInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    output_node_id: int | None = Field(None, alias="output-node-id")
    output_port_id: int | None = Field(None, alias="output-port-id")
    input_node_id: int | None = Field(None, alias="input-node-id")
    input_port_id: int | None = Field(None, alias="input-port-id")
    state: LinkState | None = None
    error: str | None = None
    props: dict[str, Any] = Field(default_factory=dict)


class DeviceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    props: dict[str, Any] = Field(default_factory=dict)


class ClientInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    props: dict[str, Any] = Field(default_factory=dict)


class MetadataEntry(BaseModel):
    subject: int
    key: str
    type: str | None = None
    value: Any = None


class MetadataInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    props: dict[str, Any] = Field(default_factory=dict)
    metadata: list[MetadataEntry] = Field(default_factory=list)


InfoType = NodeInfo | PortInfo | LinkInfo | DeviceInfo | ClientInfo | MetadataInfo | None


class GraphObject(BaseModel):
    """A single PipeWire graph object (node, port, link, device, etc.)."""

    id: int
    type: PipeWireType | str | None = None
    version: int = 0
    permissions: list[str] = Field(default_factory=list)
    info: dict[str, Any] | None = None

    @property
    def is_node(self) -> bool:
        return self.type == PipeWireType.NODE

    @property
    def is_port(self) -> bool:
        return self.type == PipeWireType.PORT

    @property
    def is_link(self) -> bool:
        return self.type == PipeWireType.LINK

    @property
    def is_device(self) -> bool:
        return self.type == PipeWireType.DEVICE

    @property
    def is_client(self) -> bool:
        return self.type == PipeWireType.CLIENT

    @property
    def props(self) -> dict[str, Any]:
        if self.info and isinstance(self.info, dict):
            return self.info.get("props", {}) or {}
        return {}

    @property
    def node_name(self) -> str | None:
        return self.props.get("node.name")

    @property
    def node_description(self) -> str | None:
        return self.props.get("node.description")

    @property
    def application_name(self) -> str | None:
        return self.props.get("application.name")

    @property
    def media_class(self) -> str | None:
        return self.props.get("media.class")

    @property
    def node_state(self) -> NodeState | None:
        if self.info and isinstance(self.info, dict):
            raw = self.info.get("state")
            if raw:
                try:
                    return NodeState(raw)
                except ValueError:
                    return None
        return None

    @property
    def is_running(self) -> bool:
        return self.node_state == NodeState.RUNNING

    @property
    def link_output_node_id(self) -> int | None:
        if self.info and isinstance(self.info, dict):
            return self.info.get("output-node-id")
        return None

    @property
    def link_input_node_id(self) -> int | None:
        if self.info and isinstance(self.info, dict):
            return self.info.get("input-node-id")
        return None

    @property
    def link_state(self) -> LinkState | None:
        if self.info and isinstance(self.info, dict):
            raw = self.info.get("state")
            if raw:
                try:
                    return LinkState(raw)
                except ValueError:
                    return None
        return None

    @property
    def port_direction(self) -> PortDirection | None:
        if self.info and isinstance(self.info, dict):
            raw = self.info.get("direction")
            if raw:
                try:
                    return PortDirection(raw.lower())
                except ValueError:
                    return None
        return None

    # ── volume helpers ──
    # PipeWire stores channelVolumes as the cube of the linear value that
    # wpctl/pavucontrol report.  All accessors below return cube-rooted
    # (i.e. wpctl-comparable) values so callers don't need to remember.

    @property
    def node_props_block(self) -> dict | None:
        """Node's own Props parameter (Spa:Pod:Object:Param:Props), if exposed.

        Stream nodes carry their per-app volume here.  Hardware nodes
        typically hold this at 1.0 — their effective volume lives on the
        parent Device's Route.
        """
        if not self.is_node or not isinstance(self.info, dict):
            return None
        params = self.info.get("params") or {}
        plist = params.get("Props") or []
        return plist[0] if isinstance(plist, list) and plist else None

    @property
    def node_volume_self(self) -> float | None:
        """Linear volume from this Node's own Props, cube-rooted (wpctl-scale).

        Returns None if the Node doesn't expose Props.  Returns 1.0 for
        hardware nodes whose effective volume lives elsewhere — caller
        should resolve via the parent Device for hardware classes.
        """
        p = self.node_props_block
        if not p:
            return None
        chans = p.get("channelVolumes")
        if isinstance(chans, list) and chans:
            avg = sum(chans) / len(chans)
            return avg ** (1 / 3)
        v = p.get("volume")
        return v ** (1 / 3) if isinstance(v, (int, float)) else None

    @property
    def node_muted_self(self) -> bool | None:
        p = self.node_props_block
        if not p or "mute" not in p:
            return None
        return bool(p["mute"])

    @property
    def device_routes(self) -> list[dict]:
        """List of Route entries from this Device's params, if any."""
        if not self.is_device or not isinstance(self.info, dict):
            return []
        params = self.info.get("params") or {}
        routes = params.get("Route") or []
        return [r for r in routes if isinstance(r, dict)]


class Graph(BaseModel):
    """Complete normalized snapshot of the PipeWire graph."""

    version: int = 0
    objects: dict[int, GraphObject] = Field(default_factory=dict)

    @property
    def nodes(self) -> list[GraphObject]:
        return [o for o in self.objects.values() if o.is_node]

    @property
    def ports(self) -> list[GraphObject]:
        return [o for o in self.objects.values() if o.is_port]

    @property
    def links(self) -> list[GraphObject]:
        return [o for o in self.objects.values() if o.is_link]

    @property
    def devices(self) -> list[GraphObject]:
        return [o for o in self.objects.values() if o.is_device]

    @property
    def clients(self) -> list[GraphObject]:
        return [o for o in self.objects.values() if o.is_client]

    def apply_update(self, obj: GraphObject) -> "Graph":
        """Return new Graph with this object applied (added or updated)."""
        new_objects = dict(self.objects)
        new_objects[obj.id] = obj
        return Graph(version=self.version + 1, objects=new_objects)

    def apply_removal(self, obj_id: int) -> "Graph":
        """Return new Graph with this object removed."""
        if obj_id not in self.objects:
            return self
        new_objects = dict(self.objects)
        del new_objects[obj_id]
        return Graph(version=self.version + 1, objects=new_objects)


__all__ = [
    "PipeWireType",
    "NodeState",
    "PortDirection",
    "LinkState",
    "GraphObject",
    "NodeInfo",
    "PortInfo",
    "LinkInfo",
    "DeviceInfo",
    "ClientInfo",
    "MetadataInfo",
    "MetadataEntry",
    "Graph",
]
