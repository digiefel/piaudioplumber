import { Handle, Position } from "@xyflow/react";
import { slotHandleId, sortedSlots } from "../utils/slots.js";

const SEG_H = 14;
const PILL_W = 12;
const PILL_PAD = 4;

/**
 * Vertical pill of Handles, one per existing connection slot.
 *
 * - Idle, 0 connections: compact pill with a single anonymous Handle and
 *   a faint "+" glyph centred (entry point for a first connection).
 * - Idle, N connections: pill sized to N slots, each connection at its
 *   own evenly-distributed vertical slot.
 * - Expanded (driven by parent via `expanded` prop): one extra "+" slot
 *   above the topmost connection and one below the bottommost — each is
 *   a real React Flow Handle, draggable to start a new connection.
 *
 * The PipeWire backend doesn't care which slot a connection comes from;
 * slots are purely visual. Edges in App.jsx set sourceHandle/targetHandle
 * to slotHandleId(link, side) so curves attach to the right slot.
 *
 * @param {object} props
 * @param {"input" | "output"} props.side
 * @param {Array} props.links  Connections currently on this side.
 * @param {boolean} props.expanded  Whether the parent has detected hover.
 */
export function PillHandle({ side, links = [], expanded = false }) {
  const isInput = side === "input";
  const type = isInput ? "target" : "source";
  const position = isInput ? Position.Left : Position.Right;
  const sideKey = isInput ? "in" : "out";

  const sorted = sortedSlots(links, sideKey);
  const noLinks = sorted.length === 0;

  // Layout: when expanded, prepend +slot and append +slot.
  const showPlusSlots = expanded;
  const slotsBefore = showPlusSlots ? 1 : 0;
  const slotsAfter = showPlusSlots ? 1 : 0;
  const totalSlots = sorted.length + slotsBefore + slotsAfter || 1;
  const pillH = totalSlots * SEG_H + 2 * PILL_PAD;

  const slotTop = (i) => i * SEG_H + SEG_H / 2 + PILL_PAD;

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [isInput ? "left" : "right"]: -(PILL_W - 1),
        width: PILL_W,
        height: pillH,
        background: expanded ? "#252540" : "#14142a",
        border: `1px solid ${expanded ? "#666" : "#2a2a3a"}`,
        borderRadius: 6,
        transition: "height 140ms, background 140ms, border-color 140ms",
        zIndex: 10,
        pointerEvents: "none", // only handles inside catch the pointer
      }}
    >
      {/* "+" slot above */}
      {showPlusSlots && (
        <Handle
          id={`${sideKey}-add-top`}
          type={type}
          position={position}
          data-testid="pill-add-top"
          style={{
            position: "absolute",
            top: slotTop(0),
            left: 1,
            right: 1,
            width: PILL_W - 2,
            height: SEG_H - 2,
            transform: "translateY(-50%)",
            background: "transparent",
            border: "1px dashed #666",
            borderRadius: 3,
            opacity: 1,
            cursor: "crosshair",
            pointerEvents: "auto",
          }}
        />
      )}

      {/* Existing connection slots */}
      {sorted.map((link, i) => (
        <Handle
          key={slotHandleId(link, sideKey)}
          id={slotHandleId(link, sideKey)}
          type={type}
          position={position}
          data-testid="pill-segment"
          data-link-id={link.id}
          style={{
            position: "absolute",
            top: slotTop(slotsBefore + i),
            left: 1,
            right: 1,
            width: PILL_W - 2,
            height: SEG_H - 2,
            transform: "translateY(-50%)",
            background: link.state === "active" ? "#4ade80aa" : "#4a4a60aa",
            border: "none",
            borderRadius: 2,
            opacity: 1,
            cursor: "crosshair",
            pointerEvents: "auto",
          }}
        />
      ))}

      {/* "+" slot below */}
      {showPlusSlots && (
        <Handle
          id={`${sideKey}-add-bot`}
          type={type}
          position={position}
          data-testid="pill-add-bot"
          style={{
            position: "absolute",
            top: slotTop(slotsBefore + sorted.length),
            left: 1,
            right: 1,
            width: PILL_W - 2,
            height: SEG_H - 2,
            transform: "translateY(-50%)",
            background: "transparent",
            border: "1px dashed #666",
            borderRadius: 3,
            opacity: 1,
            cursor: "crosshair",
            pointerEvents: "auto",
          }}
        />
      )}

      {/* Anonymous handle when no connections + not expanded — first-connection entry */}
      {noLinks && !expanded && (
        <>
          <Handle
            id={`${sideKey}-anon`}
            type={type}
            position={position}
            data-testid="pill-anon"
            style={{
              position: "absolute",
              top: slotTop(0),
              left: 1,
              right: 1,
              width: PILL_W - 2,
              height: SEG_H - 2,
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              opacity: 0,
              cursor: "crosshair",
              pointerEvents: "auto",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#3a3a4a",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            +
          </div>
        </>
      )}
    </div>
  );
}
