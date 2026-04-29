/**
 * DiagDrawer — slide-in diagnostics panel for a selected node.
 * Shows raw PipeWire object info as inspectable JSON.
 */
import { useEffect, useState } from "react";

export function DiagDrawer({ nodeId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!nodeId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/diagnostics/node/${nodeId}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [nodeId]);

  if (!nodeId) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "40vh",
        background: "#111118",
        borderTop: "1px solid #333",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          background: "#1a1a24",
          borderBottom: "1px solid #333",
        }}
      >
        <span style={{ color: "#4ade80", fontWeight: 700 }}>Node {nodeId}</span>
        {data?.node?.name && <span style={{ color: "#888" }}>{data.node.name}</span>}
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {loading && <span style={{ color: "#888" }}>Loading…</span>}
        {error && <span style={{ color: "#f87171" }}>{error}</span>}
        {data && (
          <pre style={{ color: "#c8d3f0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
