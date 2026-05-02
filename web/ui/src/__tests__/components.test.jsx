import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodeBlock } from "../components/NodeBlock.jsx";
import { PillHandle } from "../components/PillHandle.jsx";
import { MasterPanel } from "../components/MasterPanel.jsx";

// React Flow Handle is a no-op in test env (no canvas layout). Expose
// id/position/top via data-attrs so we can assert ordering and slot layout.
vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type, position, style, "data-testid": testId, "data-link-id": linkId }) => (
    <div
      data-testid={testId || `handle-${type}`}
      data-id={id}
      data-position={position}
      data-top={style?.top}
      data-link-id={linkId}
      style={style}
    />
  ),
  Position: { Left: "left", Right: "right" },
}));

// ── NodeBlock ────────────────────────────────────────────────────────────────

function makeNodeData(overrides = {}) {
  return {
    node: {
      id: 1,
      name: "test.node",
      description: "Test Node",
      media_class: "Audio/Sink",
      application: null,
      state: "running",
      is_running: true,
      ...overrides,
    },
    onSelect: vi.fn(),
    isActive: false,
    incomingLinks: [],
    outgoingLinks: [],
  };
}

describe("NodeBlock", () => {
  it("renders node description", () => {
    render(<NodeBlock data={makeNodeData()} selected={false} />);
    expect(screen.getByText("Test Node")).toBeTruthy();
  });

  it("renders media class", () => {
    render(<NodeBlock data={makeNodeData()} selected={false} />);
    expect(screen.getByText("Audio/Sink")).toBeTruthy();
  });

  it("applies yellow border when selected", () => {
    const { container } = render(<NodeBlock data={makeNodeData()} selected={true} />);
    const root = container.firstChild;
    // jsdom normalizes hex → rgb
    expect(root.style.border).toContain("rgb(250, 204, 21)");
  });

  it("applies green border when running and not selected", () => {
    const { container } = render(<NodeBlock data={makeNodeData()} selected={false} />);
    const root = container.firstChild;
    expect(root.style.border).toContain("rgb(74, 222, 128)");
  });

  it("applies dim border when not running", () => {
    const { container } = render(
      <NodeBlock data={makeNodeData({ is_running: false })} selected={false} />
    );
    const root = container.firstChild;
    expect(root.style.border).toContain("rgb(68, 68, 68)");
  });

  it("calls onSelect when clicked", () => {
    const data = makeNodeData();
    render(<NodeBlock data={data} selected={false} />);
    fireEvent.click(screen.getByText("Test Node"));
    expect(data.onSelect).toHaveBeenCalledWith(data.node);
  });

  it("renders volume badge when node has a volume", () => {
    render(<NodeBlock data={makeNodeData({ volume: 0.4, muted: false })} selected={false} />);
    expect(screen.getByText(/Vol:\s*40%/)).toBeTruthy();
  });

  it("shows '(muted)' when node is muted", () => {
    render(<NodeBlock data={makeNodeData({ volume: 0.4, muted: true })} selected={false} />);
    expect(screen.getByText(/\(muted\)/)).toBeTruthy();
  });

  it("hides volume badge when node has no volume info", () => {
    const { queryByText } = render(<NodeBlock data={makeNodeData()} selected={false} />);
    expect(queryByText(/Vol:/)).toBeNull();
  });
});

// ── PillHandle ───────────────────────────────────────────────────────────────

describe("PillHandle", () => {
  it("renders an anonymous handle + '+' glyph when no links and not expanded", () => {
    const { container } = render(<PillHandle side="input" links={[]} expanded={false} />);
    expect(screen.getByTestId("pill-anon")).toBeTruthy();
    expect(container.textContent).toContain("+");
  });

  it("renders one Handle per link in sorted slot order", () => {
    // Two incoming links with peers 5 and 1; sorted slot order = [peer1, peer5]
    const links = [
      { id: 100, output_node_id: 5, input_node_id: 999, state: "active" },
      { id: 200, output_node_id: 1, input_node_id: 999, state: "paused" },
    ];
    const { getAllByTestId } = render(
      <PillHandle side="input" links={links} expanded={false} />
    );
    const segments = getAllByTestId("pill-segment");
    expect(segments).toHaveLength(2);
    // First slot in DOM order should be the peer-1 link (id=200)
    expect(segments[0].getAttribute("data-link-id")).toBe("200");
    expect(segments[1].getAttribute("data-link-id")).toBe("100");
  });

  it("uses slotHandleId convention so edges can target the right slot", () => {
    const links = [{ id: 42, output_node_id: 5, input_node_id: 999, state: "active" }];
    const { getAllByTestId } = render(
      <PillHandle side="input" links={links} expanded={false} />
    );
    const seg = getAllByTestId("pill-segment")[0];
    // Edge will set targetHandle="in-42" → must match the Handle's id
    expect(seg.getAttribute("data-id")).toBe("in-42");
  });

  it("renders +slots above and below when expanded", () => {
    const links = [{ id: 7, output_node_id: 1, input_node_id: 999, state: "active" }];
    const { queryByTestId } = render(
      <PillHandle side="input" links={links} expanded={false} />
    );
    expect(queryByTestId("pill-add-top")).toBeNull();
    expect(queryByTestId("pill-add-bot")).toBeNull();

    const expanded = render(
      <PillHandle side="input" links={links} expanded={true} />
    );
    expect(expanded.getByTestId("pill-add-top")).toBeTruthy();
    expect(expanded.getByTestId("pill-add-bot")).toBeTruthy();
  });

  it("renders source-type handles when side=output", () => {
    const links = [{ id: 1, output_node_id: 999, input_node_id: 5, state: "active" }];
    const { getAllByTestId } = render(
      <PillHandle side="output" links={links} expanded={false} />
    );
    // Our mock uses data-testid="pill-segment" for connection slots
    expect(getAllByTestId("pill-segment")[0].getAttribute("data-id")).toBe("out-1");
  });

  it("pill height grows with number of links", () => {
    const { container: c0 } = render(<PillHandle side="input" links={[]} expanded={false} />);
    const { container: c2 } = render(
      <PillHandle
        side="input"
        links={[
          { id: 1, output_node_id: 1, input_node_id: 999, state: "active" },
          { id: 2, output_node_id: 2, input_node_id: 999, state: "paused" },
        ]}
        expanded={false}
      />
    );
    const h0 = parseInt(c0.firstChild.style.height);
    const h2 = parseInt(c2.firstChild.style.height);
    expect(h2).toBeGreaterThan(h0);
  });

  it("expanded pill is taller than collapsed pill (room for +slots)", () => {
    const links = [{ id: 1, output_node_id: 1, input_node_id: 999, state: "active" }];
    const { container: cCollapsed } = render(
      <PillHandle side="input" links={links} expanded={false} />
    );
    const { container: cExpanded } = render(
      <PillHandle side="input" links={links} expanded={true} />
    );
    const h0 = parseInt(cCollapsed.firstChild.style.height);
    const h1 = parseInt(cExpanded.firstChild.style.height);
    expect(h1).toBeGreaterThan(h0);
  });
});

