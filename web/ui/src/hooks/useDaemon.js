/**
 * useDaemon — connects to pap-daemon WebSocket and keeps graph state live.
 *
 * Returns { graph, master, status, sendCommand }
 * where graph = { nodes: [...], links: [...] }
 * and   master = { volume, muted, sink_node_id, sink_name }
 */
import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL =
  import.meta.env.VITE_DAEMON_WS ||
  `ws://${window.location.host}/api/events`;

const RECONNECT_MS = 3000;

export function useDaemon() {
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [master, setMaster] = useState({ volume: 1, muted: false });
  const [status, setStatus] = useState("connecting"); // connecting | connected | disconnected
  const wsRef = useRef(null);
  const timerRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      const kind = msg.type || msg.kind;

      if (kind === "snapshot") {
        setGraph({ nodes: msg.nodes || [], links: msg.links || [] });
        if (msg.master) setMaster(msg.master);
        return;
      }

      if (kind === "object_added") {
        const obj = msg.obj;
        if (!obj) return;
        if (obj.type === "PipeWire:Interface:Node") {
          setGraph((g) => ({ ...g, nodes: [...g.nodes.filter((n) => n.id !== obj.id), normalizeNode(obj)] }));
        } else if (obj.type === "PipeWire:Interface:Link") {
          setGraph((g) => ({ ...g, links: [...g.links.filter((l) => l.id !== obj.id), obj] }));
        }
        return;
      }

      if (kind === "object_changed") {
        const obj = msg.obj;
        if (!obj) return;
        if (obj.type === "PipeWire:Interface:Node") {
          setGraph((g) => ({
            ...g,
            nodes: g.nodes.map((n) => (n.id === obj.id ? { ...n, ...normalizeNode(obj) } : n)),
          }));
        }
        return;
      }

      if (kind === "object_removed") {
        const id = msg.obj_id;
        setGraph((g) => ({
          nodes: g.nodes.filter((n) => n.id !== id),
          links: g.links.filter((l) => l.id !== id),
        }));
        return;
      }

      if (kind === "graph_reset") {
        setGraph({ nodes: [], links: [] });
        return;
      }

      if (kind === "volume_changed" && msg.is_master) {
        setMaster((m) => ({ ...m, volume: msg.volume }));
      }
      if (kind === "mute_changed" && msg.is_master) {
        setMaster((m) => ({ ...m, muted: msg.muted }));
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      timerRef.current = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((cmd) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  return { graph, master, status, sendCommand };
}

function normalizeNode(obj) {
  const info = obj.info || {};
  const props = info.props || obj.props || {};
  return {
    id: obj.id,
    name: props["node.name"] || obj.name,
    description: props["node.description"] || obj.description,
    media_class: props["media.class"] || obj.media_class,
    application: props["application.name"] || obj.application,
    state: info.state || obj.state,
    is_running: (info.state || obj.state) === "running",
    type: obj.type,
    props,
  };
}
