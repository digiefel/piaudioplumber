import { describe, it, expect } from "vitest";
import { normalizeLink, normalizeNode } from "../hooks/useDaemon.js";
import { buildFlowEdges, isNodeActive } from "../App.jsx";
import { slotHandleId, sortedSlots } from "../utils/slots.js";

// ── normalizeLink ────────────────────────────────────────────────────────────

describe("normalizeLink", () => {
  it("passes through already-flat snapshot shape", () => {
    const link = { id: 10, output_node_id: 1, input_node_id: 2, state: "active" };
    expect(normalizeLink(link)).toEqual(link);
  });

  it("normalizes raw GraphObject shape (hyphenated keys)", () => {
    const raw = {
      id: 10,
      type: "PipeWire:Interface:Link",
      info: {
        "output-node-id": 1,
        "input-node-id": 2,
        state: "paused",
      },
    };
    expect(normalizeLink(raw)).toEqual({
      id: 10,
      output_node_id: 1,
      input_node_id: 2,
      state: "paused",
    });
  });

  it("handles missing info gracefully", () => {
    const raw = { id: 5, type: "PipeWire:Interface:Link" };
    const result = normalizeLink(raw);
    expect(result.id).toBe(5);
    expect(result.output_node_id).toBeNull();
    expect(result.input_node_id).toBeNull();
    expect(result.state).toBeNull();
  });
});

// ── normalizeNode ────────────────────────────────────────────────────────────

describe("normalizeNode", () => {
  it("normalizes raw GraphObject node", () => {
    const raw = {
      id: 42,
      type: "PipeWire:Interface:Node",
      info: {
        state: "running",
        props: {
          "node.name": "alsa.test",
          "node.description": "Test Sink",
          "media.class": "Audio/Sink",
          "application.name": "TestApp",
        },
      },
    };
    const result = normalizeNode(raw);
    expect(result.id).toBe(42);
    expect(result.name).toBe("alsa.test");
    expect(result.description).toBe("Test Sink");
    expect(result.media_class).toBe("Audio/Sink");
    expect(result.application).toBe("TestApp");
    expect(result.state).toBe("running");
    expect(result.is_running).toBe(true);
  });

  it("passes through already-normalized snapshot node", () => {
    const node = { id: 7, is_running: true, media_class: "Audio/Source", state: "running", name: "x" };
    expect(normalizeNode(node)).toEqual(node);
  });

  it("sets is_running false when state is not running", () => {
    const raw = { id: 1, type: "PipeWire:Interface:Node", info: { state: "idle", props: {} } };
    expect(normalizeNode(raw).is_running).toBe(false);
  });
});

// ── buildFlowEdges ───────────────────────────────────────────────────────────

describe("buildFlowEdges", () => {
  it("filters out links with null endpoints", () => {
    const links = [
      { id: 1, output_node_id: 10, input_node_id: null, state: "active" },
      { id: 2, output_node_id: null, input_node_id: 20, state: "active" },
      { id: 3, output_node_id: 10, input_node_id: 20, state: "active" },
    ];
    const edges = buildFlowEdges(links);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("3");
  });

  it("sets animated and stroke for active links", () => {
    const links = [{ id: 5, output_node_id: 1, input_node_id: 2, state: "active" }];
    const [edge] = buildFlowEdges(links);
    expect(edge.animated).toBe(true);
    expect(edge.style.stroke).toBe("#4ade80");
  });

  it("strips LinkState prefix from label", () => {
    const links = [{ id: 6, output_node_id: 1, input_node_id: 2, state: "LinkState.paused" }];
    const [edge] = buildFlowEdges(links);
    expect(edge.label).toBe("paused");
  });

  it("produces no NaN in source/target", () => {
    const links = [{ id: 99, output_node_id: 100, input_node_id: 200, state: "active" }];
    const [edge] = buildFlowEdges(links);
    expect(isNaN(Number(edge.source))).toBe(false);
    expect(isNaN(Number(edge.target))).toBe(false);
  });

  it("marks every edge reconnectable", () => {
    const links = [{ id: 1, output_node_id: 10, input_node_id: 20, state: "active" }];
    const [edge] = buildFlowEdges(links);
    expect(edge.reconnectable).toBe(true);
  });

  it("dedupes by (source,target) pair, keeping the higher link id", () => {
    // Simulates the optimistic-delete + WS-echo race: old link 5 and new link 9
    // briefly coexist for the same A->B pair. Render only the newer one.
    const links = [
      { id: 5, output_node_id: 10, input_node_id: 20, state: "active" },
      { id: 9, output_node_id: 10, input_node_id: 20, state: "paused" },
    ];
    const edges = buildFlowEdges(links);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("9");
  });

  it("does not dedupe distinct pairs", () => {
    const links = [
      { id: 1, output_node_id: 10, input_node_id: 20, state: "active" },
      { id: 2, output_node_id: 10, input_node_id: 30, state: "active" },
      { id: 3, output_node_id: 11, input_node_id: 20, state: "active" },
    ];
    expect(buildFlowEdges(links)).toHaveLength(3);
  });
});

