import { relativeDir, type Dir } from "./geometry";
import { ancestors, childContaining, childrenOf, isAmbient, siblings, type Index } from "./model";

/** Most boxes a spotlight opens the frame's interior up to. */
const SPOTLIGHT_BUDGET = 6;

/** Ambient boxes inside the codebase (config) never act as neighbors. */
function isInternalAmbient(ix: Index, id: string): boolean {
  return isAmbient(ix, id) && !ix.doc.boxes[id]?.external;
}

/** Renderer-side navigation state; starts from MapDoc.startFocus. */
export interface ViewState {
  focus: string;
  /** An external box whose connections are highlighted. */
  selected?: string;
}

export interface ViewEdge {
  key: string;
  from: string;
  to: string;
  labels: string[];
  /** Unlifted endpoints of the map edges merged into this one. */
  origins: [string, string][];
  /** Merged from edges in both directions; drawn as one double-ended arrow. */
  both?: boolean;
}

/** Highlighting for a selected box. */
export interface Selection {
  id: string;
  /** Visible boxes at the other end of the selected box's edges. */
  related: Set<string>;
  edges: Set<string>;
}

/** What is visible at a focus: the frame, its interior, and context around it. */
export interface View {
  focus: string;
  children: string[];
  /** Ambient boxes in scope, shown as chips in the frame header. */
  chips: string[];
  /** Context boxes outside the frame, with the side they sit on. */
  neighbors: Map<string, Dir>;
  edges: ViewEdge[];
  selection?: Selection;
  /** Set when a selected external narrows the view to what it connects to. */
  spotlight?: Spotlight;
}

export interface Spotlight {
  id: string;
  /** The view before narrowing; the spotlight keeps its scale. */
  base: View;
}

export function deriveView(ix: Index, state: ViewState): View {
  const { focus } = state;
  const lineage = [focus, ...ancestors(ix, focus)];

  // The focus's own ambient children show as chips in the frame header. An
  // ancestor's ambient boxes are not drawn: zoomed in, we are inside them.
  const chips = childrenOf(ix, focus).filter((c) => isAmbient(ix, c));
  const chipSet = new Set(chips);
  const children = childrenOf(ix, focus).filter((c) => !chipSet.has(c));
  const childSet = new Set(children);

  // Candidate context: siblings of the focus and of each of its ancestors,
  // placed by where they sit relative to that box one level up.
  const frontier = new Map<string, Dir>();
  for (const a of lineage) {
    for (const s of siblings(ix, a)) if (!isInternalAmbient(ix, s)) frontier.set(s, relativeDir(ix, s, a));
  }

  // Move an edge endpoint up to the nearest box that is drawn at this focus.
  const lift = (id: string): string | null => {
    for (let cur: string | undefined = id; cur !== undefined; cur = ix.parent.get(cur)) {
      if (cur === focus || childSet.has(cur) || chipSet.has(cur) || frontier.has(cur)) return cur;
    }
    return null;
  };
  const inside = (id: string) => id === focus || childSet.has(id);

  const edges = new Map<string, ViewEdge>();
  const ambientEdges = new Map<string, ViewEdge>();
  // Edges between two context boxes; drawn only between neighbors on one side.
  const outer = new Map<string, ViewEdge>();
  for (const e of ix.doc.edges) {
    let from = lift(e.from);
    let to = lift(e.to);
    if (!from || !to) continue;
    // Edges to an ambient chip are summarized by the chip: kept for selection, not drawn.
    const target = chipSet.has(from) || chipSet.has(to) ? ambientEdges : edges;
    // Edges to an ambient box outside the frame collapse onto the frame.
    if (isAmbient(ix, to) && frontier.has(to) && inside(from)) from = focus;
    if (isAmbient(ix, from) && frontier.has(from) && inside(to)) to = focus;
    if (from === to) continue;
    let into = target;
    if (!inside(from) && !inside(to) && target === edges) {
      if (isAmbient(ix, from) || isAmbient(ix, to)) continue;
      into = outer;
    }
    addEdge(into, from, to, e);
  }

  // Show context that connects to the frame. The start focus's neighbors are
  // declared context, so they show there even when unconnected.
  const connected = new Set([...edges.values()].flatMap((e) => [e.from, e.to]));
  const atStart = focus === ix.doc.startFocus;
  const neighbors = new Map(
    [...frontier].filter(([id]) => connected.has(id) || (atStart && !ix.parent.has(id))),
  );

  // Neighbors stacked on the same side keep the edges between them, so their
  // order (ingest before clean) stays visible.
  for (const ve of outer.values()) {
    const side = neighbors.get(ve.from);
    if (side && side === neighbors.get(ve.to)) edges.set(ve.key, ve);
  }

  mergeOpposites(edges);

  const view: View = { focus, children, chips, neighbors, edges: [...edges.values()] };
  const sel = state.selected;
  if (sel && neighbors.has(sel) && ix.doc.boxes[sel]?.external) return spotlight(ix, view, sel);
  if (sel && (childSet.has(sel) || chipSet.has(sel) || neighbors.has(sel))) {
    view.selection = select(sel, [...edges.values(), ...ambientEdges.values()], lift);
  }
  return view;
}

