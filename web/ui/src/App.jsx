import { useCallback, useMemo, useState } from "react";
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

import { DiagDrawer } from "./components/DiagDrawer.jsx";
import { MasterPanel } from "./components/MasterPanel.jsx";
import { NodeBlock } from "./components/NodeBlock.jsx";
import { useDaemon } from "./hooks/useDaemon.js";

const NODE_TYPES = { pwNode: NodeBlock };

// Only show audio-relevant nodes; discard Video, Midi, and internal driver nodes
function isAudioNode(n) {
  const mc = n.media_class;
  if (!mc) return false;
  return mc.startsWith("Audio/") || mc.startsWith("Stream/");
}

// Auto-layout: place nodes in a rough grid, left = sources, right = sinks
function autoLayout(nodes) {
  const sources = nodes.filter(
    (n) =>
      n.media_class?.startsWith("Audio/Source") ||
      n.media_class?.startsWith("Stream/Output")
  );
  const streams = nodes.filter(
    (n) =>
      n.media_class?.startsWith("Stream/Input") ||
      n.media_class?.startsWith("Stream/Output")
  );
  const sinks = nodes.filter((n) => n.media_class?.startsWith("Audio/Sink"));

  const positioned = [];
  const col = (x, items) =>
    items.forEach((n, i) => positioned.push({ ...n, _x: x, _y: i * 130 + 60 }));

  col(60, sources);
  col(320, streams);
  col(580, sinks);

  return positioned;
}

function buildFlowNodes(graphNodes, onSelect) {
  const laid = autoLayout(graphNodes);
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

function GraphCanvas() {
  const { graph, master, status, sendCommand } = useDaemon();
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const handleSelect = useCallback((node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  const audioNodes = useMemo(
    () => graph.nodes.filter(isAudioNode),
    [graph.nodes]
  );

  const flowNodes = useMemo(
    () => buildFlowNodes(audioNodes, handleSelect),
    [audioNodes, handleSelect]
  );
  const flowEdges = useMemo(() => buildFlowEdges(graph.links), [graph.links]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync when graph changes (preserve user-dragged positions)
  useMemo(() => {
    setNodes((prev) => {
      const posMap = {};
      prev.forEach((n) => { posMap[n.id] = n.position; });
      return flowNodes.map((n) => ({
        ...n,
        position: posMap[n.id] || n.position,
      }));
    });
    setEdges(flowEdges);
  }, [flowNodes, flowEdges]);

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
        onNodesChange={onNodesChange}
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
        <span>{audioNodes.length} nodes</span>
        <span style={{ color: "#555" }}>{graph.links.length} links</span>
      </div>

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
