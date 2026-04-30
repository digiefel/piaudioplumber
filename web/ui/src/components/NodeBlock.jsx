/**
 * NodeBlock — rendered by React Flow as a custom node.
 * Shows PipeWire node info inside a styled card.
 */
import { Handle, Position } from "@xyflow/react";

const CLASS_COLORS = {
  "Audio/Sink": "#1a4b8c",
  "Audio/Source": "#1a6b4b",
  "Stream/Input/Audio": "#4b2d7a",
  "Stream/Output/Audio": "#7a4b2d",
};

export function NodeBlock({ data, selected }) {
  const { node } = data;
  const isRunning = node.is_running;
  const bg = CLASS_COLORS[node.media_class] || "#2a2a35";
  const borderColor = selected ? "#facc15" : (isRunning ? "#4ade80" : "#444");
  const boxShadow = selected
    ? "0 0 0 2px #facc1599, 0 0 18px #facc1577"
    : (isRunning ? `0 0 12px ${borderColor}44` : "none");

  return (
    <div
      style={{
        background: bg,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 180,
        maxWidth: 240,
        color: "#e8e8ec",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        boxShadow,
        transition: "box-shadow 120ms, border-color 120ms",
      }}
      onClick={() => data.onSelect?.(node)}
    >
      <Handle type="target" position={Position.Left} style={{ background: "#888" }} />
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, color: isRunning ? "#4ade80" : "#ccc" }}>
        {node.description || node.name || `Node ${node.id}`}
      </div>
      <div style={{ color: "#aaa", fontSize: 11, marginBottom: 2 }}>
        {node.media_class || "unknown"}
      </div>
      {node.application && (
        <div style={{ color: "#88aacc", fontSize: 11 }}>app: {node.application}</div>
      )}
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: isRunning ? "#4ade80" : "#666",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {node.state || "unknown"}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: "#888" }} />
    </div>
  );
}
