import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

import { DiagDrawer } from "./components/DiagDrawer.jsx";
import { MasterPanel } from "./components/MasterPanel.jsx";
import { NodeBlock } from "./components/NodeBlock.jsx";
import { useDaemon } from "./hooks/useDaemon.js";
import {
  loadSlotMap,
  saveSlotMap,
  nodeStableId,
  linkSig,
  pillKey,
  applySlotOrder,
  insertAt,
  appendSig,
  removeSig,
} from "./utils/slots.js";

const NODE_TYPES = { pwNode: NodeBlock };
const NODE_WIDTH  = 220;
const NODE_HEIGHT = 90;
const LS_KEY      = "pap:node-positions";
const COL_PITCH   = NODE_WIDTH + 160;  // 380px column pitch for isolated grid
const ROW_PITCH   = NODE_HEIGHT + 60;  // 150px row pitch

function mediaClassBucket(n) {
  const mc = n.media_class || "";
  if (mc.startsWith("Audio/Source") || mc.startsWith("Stream/Output")) return 0;
  if (mc.startsWith("Stream/Input")) return 1;
  if (mc.startsWith("Audio/Sink")) return 2;
  return 3;
}

function autoLayout(nodes, links) {
  const validLinks = links.filter(
    (l) => l.output_node_id != null && l.input_node_id != null
  );

  // Split: nodes with at least one link vs fully isolated
  const linkedIds = new Set();
  validLinks.forEach((l) => {
    linkedIds.add(String(l.output_node_id));
    linkedIds.add(String(l.input_node_id));
  });
  const connected = nodes.filter((n) => linkedIds.has(String(n.id)));
  const isolated  = nodes.filter((n) => !linkedIds.has(String(n.id)));

  const positioned = [];

  // Dagre for connected subgraph — respects actual signal-flow topology
  if (connected.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 160, marginx: 60, marginy: 60 });
    connected.forEach((n) => g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT }));
    validLinks.forEach((l) => {
      if (g.hasNode(String(l.output_node_id)) && g.hasNode(String(l.input_node_id)))
        g.setEdge(String(l.output_node_id), String(l.input_node_id));
    });
    dagre.layout(g);
    connected.forEach((n) => {
      const pos = g.node(String(n.id));
      positioned.push({ ...n, _x: pos.x - NODE_WIDTH / 2, _y: pos.y - NODE_HEIGHT / 2 });
    });
  }

  // Media_class column grid for isolated nodes, below the dagre section
  const connectedMaxY = positioned.reduce((m, n) => Math.max(m, n._y + NODE_HEIGHT), -1);
  const gridStartY = connected.length > 0 ? connectedMaxY + 80 : 60;

  const buckets = [[], [], [], []];
  isolated.forEach((n) => buckets[mediaClassBucket(n)].push(n));
  let colIdx = 0;
  buckets.forEach((bucket) => {
    if (bucket.length === 0) return;
    bucket.forEach((n, i) => {
      positioned.push({ ...n, _x: 60 + colIdx * COL_PITCH, _y: gridStartY + i * ROW_PITCH });
    });
    colIdx++;
  });

  return positioned;
}

export function isNodeActive(node, links) {
  if (!node.is_running) return false;
  return links.some(
    (l) =>
      l.state === "active" &&
      (l.output_node_id === node.id || l.input_node_id === node.id)
  );
}

// Keep one link per (output_node_id, input_node_id) pair — highest id wins.
// Mirrors buildFlowEdges dedup so pill slots and rendered edges always match 1:1.
function dedupeLinksByPair(links) {
  const seen = new Map();
  for (const l of links) {
    const key = `${l.output_node_id}-${l.input_node_id}`;
    const prev = seen.get(key);
    if (!prev || Number(l.id) > Number(prev.id)) seen.set(key, l);
  }
  return Array.from(seen.values());
}

function buildFlowNodes(graphNodes, graphLinks, onSelect) {
  const laid = autoLayout(graphNodes, graphLinks);
  return laid.map((n) => {
    const incomingLinks = dedupeLinksByPair(graphLinks.filter(
      (l) => l.input_node_id === n.id && l.output_node_id != null
    ));
    const outgoingLinks = dedupeLinksByPair(graphLinks.filter(
      (l) => l.output_node_id === n.id && l.input_node_id != null
    ));
    return {
      id: String(n.id),
      type: "pwNode",
      position: { x: n._x, y: n._y },
      data: {
        node: n,
        onSelect,
        isActive: isNodeActive(n, graphLinks),
        incomingLinks,
        outgoingLinks,
      },
      draggable: true,
    };
  });
}