// ── MasterPanel ──────────────────────────────────────────────────────────────

describe("MasterPanel", () => {
  const baseMaster = { volume: 0.8, muted: false, sink_name: "hw:CARD" };

  it("shows 'Master' title when no node selected", () => {
    render(
      <MasterPanel master={baseMaster} selectedNode={null} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    expect(screen.getByText("Master")).toBeTruthy();
  });

  it("shows 'Selected' title when a node is selected", () => {
    const node = { id: 5, description: "My Node", name: "my.node" };
    render(
      <MasterPanel master={baseMaster} selectedNode={node} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    expect(screen.getByText("Selected")).toBeTruthy();
  });

  it("shows selected node name when a node is selected", () => {
    const node = { id: 5, description: "My Node", name: "my.node" };
    render(
      <MasterPanel master={baseMaster} selectedNode={node} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    expect(screen.getByText(/My Node/)).toBeTruthy();
  });

  it("hides sink name when a node is selected", () => {
    const node = { id: 5, description: "My Node", name: "my.node" };
    const { queryByText } = render(
      <MasterPanel master={baseMaster} selectedNode={node} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    expect(queryByText(/hw:CARD/)).toBeNull();
  });

  it("shows sink name when no node selected", () => {
    render(
      <MasterPanel master={baseMaster} selectedNode={null} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    expect(screen.getByText(/hw:CARD/)).toBeTruthy();
  });

  it("applies yellow accent when node is selected", () => {
    const node = { id: 5, description: "My Node" };
    const { getByText } = render(
      <MasterPanel master={baseMaster} selectedNode={node} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    const title = getByText("Selected");
    // jsdom normalizes #facc15 → rgb(250, 204, 21)
    expect(title.style.color).toBe("rgb(250, 204, 21)");
  });

  it("calls onMute when mute button clicked", () => {
    const onMute = vi.fn();
    render(
      <MasterPanel master={baseMaster} selectedNode={null} status="connected" onVolume={() => {}} onMute={onMute} />
    );
    fireEvent.click(screen.getByText(/Unmuted/i));
    expect(onMute).toHaveBeenCalledWith(true);
  });

  it("shows status dot with connected color", () => {
    const { container } = render(
      <MasterPanel master={baseMaster} selectedNode={null} status="connected" onVolume={() => {}} onMute={() => {}} />
    );
    const dot = container.querySelector("[style*='border-radius: 50%']");
    // jsdom normalizes #4ade80 → rgb(74, 222, 128)
    expect(dot.style.background).toBe("rgb(74, 222, 128)");
  });

  it("uses selected node's volume as slider baseline (not master)", () => {
    const node = { id: 5, description: "My Node", volume: 0.3, muted: false };
    const { container } = render(
      <MasterPanel
        master={{ volume: 0.8, muted: false }}
        selectedNode={node}
        status="connected"
        onVolume={() => {}}
        onMute={() => {}}
      />
    );
    // Slider value is local state initialized from baseline; should reflect node.volume (30) not master (80)
    const slider = container.querySelector("input[type='range']");
    expect(slider.value).toBe("30");
  });

  it("reflects selected node's mute state on the mute button", () => {
    const node = { id: 5, description: "My Node", volume: 0.5, muted: true };
    render(
      <MasterPanel
        master={{ volume: 0.8, muted: false }}
        selectedNode={node}
        status="connected"
        onVolume={() => {}}
        onMute={() => {}}
      />
    );
    expect(screen.getByText(/Muted/i)).toBeTruthy();
  });
});
