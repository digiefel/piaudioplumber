import { useState } from "react";
import { Handle, Position } from "@xyflow/react";

const SEG_H = 14;
const PAD = 4;

function addSlotStyle(top) {
  return {
    position: "absolute",
    top,
    left: 1,
    width: 10,
    height: SEG_H - 2,
    transform: "none",
    background: "#1a1a2a",
    border: "1px dashed #444",
    borderRadius: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    color: "#555",
    cursor: "crosshair",
    boxSizing: "border-box",
  };
}

export function PillHandle({ side, links = [] }) {
  const [hover, setHover] = useState(false);
  const type = side === "input" ? "target" : "source";
  const position = side === "input" ? Position.Left : Position.Right;
  const expanded = hover && links.length > 0;
  const linkOffset = expanded ? 1 : 0;

  const slotCount = links.length === 0 ? 1 : links.length + (expanded ? 2 : 0);
  const pillH = slotCount * SEG_H + PAD * 2;

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
      {links.length === 0 ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#2a2a3a",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            +
          </div>
          <Handle
            id="anon"
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
        </>
      ) : (
        <>
          {expanded && (
            <Handle
              id="add-top"
              type={type}
              position={position}
              style={addSlotStyle(PAD)}
            >
              <span style={{ pointerEvents: "none" }}>+</span>
            </Handle>
          )}

          {links.map((link, i) => (
            <Handle
              key={link.id}
              id={`slot-${link._sig}`}
              type={type}
              position={position}
              data-testid="pill-segment"
              style={{
                position: "absolute",
                top: PAD + (linkOffset + i) * SEG_H,
                left: 1,
                width: 10,
                height: SEG_H - 2,
                transform: "none",
                background: link.state === "active" ? "#4ade8077" : "#4a4a6077",
                border: "none",
                borderRadius: 2,
                cursor: "crosshair",
              }}
            />
          ))}

          {expanded && (
            <Handle
              id="add-bot"
              type={type}
              position={position}
              style={addSlotStyle(PAD + (links.length + 1) * SEG_H)}
            >
              <span style={{ pointerEvents: "none" }}>+</span>
            </Handle>
          )}
        </>
      )}
    </div>
  );
}
