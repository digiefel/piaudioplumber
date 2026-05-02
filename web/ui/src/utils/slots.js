export const SLOTS_KEY = "pap:slots";

export function nodeStableId(node) {
  return node.name || String(node.id);
}

export function linkSig(outStableId, inStableId) {
  return `${outStableId}|${inStableId}`;
}

export function pillKey(stableId, side) {
  return `${stableId}|${side}`;
}

export function loadSlotMap() {
  try { return JSON.parse(localStorage.getItem(SLOTS_KEY) || "{}"); }
  catch { return {}; }
}

export function saveSlotMap(map) {
  try { localStorage.setItem(SLOTS_KEY, JSON.stringify(map)); }
  catch { /* quota / private browsing */ }
}

// Sort links (each must have ._sig attached) by stored order; unknown sigs appended at end
export function applySlotOrder(links, sigOrder) {
  const sigToLink = new Map(links.map(l => [l._sig, l]));
  const ordered = [];
  const seen = new Set();
  for (const sig of (sigOrder || [])) {
    if (sigToLink.has(sig)) {
      ordered.push(sigToLink.get(sig));
      seen.add(sig);
    }
  }
  for (const l of links) {
    if (!seen.has(l._sig)) ordered.push(l);
  }
  return ordered;
}

// Insert sig at idx (removing it first if already present)
export function insertAt(order, sig, idx) {
  const without = (order || []).filter(s => s !== sig);
  const clamped = Math.max(0, Math.min(idx, without.length));
  without.splice(clamped, 0, sig);
  return without;
}

// Append sig to end (noop if already present)
export function appendSig(order, sig) {
  const arr = order || [];
  return arr.includes(sig) ? arr : [...arr, sig];
}

// Remove sig from order
export function removeSig(order, sig) {
  return (order || []).filter(s => s !== sig);
}
