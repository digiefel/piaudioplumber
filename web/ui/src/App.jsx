import { useCallback, useMemo, useRef, useState } from "react";
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

const NODE_TYPES = { pwNode: NodeBlock };
const NODE_WIDTH  = 220;
const NODE_HEIGHT = 90;
const LS_KEY      = "pap:node-positions";

function autoLayout(nodes, links) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 160, marginx: 60, marginy: 60 });

  nodes.forEach((n) => g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT }));

  links
    .filter((l) => l.output_node_id != null && l.input_node_id != null)
    .forEach((l) => {
      if (g.hasNode(String(l.output_node_id)) && g.hasNode(String(l.input_node_id)))
        g.setEdge(String(l.output_node_id), String(l.input_node_id));
    });

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(String(n.id));
    return {
      ...n,
      _x: pos ? pos.x - NODE_WIDTH  / 2 : 60,
      _y: pos ? pos.y - NODE_HEIGHT / 2 : 60,
    };
  });
}

function buildFlowNodes(graphNodes, graphLinks, onSelect) {
  const laid = autoLayout(graphNodes, graphLinks);
  return laid.map((n) => ({
    id: String(n.id),
    type: "pwNode",
    position: { x: n._x, y: n._y },
    data: { node: n, onSelect },
    draggable: true,
  }));
}

function buildFlowEdges(links) {
  return links
    .filter((l) => l.output_node_id != null && l.input_node_id != null)
    .map((l) => ({
      id: String(l.id),
      source: String(l.output_node_id),
      target: String(l.input_node_id),
      animated: l.state === "active",
      style: {
        stroke: l.state === "active" ? "#4ade80" : "#444",
        strokeWidth: l.state === "active" ? 2 : 1,
      },
      label: l.state === "active" ? "" : l.state,
    }));
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

  const flowNodes = useMemo(
    () => buildFlowNodes(graph.nodes, graph.links, handleSelect),
    [graph.nodes, graph.links, handleSelect]
  );
  const flowEdges = useMemo(() => buildFlowEdges(graph.links), [graph.links]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync when graph changes; priority: localStorage > in-memory drag > dagre
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
    setEdges(flowEdges);
  }, [flowNodes, flowEdges]);

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

  const handleVolume = useCallback(
    (v) => sendCommand({ cmd: "set_volume", volume: v }),
    [sendCommand]
  );
  const handleMute = useCallback(
    (m) => sendCommand({ cmd: "set_mute", muted: m }),
    [sendCommand]
  );

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        fitView
        colorMode="dark"
        style={{ background: "#0f0f11" }}
      >
        <Background color="#222" gap={24} />
        <Controls style={{ background: "#1a1a24", border: "1px solid #333" }} />
      </ReactFlow>

      <MasterPanel
        master={master}
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
          top: 16,
          right: 80,
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
