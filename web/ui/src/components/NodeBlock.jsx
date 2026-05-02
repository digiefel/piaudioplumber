import { useEffect, useRef, useState } from "react";
import { PillHandle } from "./PillHandle.jsx";

const CLASS_COLORS = {
  "Audio/Sink": "#1a4b8c",
  "Audio/Source": "#1a6b4b",
  "Stream/Input/Audio": "#4b2d7a",
  "Stream/Output/Audio": "#7a4b2d",
};

const PROXIMITY_PX = 60;

/**
 * Distance from point (x,y) to the nearest edge of rect r.  Returns 0 if
 * (x,y) is inside r.  Used for the per-pill proximity-hover trigger.
 */
function distanceToRect(x, y, r) {
  if (!r) return Infinity;
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return Math.hypot(dx, dy);
}

export function NodeBlock({ data, selected }) {
  const [hover, setHover] = useState(false);
  // Per-side proximity hover state — drives PillHandle's `expanded` prop.
  const [pillExpanded, setPillExpanded] = useState({ in: false, out: false });

  const inWrapRef = useRef(null);
  const outWrapRef = useRef(null);

  // Drive pill expansion via a window-level mousemove distance check on the
  // pill's bounding rect.  We don't use a 60px transparent overlay around
  // the pill because that would steal pointer events from edges and the
  // canvas pan area.  The check is cheap (O(1) per pill, two sqrt calls).
  useEffect(() => {
    const onMove = (e) => {
      const inDist = distanceToRect(
        e.clientX,
        e.clientY,
        inWrapRef.current?.getBoundingClientRect()
      );
      const outDist = distanceToRect(
        e.clientX,
        e.clientY,
        outWrapRef.current?.getBoundingClientRect()
      );
      const newIn = inDist < PROXIMITY_PX;
      const newOut = outDist < PROXIMITY_PX;
      setPillExpanded((prev) =>
        prev.in === newIn && prev.out === newOut ? prev : { in: newIn, out: newOut }
      );
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

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

      {/* Wrappers exist purely so we can call getBoundingClientRect on the
          pill itself for the proximity check.  PillHandle is absolutely
          positioned inside this empty div. */}
      <div ref={inWrapRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <PillHandle
          side="input"
          links={data.incomingLinks || []}
          expanded={pillExpanded.in}
        />
      </div>

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

      {node.volume != null && (
        <div
          style={{
            marginTop: 2,
            fontSize: 10,
            color: node.muted ? "#f87171" : "#bbb",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            letterSpacing: 0.3,
          }}
        >
          Vol: {Math.round(node.volume * 100)}%{node.muted ? " (muted)" : ""}
        </div>
      )}

      <div ref={outWrapRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <PillHandle
          side="output"
          links={data.outgoingLinks || []}
          expanded={pillExpanded.out}
        />
      </div>
    </div>
  );
}
