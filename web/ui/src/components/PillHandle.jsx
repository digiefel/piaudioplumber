import { useState } from "react";
import { Handle, Position } from "@xyflow/react";

export function PillHandle({ side, links = [] }) {
  const [hover, setHover] = useState(false);
  const type = side === "input" ? "target" : "source";
  const position = side === "input" ? Position.Left : Position.Right;

  const segH = 14;
  const count = Math.max(1, links.length);
  const pillH = count * segH + 8;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side === "input" ? "left" : "right"]: -11,
        width: 12,
        height: pillH,
        background: hover ? "#252540" : "#14142a",
        border: `1px solid ${hover ? "#555" : "#2a2a3a"}`,
        borderRadius: 6,
        overflow: "visible",
        transition: "height 120ms, background 120ms, border-color 120ms",
        zIndex: 10,
      }}
    >
      {links.map((link, i) => (
        <div
          key={link.id}
          data-testid="pill-segment"
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            top: 4 + i * segH,
            height: segH - 2,
            borderRadius: 2,
            background: link.state === "active" ? "#4ade8077" : "#4a4a6077",
            pointerEvents: "none",
          }}
        />
      ))}

      {links.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: hover ? "#555" : "#2a2a3a",
            pointerEvents: "none",
            transition: "color 120ms",
            userSelect: "none",
          }}
        >
          +
        </div>
      )}

      {/* Transparent handle covering the full pill for React Flow interactions */}
      <Handle
        type={type}
        position={position}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transform: "none",
          background: "transparent",
          border: "none",
          borderRadius: 6,
          opacity: 0,
          cursor: "crosshair",
        }}
      />
    </div>
  );
}