// nodesById is optional; when provided, sets sourceHandle/targetHandle for per-slot routing.
export function buildFlowEdges(links, nodesById) {
  // Dedupe by (source, target) pair so optimistic-deleted + echoed-readded
  // edges from a reroute don't double-render briefly. Keep the edge with the
  // higher numeric id (PipeWire IDs are monotonic, so newer wins).
  const filtered = links.filter(
    (l) => l.output_node_id != null && l.input_node_id != null
  );
  const seen = new Map(); // key = `${out}-${in}` → link
  for (const l of filtered) {
    const key = `${l.output_node_id}-${l.input_node_id}`;
    const prev = seen.get(key);
    if (!prev || Number(l.id) > Number(prev.id)) seen.set(key, l);
  }
  return Array.from(seen.values()).map((l) => {
    const active = l.state === "active";
    // Normalise the state label — strip prefix like "LinkState." for display
    const stateLabel = l.state ? String(l.state).replace(/^.*\./, "") : "";
    // Compute per-slot handle IDs when node names are available
    let sourceHandle, targetHandle;
    if (nodesById) {
      const outNode = nodesById[String(l.output_node_id)];
      const inNode  = nodesById[String(l.input_node_id)];
      if (outNode && inNode) {
        const sig = linkSig(nodeStableId(outNode), nodeStableId(inNode));
        sourceHandle = `slot-${sig}`;
        targetHandle = `slot-${sig}`;
      }
    }
    return {
      id: String(l.id),
      source: String(l.output_node_id),
      target: String(l.input_node_id),
      sourceHandle,
      targetHandle,
      animated: active,
      selectable: true,
      reconnectable: true,
      style: {
        stroke: active ? "#4ade80" : "#888",
        strokeWidth: 2,
      },
      label: active ? "" : stateLabel,
      labelStyle: { fill: "#888", fontSize: 10 },
      labelBgStyle: { fill: "#0f0f11", fillOpacity: 0.8 },
    };
  });
}

function loadSavedPositions() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}

function savePositions(posMap) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(posMap)); }
  catch { /* quota / private browsing */ }
}

