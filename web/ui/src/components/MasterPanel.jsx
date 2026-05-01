import { useEffect, useState } from "react";

/**
 * MasterPanel — floating volume/mute control.
 * Default: controls the system default sink ("Master").
 * When a node is selected: switches accent + commands route to that node.
 */
export function MasterPanel({ master, selectedNode, status, onVolume, onMute }) {
  const isNodeMode = selectedNode != null;
  const accent = isNodeMode ? "#facc15" : "#4ade80";
  const titleLabel = isNodeMode ? "Selected" : "Master";
  const statusColor = status === "connected" ? "#4ade80" : status === "connecting" ? "#facc15" : "#f87171";

  // Local slider value for instant visual feedback; only fires command on release.
  // When in node mode, baseline = selected node's actual volume (resolved by daemon
  // from Device.Route for hardware nodes, Node.Props for streams). Falls back to
  // master.volume if the node hasn't published a volume.
  const baseline = isNodeMode
    ? (selectedNode.volume ?? master.volume ?? 0)
    : (master.volume ?? 0);
  const [localVolume, setLocalVolume] = useState(Math.round(baseline * 100));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) setLocalVolume(Math.round(baseline * 100));
    // re-sync when the selected node changes too — slider resets to known baseline
    // intentionally not exhaustively deped to avoid jitter mid-drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, dragging, selectedNode?.id]);

  const muted = isNodeMode
    ? (selectedNode.muted ?? false)
    : master.muted;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        background: "#1a1a24",
        border: `1px solid ${isNodeMode ? accent + "88" : "#333"}`,
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 240,
        color: "#e8e8ec",
        fontFamily: "system-ui, sans-serif",
        boxShadow: isNodeMode ? `0 0 0 1px ${accent}33, 0 4px 24px ${accent}33` : "0 4px 20px #0008",
        transition: "border-color 120ms, box-shadow 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
        <span style={{ fontSize: 12, color: "#888", textTransform: "capitalize" }}>{status}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: isNodeMode ? accent : "#e8e8ec" }}>
          {titleLabel}
        </span>
      </div>

      {isNodeMode && (
        <div style={{ marginBottom: 8, fontSize: 11, color: "#ccc", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          → {selectedNode.description || selectedNode.name || `Node ${selectedNode.id}`}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <label style={{ fontSize: 11, color: "#888" }}>Volume</label>
          <span style={{ fontSize: 11, color: "#ccc" }}>{localVolume}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={150}
          value={localVolume}
          onChange={(e) => { setDragging(true); setLocalVolume(parseInt(e.target.value)); }}
          onPointerUp={(e) => { setDragging(false); onVolume(parseInt(e.target.value) / 100); }}
          style={{ width: "100%", accentColor: accent }}
        />
      </div>

      <button
        onClick={() => onMute(!muted)}
        style={{
          width: "100%",
          padding: "6px 0",
          background: muted ? "#7f1d1d" : (isNodeMode ? "#3d3520" : "#1f3d2f"),
          color: muted ? "#fca5a5" : (isNodeMode ? accent : "#86efac"),
          border: `1px solid ${muted ? "#ef4444" : (isNodeMode ? accent : "#22c55e")}`,
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {muted ? "Muted" : "Unmuted"}
      </button>

      {!isNodeMode && master.sink_name && (
        <div style={{ marginTop: 8, fontSize: 10, color: "#555", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          sink: {master.sink_name}
        </div>
      )}
    </div>
  );
}
