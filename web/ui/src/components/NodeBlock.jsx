import { useState } from "react";
import { PillHandle } from "./PillHandle.jsx";

const CLASS_COLORS = {
  "Audio/Sink": "#1a4b8c",
  "Audio/Source": "#1a6b4b",
  "Stream/Input/Audio": "#4b2d7a",
  "Stream/Output/Audio": "#7a4b2d",
};

export function NodeBlock({ data, selected }) {
  const [hover, setHover] = useState(false);
  const { node } = data;
  const isRunning = node.is_running;
  const bg = CLASS_COLORS[node.media_class] || "#2a2a35";
  const borderColor = selected ? "#facc15" : (isRunning ? "#4ade80" : "#444");
  const boxShadow = selected
    ? "0 0 0 2px #facc1599, 0 0 18px #facc1577"
    : (isRunning ? `0 0 12px ${borderColor}44` : "none");

  const speakerIcon = data.isActive ? "🔊" : (isRunning ? "🔈" : null);

  return (
    <div
      style={{
        position: "relative",
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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => data.onSelect?.(node)}
    >
      {speakerIcon && (
        <div
          style={{
            position: "absolute",
            top: -24,
            right: 2,
            fontSize: 13,
            opacity: hover ? 1 : 0,
            transition: "opacity 150ms",
            pointerEvents: "none",
            background: "#1a1a24cc",
            borderRadius: 4,
            padding: "2px 5px",
            border: "1px solid #333",
            lineHeight: 1.4,
            whiteSpace: "nowrap",
          }}
        >
          {speakerIcon}
        </div>
      )}

      <PillHandle side="input" links={data.incomingLinks || []} />

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

      <PillHandle side="output" links={data.outgoingLinks || []} />
    </div>
  );
}