/**
 * Narrows `base` to a selected external and what it connects to. Unrelated
 * boxes drop out, and the room they leave opens connected boxes up to show
 * the boxes inside them that the connections really reach, while the
 * interior stays within budget.
 */
function spotlight(ix: Index, base: View, id: string): View {
  const { focus } = base;
  const within = (x: string, box: string) => x === box || childContaining(ix, x, box) !== null;
  const side = base.neighbors.get(id);

  // Far ends of the selected box's edges, inside the frame or out among the
  // neighbors on its side.
  const inner = new Set<string>();
  const outer = new Set<string>();
  for (const e of ix.doc.edges) {
    const far = within(e.from, id) ? e.to : within(e.to, id) ? e.from : null;
    if (far === null || within(far, id)) continue;
    if (within(far, focus)) inner.add(far);
    else {
      const n = [...base.neighbors.keys()].find((n) => within(far, n));
      if (n && base.neighbors.get(n) === side) outer.add(n);
    }
  }

  // The boxes directly inside `box` that hold a far end.
  const containing = (box: string) =>
    [...new Set([...inner].map((x) => childContaining(ix, x, box)))].filter((c) => c !== null);
  const opened = containing(focus);
  const chips = opened.filter((c) => base.chips.includes(c));
  const items = opened.filter((c) => !base.chips.includes(c));
  // Open boxes up a level at a time, while the budget allows.
  for (let i = 0; i < items.length; ) {
    const item = items[i]!;
    const kids = inner.has(item) ? [] : containing(item);
    if (kids.length && !kids.some((k) => isAmbient(ix, k)) && items.length - 1 + kids.length <= SPOTLIGHT_BUDGET) {
      items.splice(i, 1, ...kids);
      i = 0;
    } else i++;
  }

  const neighbors = new Map([...base.neighbors].filter(([n]) => n === id || outer.has(n)));
  const shown = new Set([focus, ...items, ...chips, ...neighbors.keys()]);
  const lift = (x: string): string | null => {
    for (let cur: string | undefined = x; cur !== undefined; cur = ix.parent.get(cur)) if (shown.has(cur)) return cur;
    return null;
  };
  const edges = new Map<string, ViewEdge>();
  for (const e of ix.doc.edges) {
    const from = lift(e.from);
    const to = lift(e.to);
    if (!from || !to || from === to || chips.includes(from) || chips.includes(to)) continue;
    // Edges lifted onto the frame lead to boxes the spotlight hides.
    if ((from === focus || to === focus) && from !== id && to !== id) continue;
    if (neighbors.has(from) && neighbors.has(to) && from !== id && to !== id) continue;
    addEdge(edges, from, to, e);
  }
  mergeOpposites(edges);

  const view: View = { focus, children: items, chips, neighbors, edges: [...edges.values()], spotlight: { id, base } };
  view.selection = {
    id,
    related: new Set([...shown].filter((x) => x !== focus && x !== id)),
    edges: new Set(view.edges.filter((e) => e.from === id || e.to === id).map((e) => e.key)),
  };
  return view;
}

function addEdge(into: Map<string, ViewEdge>, from: string, to: string, e: { from: string; to: string; label?: string }) {
  const key = `${from}->${to}`;
  let ve = into.get(key);
  if (!ve) into.set(key, (ve = { key, from, to, labels: [], origins: [] }));
  if (e.label && !ve.labels.includes(e.label)) ve.labels.push(e.label);
  ve.origins.push([e.from, e.to]);
}

/** A pair of opposite edges becomes one double-ended edge. */
function mergeOpposites(edges: Map<string, ViewEdge>) {
  for (const ve of edges.values()) {
    const back = edges.get(`${ve.to}->${ve.from}`);
    if (!back || ve.both) continue;
    edges.delete(back.key);
    ve.both = true;
    ve.origins.push(...back.origins);
    for (const l of back.labels) if (!ve.labels.includes(l)) ve.labels.push(l);
  }
}

/**
 * Highlights everything the selected box connects to, using the unlifted
 * edges so collapsed and hidden connections still point at the right boxes.
 */
function select(id: string, edges: ViewEdge[], lift: (id: string) => string | null): Selection {
  const sel: Selection = { id, related: new Set(), edges: new Set() };
  for (const e of edges) {
    if (e.from !== id && e.to !== id) continue;
    sel.edges.add(e.key);
    for (const [a, b] of e.origins) {
      const inner = lift(a) === id ? b : a;
      const other = lift(inner);
      if (other && other !== id) sel.related.add(other);
    }
  }
  return sel;
}
