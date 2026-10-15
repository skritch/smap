import { relativeDir, type Dir } from "./geometry";
import { ancestors, childrenOf, siblings, type Index } from "./model";

/** Renderer-side navigation state; starts from MapDoc.startFocus. */
export interface ViewState {
  focus: string;
}

export interface ViewEdge {
  key: string;
  from: string;
  to: string;
  labels: string[];
}

/** What is visible at a focus: the frame, its interior, and context around it. */
export interface View {
  focus: string;
  children: string[];
  /** Context boxes outside the frame, with the side they sit on. */
  neighbors: Map<string, Dir>;
  edges: ViewEdge[];
}

export function deriveView(ix: Index, state: ViewState): View {
  const { focus } = state;
  const children = childrenOf(ix, focus);
  const childSet = new Set(children);

  // Candidate context: siblings of the focus and of each of its ancestors,
  // placed by where they sit relative to that box one level up.
  const frontier = new Map<string, Dir>();
  for (const a of [focus, ...ancestors(ix, focus)]) {
    for (const s of siblings(ix, a)) frontier.set(s, relativeDir(ix, s, a));
  }

  // Move an edge endpoint up to the nearest box that is drawn at this focus.
  const lift = (id: string): string | null => {
    for (let cur: string | undefined = id; cur !== undefined; cur = ix.parent.get(cur)) {
      if (cur === focus || childSet.has(cur) || frontier.has(cur)) return cur;
    }
    return null;
  };
  const inside = (id: string) => id === focus || childSet.has(id);

  const edges = new Map<string, ViewEdge>();
  for (const e of ix.doc.edges) {
    const from = lift(e.from);
    const to = lift(e.to);
    if (!from || !to || from === to || (!inside(from) && !inside(to))) continue;
    const key = `${from}->${to}`;
    let ve = edges.get(key);
    if (!ve) edges.set(key, (ve = { key, from, to, labels: [] }));
    if (e.label && !ve.labels.includes(e.label)) ve.labels.push(e.label);
  }

  // Show context that connects to the frame. Top-level neighbors are declared
  // context, so they show at top level even when unconnected.
  const connected = new Set([...edges.values()].flatMap((e) => [e.from, e.to]));
  const atTop = !ix.parent.has(focus);
  const neighbors = new Map(
    [...frontier].filter(([id]) => connected.has(id) || (atTop && !ix.parent.has(id))),
  );

  return { focus, children, neighbors, edges: [...edges.values()] };
}
