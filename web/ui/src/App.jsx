import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

import { DiagDrawer } from "./components/DiagDrawer.jsx";
import { MasterPanel } from "./components/MasterPanel.jsx";
import { NodeBlock } from "./components/NodeBlock.jsx";
import { useDaemon } from "./hooks/useDaemon.js";
import { slotHandleId } from "./utils/slots.js";

const NODE_TYPES = { pwNode: NodeBlock };
const NODE_WIDTH  = 220;
const NODE_HEIGHT = 90;
const LS_KEY      = "pap:node-positions";
const COL_PITCH   = NODE_WIDTH + 160;  // 380px column pitch for isolated grid
const ROW_PITCH   = NODE_HEIGHT + 60;  // 150px row pitch

function mediaClassBucket(n) {
  const mc = n.media_class || "";
  if (mc.startsWith("Audio/Source") || mc.startsWith("Stream/Output")) return 0;
  if (mc.startsWith("Stream/Input")) return 1;
  if (mc.startsWith("Audio/Sink")) return 2;
  return 3;
}

function autoLayout(nodes, links) {
  const validLinks = links.filter(
    (l) => l.output_node_id != null && l.input_node_id != null
  );

  // Split: nodes with at least one link vs fully isolated
  const linkedIds = new Set();
  validLinks.forEach((l) => {
    linkedIds.add(String(l.output_node_id));
    linkedIds.add(String(l.input_node_id));
  });
  const connected = nodes.filter((n) => linkedIds.has(String(n.id)));
  const isolated  = nodes.filter((n) => !linkedIds.has(String(n.id)));

  const positioned = [];

  // Dagre for connected subgraph — respects actual signal-flow topology
  if (connected.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 160, marginx: 60, marginy: 60 });
    connected.forEach((n) => g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT }));
    validLinks.forEach((l) => {
      if (g.hasNode(String(l.output_node_id)) && g.hasNode(String(l.input_node_id)))
        g.setEdge(String(l.output_node_id), String(l.input_node_id));
    });
    dagre.layout(g);
    connected.forEach((n) => {
      const pos = g.node(String(n.id));
      positioned.push({ ...n, _x: pos.x - NODE_WIDTH / 2, _y: pos.y - NODE_HEIGHT / 2 });
    });
  }

  // Media_class column grid for isolated nodes, below the dagre section
  const connectedMaxY = positioned.reduce((m, n) => Math.max(m, n._y + NODE_HEIGHT), -1);
  const gridStartY = connected.length > 0 ? connectedMaxY + 80 : 60;

  const buckets = [[], [], [], []];
  isolated.forEach((n) => buckets[mediaClassBucket(n)].push(n));
  let colIdx = 0;
  buckets.forEach((bucket) => {
    if (bucket.length === 0) return;
    bucket.forEach((n, i) => {
      positioned.push({ ...n, _x: 60 + colIdx * COL_PITCH, _y: gridStartY + i * ROW_PITCH });
    });
    colIdx++;
  });

  return positioned;
}

export function isNodeActive(node, links) {
  if (!node.is_running) return false;
  return links.some(
    (l) =>
      l.state === "active" &&
      (l.output_node_id === node.id || l.input_node_id === node.id)
  );
}

function buildFlowNodes(graphNodes, graphLinks, onSelect) {
  const laid = autoLayout(graphNodes, graphLinks);
  return laid.map((n) => {
    const incomingLinks = graphLinks.filter(
      (l) => l.input_node_id === n.id && l.output_node_id != null
    );
    const outgoingLinks = graphLinks.filter(
      (l) => l.output_node_id === n.id && l.input_node_id != null
    );
    return {
      id: String(n.id),
      type: "pwNode",
      position: { x: n._x, y: n._y },
      data: {
        node: n,
        onSelect,
        isActive: isNodeActive(n, graphLinks),
        incomingLinks,
        outgoingLinks,
      },
      draggable: true,
    };
  });
}

