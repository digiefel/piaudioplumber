import { useEffect, useState } from "react";

/**
 * MasterPanel — floating volume/mute control and connection status.
 */
export function MasterPanel({ master, status, onVolume, onMute }) {
  const statusColor = status === "connected" ? "#4ade80" : status === "connecting" ? "#facc15" : "#f87171";

  // Local slider value for instant visual feedback; only fires command on release
  const [localVolume, setLocalVolume] = useState(Math.round((master.volume || 0) * 100));

  // Sync from PipeWire events (but don't override while dragging)
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setLocalVolume(Math.round((master.volume || 0) * 100));
  }, [master.volume, dragging]);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 10,
        background: "#1a1a24",
        border: "1px solid #333",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 220,
        color: "#e8e8ec",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 4px 20px #0008",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
        <span style={{ fontSize: 12, color: "#888", textTransform: "capitalize" }}>{status}</span>
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700 }}>Master</span>
      </div>

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
          style={{ width: "100%", accentColor: "#4ade80" }}
        />
      </div>

      <button
        onClick={() => onMute(!master.muted)}
        style={{
          width: "100%",
          padding: "6px 0",
          background: master.muted ? "#7f1d1d" : "#1f3d2f",
          color: master.muted ? "#fca5a5" : "#86efac",
          border: `1px solid ${master.muted ? "#ef4444" : "#22c55e"}`,
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {master.muted ? "Muted" : "Unmuted"}
      </button>

      {master.sink_name && (
        <div style={{ marginTop: 8, fontSize: 10, color: "#555", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          sink: {master.sink_name}
        </div>
      )}
    </div>
  );
}
