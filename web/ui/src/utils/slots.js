/**
 * Slot ordering for pill connection handles.
 *
 * Each side of a node renders one Handle per existing connection (a "slot").
 * For curves to stay attached to predictable positions across PipeWire
 * graph updates, the slot order must be deterministic — independent of
 * the order in which links arrive over the wire.
 *
 * Sort key: (peer_node_id ASC, link_id ASC)
 *  - peer_node_id is stable for the session
 *  - link_id is monotonic in PipeWire (newer = higher)
 *  - A reconnect to the same peer returns to the same slot
 *  - A new peer with a higher ID slots in at the bottom
 *  - A new peer between two existing peers shifts the lower half by one
 *    (acceptable; matches "connections to peer X live near X" mental model)
 */

/**
 * Stable, deterministic id for a Handle representing this link's slot.
 * Used both as the React Flow Handle `id` and as the edge's
 * `sourceHandle` / `targetHandle` so the curve attaches to the right slot.
 *
 * @param {{id: number}} link
 * @param {"in" | "out"} side
 */
export function slotHandleId(link, side) {
  return `${side}-${link.id}`;
}

/**
 * Return links sorted into the slot order this side will render in.
 *
 * @param {Array<{id: number, output_node_id: number, input_node_id: number}>} links
 * @param {"in" | "out"} side  "in" = pill on input side; peer is the output_node_id.
 */
export function sortedSlots(links, side) {
  return [...links].sort((a, b) => {
    const peerA = side === "in" ? a.output_node_id : a.input_node_id;
    const peerB = side === "in" ? b.output_node_id : b.input_node_id;
    if (peerA !== peerB) return (peerA ?? 0) - (peerB ?? 0);
    return (a.id ?? 0) - (b.id ?? 0);
  });
}