// ── isNodeActive ─────────────────────────────────────────────────────────────

describe("isNodeActive", () => {
  const makeNode = (id, is_running) => ({ id, is_running });
  const makeLink = (out, inp, state) => ({ output_node_id: out, input_node_id: inp, state });

  it("returns false when node is not running", () => {
    const node = makeNode(1, false);
    const links = [makeLink(1, 2, "active")];
    expect(isNodeActive(node, links)).toBe(false);
  });

  it("returns false when running but no active links", () => {
    const node = makeNode(1, true);
    const links = [makeLink(1, 2, "paused")];
    expect(isNodeActive(node, links)).toBe(false);
  });

  it("returns true when running with at least one active link", () => {
    const node = makeNode(1, true);
    const links = [makeLink(1, 2, "active")];
    expect(isNodeActive(node, links)).toBe(true);
  });

  it("detects activity on input side", () => {
    const node = makeNode(2, true);
    const links = [makeLink(1, 2, "active")];
    expect(isNodeActive(node, links)).toBe(true);
  });
});

// ── slot ordering ────────────────────────────────────────────────────────────

describe("slotHandleId", () => {
  it("uses 'in-<id>' for the input side", () => {
    expect(slotHandleId({ id: 42 }, "in")).toBe("in-42");
  });
  it("uses 'out-<id>' for the output side", () => {
    expect(slotHandleId({ id: 7 }, "out")).toBe("out-7");
  });
});

describe("sortedSlots", () => {
  it("sorts incoming side by output_node_id (peer) then link id", () => {
    const links = [
      { id: 100, output_node_id: 5, input_node_id: 999 },
      { id: 200, output_node_id: 1, input_node_id: 999 },
      { id: 50, output_node_id: 5, input_node_id: 999 }, // same peer as id=100
    ];
    const out = sortedSlots(links, "in");
    expect(out.map((l) => l.id)).toEqual([200, 50, 100]);
    // peer 1 first, then peer 5 (id 50 before id 100 within the same peer)
  });

  it("sorts outgoing side by input_node_id (peer) then link id", () => {
    const links = [
      { id: 100, output_node_id: 999, input_node_id: 5 },
      { id: 200, output_node_id: 999, input_node_id: 1 },
    ];
    const out = sortedSlots(links, "out");
    expect(out.map((l) => l.id)).toEqual([200, 100]);
  });

  it("returns a new array (does not mutate input)", () => {
    const links = [
      { id: 100, output_node_id: 5, input_node_id: 999 },
      { id: 200, output_node_id: 1, input_node_id: 999 },
    ];
    const original = [...links];
    sortedSlots(links, "in");
    expect(links).toEqual(original);
  });

  it("handles empty input", () => {
    expect(sortedSlots([], "in")).toEqual([]);
  });

  it("is stable across re-sorts (deterministic)", () => {
    const links = [
      { id: 9, output_node_id: 3, input_node_id: 999 },
      { id: 8, output_node_id: 3, input_node_id: 999 },
      { id: 7, output_node_id: 2, input_node_id: 999 },
    ];
    const a = sortedSlots(links, "in").map((l) => l.id);
    const b = sortedSlots([...links].reverse(), "in").map((l) => l.id);
    expect(a).toEqual(b);
  });
});

// ── buildFlowEdges sets sourceHandle/targetHandle ────────────────────────────

describe("buildFlowEdges (per-slot handle ids)", () => {
  it("sets sourceHandle and targetHandle to slotHandleId values", () => {
    const links = [{ id: 42, output_node_id: 10, input_node_id: 20, state: "active" }];
    const [edge] = buildFlowEdges(links);
    expect(edge.sourceHandle).toBe("out-42");
    expect(edge.targetHandle).toBe("in-42");
  });
});