export function buildFlowEdges(links) {
  // Dedupe by (source, target) pair so optimistic-deleted + echoed-readded
  // edges from a reroute don't double-render briefly. Keep the edge with the
  // higher numeric id (PipeWire IDs are monotonic, so newer wins).
  const filtered = links.filter(
    (l) => l.output_node_id != null && l.input_node_id != null
  );
  const seen = new Map(); // key = `${out}-${in}` → link
  for (const l of filtered) {
    const key = `${l.output_node_id}-${l.input_node_id}`;
    const prev = seen.get(key);
    if (!prev || Number(l.id) > Number(prev.id)) seen.set(key, l);
  }
  return Array.from(seen.values()).map((l) => {
    const active = l.state === "active";
    // Normalise the state label — strip prefix like "LinkState." for display
    const stateLabel = l.state ? String(l.state).replace(/^.*\./, "") : "";
    return {
      id: String(l.id),
      source: String(l.output_node_id),
      target: String(l.input_node_id),
      // Pin curves to per-slot Handles on the pill, not the pill centre.
      // PillHandle renders Handles with these exact ids (see utils/slots.js).
      sourceHandle: slotHandleId(l, "out"),
      targetHandle: slotHandleId(l, "in"),
      animated: active,
      selectable: true,
      reconnectable: true,
      style: {
        stroke: active ? "#4ade80" : "#888",
        strokeWidth: 2,
      },
      label: active ? "" : stateLabel,
      labelStyle: { fill: "#888", fontSize: 10 },
      labelBgStyle: { fill: "#0f0f11", fillOpacity: 0.8 },
    };
  });
}

function loadSavedPositions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}

function savePositions(posMap) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(posMap)); }
  catch { /* quota / private browsing */ }
}