function GraphCanvas() {
  const { graph, master, status, sendCommand } = useDaemon();
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [slotMap, setSlotMap] = useState(loadSlotMap);

  // Always-current ref to graph.links — used in onConnect to avoid stale closure issues
  const graphLinksRef = useRef(graph.links);
  useEffect(() => { graphLinksRef.current = graph.links; }, [graph.links]);

  // Persist slot map to localStorage whenever it changes
  useEffect(() => { saveSlotMap(slotMap); }, [slotMap]);

  const handleSelect = useCallback((node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // Esc fully deselects (closes per-node panel, reverts MasterPanel to Master).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") setSelectedNodeId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // If the selected node disappears from the graph (e.g. USB replug, profile
  // change), clear the selection so MasterPanel doesn't stick pointing at
  // nothing.
  useEffect(() => {
    if (selectedNodeId != null && !graph.nodes.find((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph.nodes, selectedNodeId]);

  // String-keyed id → node lookup, used for slot sig computation
  const nodesById = useMemo(() => {
    const m = {};
    graph.nodes.forEach((n) => { m[String(n.id)] = n; });
    return m;
  }, [graph.nodes]);

  // Build flow nodes, then augment with sig-ordered link arrays for PillHandle
  const flowNodes = useMemo(() => {
    const base = buildFlowNodes(graph.nodes, graph.links, handleSelect)
      .map((n) => (n.id === String(selectedNodeId) ? { ...n, selected: true } : n));

    return base.map((n) => {
      const node = nodesById[n.id];
      if (!node) return n;
      const sid = nodeStableId(node);

      const augment = (links, side) => {
        const withSig = links.map((l) => ({
          ...l,
          _sig: linkSig(
            nodesById[String(l.output_node_id)] ? nodeStableId(nodesById[String(l.output_node_id)]) : String(l.output_node_id),
            nodesById[String(l.input_node_id)]  ? nodeStableId(nodesById[String(l.input_node_id)])  : String(l.input_node_id),
          ),
        }));
        return applySlotOrder(withSig, slotMap[pillKey(sid, side)] || []);
      };

      return {
        ...n,
        data: {
          ...n.data,
          incomingLinksOrdered: augment(n.data.incomingLinks, "input"),
          outgoingLinksOrdered: augment(n.data.outgoingLinks, "output"),
        },
      };
    });
  }, [graph.nodes, graph.links, handleSelect, selectedNodeId, slotMap, nodesById]);

  const flowEdges = useMemo(
    () => buildFlowEdges(graph.links, nodesById),
    [graph.links, nodesById]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync nodes — priority: localStorage > in-memory drag > dagre
  useMemo(() => {
    const saved = loadSavedPositions();
    setNodes((prev) => {
      const liveMap = {};
      prev.forEach((n) => { liveMap[n.id] = n.position; });
      return flowNodes.map((n) => ({
        ...n,
        position: saved[n.id] ?? liveMap[n.id] ?? n.position,
      }));
    });
  }, [flowNodes]);

  // Sync edges separately — decoupled from node updates to avoid race conditions
  useMemo(() => {
    setEdges(flowEdges);
  }, [flowEdges]);

  // Persist drag-end positions to localStorage
  const handleNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const dropped = changes.filter(
        (c) => c.type === "position" && c.dragging === false && c.position != null
      );
      if (dropped.length > 0) {
        const saved = loadSavedPositions();
        dropped.forEach((c) => { saved[c.id] = c.position; });
        savePositions(saved);
      }
    },
    [onNodesChange]
  );

  // Helper: compute sig from two string node IDs
  const getSig = useCallback(
    (srcId, dstId) =>
      linkSig(
        nodesById[srcId] ? nodeStableId(nodesById[srcId]) : srcId,
        nodesById[dstId] ? nodeStableId(nodesById[dstId]) : dstId,
      ),
    [nodesById]
  );

  // Create a PipeWire link when user draws an edge (or reroute an existing one).
  //
  // When the user drags from a slot Handle (id="slot-<sig>"), sourceHandle starts
  // with "slot-". We look up the existing PipeWire link via graphLinksRef (always
  // current, avoids stale-closure issues with the `edges` React state) and reroute.
  const onConnect = useCallback(
    (connection) => {
      // ── Reroute: drag started from an existing connection's slot handle ──
      if (connection.sourceHandle?.startsWith("slot-")) {
        const sig = connection.sourceHandle.slice(5);
        const matchingLink = graphLinksRef.current.find((l) => {
          const outNode = nodesById[String(l.output_node_id)];
          const inNode  = nodesById[String(l.input_node_id)];
          return outNode && inNode &&
            linkSig(nodeStableId(outNode), nodeStableId(inNode)) === sig;
        });
        if (matchingLink) {
          // No-op: dropped back on the same target
          if (matchingLink.input_node_id === parseInt(connection.target)) return;

          sendCommand({ cmd: "unlink_nodes", link_id: matchingLink.id });
          sendCommand({
            cmd: "link_nodes",
            output_node_id: parseInt(connection.source),
            input_node_id: parseInt(connection.target),
          });

          const newSig = getSig(connection.source, connection.target);
          const oldOutNode = nodesById[String(matchingLink.output_node_id)];
          const oldInNode  = nodesById[String(matchingLink.input_node_id)];
          const newOutNode = nodesById[String(connection.source)];
          const newInNode  = nodesById[String(connection.target)];

          setSlotMap((prev) => {
            const next = { ...prev };
            if (oldOutNode) next[pillKey(nodeStableId(oldOutNode), "output")] = removeSig(prev[pillKey(nodeStableId(oldOutNode), "output")], sig);
            if (oldInNode)  next[pillKey(nodeStableId(oldInNode),  "input")]  = removeSig(prev[pillKey(nodeStableId(oldInNode),  "input")],  sig);
            if (newOutNode) {
              const k = pillKey(nodeStableId(newOutNode), "output");
              next[k] = appendSig(next[k] || [], newSig);
            }
            if (newInNode) {
              const k = pillKey(nodeStableId(newInNode), "input");
              const cur = next[k] || [];
              if (connection.targetHandle === "add-top") {
                next[k] = insertAt(cur, newSig, 0);
              } else if (connection.targetHandle?.startsWith("slot-")) {
                const existingSig = connection.targetHandle.slice(5);
                const idx = cur.indexOf(existingSig);
                next[k] = insertAt(cur, newSig, idx >= 0 ? idx : cur.length);
              } else {
                next[k] = appendSig(cur, newSig);
              }
            }
            return next;
          });

          setEdges((eds) => eds.filter((e) => e.id !== String(matchingLink.id)));
          return;
        }
      }

      // ── New connection: drag from add-top / add-bot / anon handle ──
      sendCommand({
        cmd: "link_nodes",
        output_node_id: parseInt(connection.source),
        input_node_id: parseInt(connection.target),
      });

      const sig = getSig(connection.source, connection.target);
      const outNode = nodesById[connection.source];
      const inNode  = nodesById[connection.target];

      setSlotMap((prev) => {
        const next = { ...prev };

        // Source output side: add-top → prepend, everything else → append
        if (outNode) {
          const k = pillKey(nodeStableId(outNode), "output");
          next[k] = connection.sourceHandle === "add-top"
            ? insertAt(prev[k], sig, 0)
            : appendSig(prev[k], sig);
        }

        // Target input side: add-top → prepend, slot-X → insert before X, else → append
        if (inNode) {
          const k = pillKey(nodeStableId(inNode), "input");
          const cur = next[k] || [];
          if (connection.targetHandle === "add-top") {
            next[k] = insertAt(cur, sig, 0);
          } else if (connection.targetHandle?.startsWith("slot-")) {
            const existingSig = connection.targetHandle.slice(5);
            const idx = cur.indexOf(existingSig);
            next[k] = insertAt(cur, sig, idx >= 0 ? idx : cur.length);
          } else {
            next[k] = appendSig(cur, sig);
          }
        }

        return next;
      });

      // Optimistic edge — clear handle IDs (add-* handles are transient)
      setEdges((eds) =>
        addEdge({
          ...connection,
          sourceHandle: null,
          targetHandle: null,
          style: { stroke: "#888", strokeWidth: 1 },
        }, eds)
      );
    },
    [sendCommand, setEdges, getSig, nodesById, setSlotMap, graphLinksRef]
  );

  // Delete a PipeWire link when user removes an edge (select + Delete key)
  const handleEdgesChange = useCallback(
    (changes) => {
      changes
        .filter((c) => c.type === "remove")
        .forEach((c) => {
          sendCommand({ cmd: "unlink_nodes", link_id: parseInt(c.id) });
          // Remove sig from slot map
          const edge = edges.find((e) => e.id === c.id);
          if (edge?.sourceHandle?.startsWith("slot-")) {
            const sig = edge.sourceHandle.slice(5);
            const outNode = nodesById[edge.source];
            const inNode  = nodesById[edge.target];
            setSlotMap((prev) => {
              const next = { ...prev };
              if (outNode) next[pillKey(nodeStableId(outNode), "output")] = removeSig(prev[pillKey(nodeStableId(outNode), "output")], sig);
              if (inNode)  next[pillKey(nodeStableId(inNode),  "input")]  = removeSig(prev[pillKey(nodeStableId(inNode),  "input")],  sig);
              return next;
            });
          }
        });
      onEdgesChange(changes);
    },
    [onEdgesChange, sendCommand, edges, nodesById, setSlotMap]
  );

  // ── Edge reconnection (drag an existing edge endpoint to a new target) ──
  // ReactFlow idiom: track success across Start/End so we can detect
  // "drop on canvas" (no successful onReconnect fired) and delete the edge.
  const edgeReconnectSuccess = useRef(false);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccess.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      edgeReconnectSuccess.current = true;
      // If user dropped onto the same source/target pair, no-op
      if (
        String(oldEdge.source) === String(newConnection.source) &&
        String(oldEdge.target) === String(newConnection.target)
      ) {
        return;
      }
      // Delete the old PipeWire link, create the new one. PipeWire will echo
      // both as object_removed/object_added; the dedupe in buildFlowEdges
      // handles the brief window where both old and new might coexist.
      sendCommand({ cmd: "unlink_nodes", link_id: parseInt(oldEdge.id) });
      sendCommand({
        cmd: "link_nodes",
        output_node_id: parseInt(newConnection.source),
        input_node_id: parseInt(newConnection.target),
      });

      const oldSig = oldEdge.sourceHandle?.startsWith("slot-") ? oldEdge.sourceHandle.slice(5) : null;
      const newSig = getSig(newConnection.source, newConnection.target);
      const oldOutNode = nodesById[oldEdge.source];
      const oldInNode  = nodesById[oldEdge.target];
      const newOutNode = nodesById[newConnection.source];
      const newInNode  = nodesById[newConnection.target];

      setSlotMap((prev) => {
        const next = { ...prev };
        // Remove old sig from old source/target pills
        if (oldSig) {
          if (oldOutNode) next[pillKey(nodeStableId(oldOutNode), "output")] = removeSig(prev[pillKey(nodeStableId(oldOutNode), "output")], oldSig);
          if (oldInNode)  next[pillKey(nodeStableId(oldInNode),  "input")]  = removeSig(prev[pillKey(nodeStableId(oldInNode),  "input")],  oldSig);
        }
        // Add new sig to new source output
        if (newOutNode) {
          const k = pillKey(nodeStableId(newOutNode), "output");
          next[k] = appendSig(next[k] || [], newSig);
        }
        // Add new sig to new target input (respecting drop position)
        if (newInNode) {
          const k = pillKey(nodeStableId(newInNode), "input");
          const cur = next[k] || [];
          if (newConnection.targetHandle === "add-top") {
            next[k] = insertAt(cur, newSig, 0);
          } else if (newConnection.targetHandle?.startsWith("slot-")) {
            const existingSig = newConnection.targetHandle.slice(5);
            const idx = cur.indexOf(existingSig);
            next[k] = insertAt(cur, newSig, idx >= 0 ? idx : cur.length);
          } else {
            next[k] = appendSig(cur, newSig);
          }
        }
        return next;
      });

      // Optimistic local update: remove the old edge so UI reflects the
      // intent immediately. The new edge will arrive via WS.
      setEdges((eds) => eds.filter((e) => e.id !== oldEdge.id));
    },
    [sendCommand, setEdges, getSig, nodesById, setSlotMap]
  );

  const onReconnectEnd = useCallback(
    (_, edge) => {
      if (!edgeReconnectSuccess.current) {
        // Dropped on empty canvas — delete the edge
        sendCommand({ cmd: "unlink_nodes", link_id: parseInt(edge.id) });
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        // Remove sig from slot map
        const sig = edge.sourceHandle?.startsWith("slot-") ? edge.sourceHandle.slice(5) : null;
        if (sig) {
          const outNode = nodesById[edge.source];
          const inNode  = nodesById[edge.target];
          setSlotMap((prev) => {
            const next = { ...prev };
            if (outNode) next[pillKey(nodeStableId(outNode), "output")] = removeSig(prev[pillKey(nodeStableId(outNode), "output")], sig);
            if (inNode)  next[pillKey(nodeStableId(inNode),  "input")]  = removeSig(prev[pillKey(nodeStableId(inNode),  "input")],  sig);
            return next;
          });
        }
      }
    },
    [sendCommand, setEdges, nodesById, setSlotMap]
  );

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );

  const handleVolume = useCallback(
    (v) => {
      if (selectedNodeId != null) {
        sendCommand({ cmd: "set_node_volume", node_id: selectedNodeId, volume: v });
      } else {
        sendCommand({ cmd: "set_volume", volume: v });
      }
    },
    [sendCommand, selectedNodeId]
  );
  const handleMute = useCallback(
    (m) => {
      if (selectedNodeId != null) {
        sendCommand({ cmd: "set_node_mute", node_id: selectedNodeId, muted: m });
      } else {
        sendCommand({ cmd: "set_mute", muted: m });
      }
    },
    [sendCommand, selectedNodeId]
  );

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onPaneClick={() => setSelectedNodeId(null)}
        nodeTypes={NODE_TYPES}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        colorMode="dark"
        style={{ background: "#0f0f11" }}
      >
        <Background color="#222" gap={24} />
        <Controls style={{ background: "#1a1a24", border: "1px solid #333" }} />
      </ReactFlow>

      <MasterPanel
        master={master}
        selectedNode={selectedNode}
        status={status}
        onVolume={handleVolume}
        onMute={handleMute}
      />

      {/* Title bar */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          color: "#888",
          fontSize: 13,
          fontFamily: "system-ui",
          background: "#1a1a24",
          border: "1px solid #333",
          borderRadius: 8,
          padding: "6px 12px",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ color: "#e8e8ec", fontWeight: 700 }}>Pi Audio Plumber</span>
        <span style={{ color: "#555" }}>|</span>
        <span>{graph.nodes.length} nodes</span>
        <span style={{ color: "#555" }}>{graph.links.length} links</span>
      </div>

      {/* Reset layout button */}
      <button
        onClick={() => { localStorage.removeItem(LS_KEY); setNodes(flowNodes); }}
        style={{
          position: "absolute",
          top: 56,
          left: 16,
          zIndex: 10,
          background: "#1a1a24",
          border: "1px solid #333",
          color: "#888",
          borderRadius: 6,
          padding: "5px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Reset layout
      </button>

      <DiagDrawer
        nodeId={selectedNodeId}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}