function GraphCanvas() {
  const { graph, master, status, sendCommand } = useDaemon();
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const handleSelect = useCallback((node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Esc fully deselects (closes per-node panel, reverts MasterPanel to Master).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") setSelectedNodeId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // If the selected node disappears from the graph (e.g. USB replug, profile
  // change), clear the selection so MasterPanel doesn't stick pointing at
  // nothing.
  useEffect(() => {
    if (selectedNodeId != null && !graph.nodes.find((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph.nodes, selectedNodeId]);

  const flowNodes = useMemo(
    () => buildFlowNodes(graph.nodes, graph.links, handleSelect)
            .map((n) => (n.id === String(selectedNodeId) ? { ...n, selected: true } : n)),
    [graph.nodes, graph.links, handleSelect, selectedNodeId]
  );
  const flowEdges = useMemo(() => buildFlowEdges(graph.links), [graph.links]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync nodes — priority: localStorage > in-memory drag > dagre
  useMemo(() => {
    const saved = loadSavedPositions();
    setNodes((prev) => {
      const liveMap = {};
      prev.forEach((n) => { liveMap[n.id] = n.position; });
      return flowNodes.map((n) => ({
        ...n,
        position: saved[n.id] ?? liveMap[n.id] ?? n.position,
      }));
    });
  }, [flowNodes]);

  // Sync edges separately — decoupled from node updates to avoid race conditions
  useMemo(() => {
    setEdges(flowEdges);
  }, [flowEdges]);

  // Persist drag-end positions to localStorage
  const handleNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const dropped = changes.filter(
        (c) => c.type === "position" && c.dragging === false && c.position != null
      );
      if (dropped.length > 0) {
        const saved = loadSavedPositions();
        dropped.forEach((c) => { saved[c.id] = c.position; });
        savePositions(saved);
      }
    },
    [onNodesChange]
  );

  // Create a PipeWire link when user draws an edge
  const onConnect = useCallback(
    (connection) => {
      sendCommand({
        cmd: "link_nodes",
        output_node_id: parseInt(connection.source),
        input_node_id: parseInt(connection.target),
      });
      // Show edge immediately; PipeWire event will replace it with the real one
      setEdges((eds) =>
        addEdge({ ...connection, style: { stroke: "#888", strokeWidth: 1 } }, eds)
      );
    },
    [sendCommand, setEdges]
  );

  // Delete a PipeWire link when user removes an edge (select + Delete key)
  const handleEdgesChange = useCallback(
    (changes) => {
      changes
        .filter((c) => c.type === "remove")
        .forEach((c) => sendCommand({ cmd: "unlink_nodes", link_id: parseInt(c.id) }));
      onEdgesChange(changes);
    },
    [onEdgesChange, sendCommand]
  );

  // ── Edge reconnection (drag an existing edge endpoint to a new target) ──
  // ReactFlow idiom: track success across Start/End so we can detect
  // "drop on canvas" (no successful onReconnect fired) and delete the edge.
  const edgeReconnectSuccess = useRef(false);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccess.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      edgeReconnectSuccess.current = true;
      // If user dropped onto the same source/target pair, no-op
      if (
        String(oldEdge.source) === String(newConnection.source) &&
        String(oldEdge.target) === String(newConnection.target)
      ) {
        return;
      }
      // Delete the old PipeWire link, create the new one. PipeWire will echo
      // both as object_removed/object_added; the dedupe in buildFlowEdges
      // handles the brief window where both old and new might coexist.
      sendCommand({ cmd: "unlink_nodes", link_id: parseInt(oldEdge.id) });
      sendCommand({
        cmd: "link_nodes",
        output_node_id: parseInt(newConnection.source),
        input_node_id: parseInt(newConnection.target),
      });
      // Optimistic local update: remove the old edge so UI reflects the
      // intent immediately. The new edge will arrive via WS.
      setEdges((eds) => eds.filter((e) => e.id !== oldEdge.id));
    },
    [sendCommand, setEdges]
  );

  const onReconnectEnd = useCallback(
    (_, edge) => {
      if (!edgeReconnectSuccess.current) {
        // Dropped on empty canvas — delete the edge
        sendCommand({ cmd: "unlink_nodes", link_id: parseInt(edge.id) });
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
    },
    [sendCommand, setEdges]
  );

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );

  const handleVolume = useCallback(
    (v) => {
      if (selectedNodeId != null) {
        sendCommand({ cmd: "set_node_volume", node_id: selectedNodeId, volume: v });
      } else {
        sendCommand({ cmd: "set_volume", volume: v });
      }
    },
    [sendCommand, selectedNodeId]
  );
  const handleMute = useCallback(
    (m) => {
      if (selectedNodeId != null) {
        sendCommand({ cmd: "set_node_mute", node_id: selectedNodeId, muted: m });
      } else {
        sendCommand({ cmd: "set_mute", muted: m });
      }
    },
    [sendCommand, selectedNodeId]
  );

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onPaneClick={() => setSelectedNodeId(null)}
        nodeTypes={NODE_TYPES}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        colorMode="dark"
        style={{ background: "#0f0f11" }}
      >
        <Background color="#222" gap={24} />
        <Controls style={{ background: "#1a1a24", border: "1px solid #333" }} />
      </ReactFlow>

      <MasterPanel
        master={master}
        selectedNode={selectedNode}
        status={status}
        onVolume={handleVolume}
        onMute={handleMute}
      />

      {/* Title bar */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          color: "#888",
          fontSize: 13,
          fontFamily: "system-ui",
          background: "#1a1a24",
          border: "1px solid #333",
          borderRadius: 8,
          padding: "6px 12px",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ color: "#e8e8ec", fontWeight: 700 }}>Pi Audio Plumber</span>
        <span style={{ color: "#555" }}>|</span>
        <span>{graph.nodes.length} nodes</span>
        <span style={{ color: "#555" }}>{graph.links.length} links</span>
      </div>

      {/* Reset layout button */}
      <button
        onClick={() => { localStorage.removeItem(LS_KEY); setNodes(flowNodes); }}
        style={{
          position: "absolute",
          top: 56,
          left: 16,
          zIndex: 10,
          background: "#1a1a24",
          border: "1px solid #333",
          color: "#888",
          borderRadius: 6,
          padding: "5px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Reset layout
      </button>

      <DiagDrawer
        nodeId={selectedNodeId}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}
