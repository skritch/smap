import type { Side } from "@smap/ir";
import { childContaining, childrenOf, isAmbient, type Index } from "./model";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Dir = Exclude<Side, "in">;

export const BOX_H = 44;
const LAYER_GAP = 40;
const ROW_GAP = 20;
/** Vertical space reserved for an edge passing through a layer. */
const LANE_H = 8;

export function boxSize(ix: Index, id: string): { w: number; h: number } {
  const label = ix.doc.boxes[id]?.label ?? id;
  return { w: Math.min(240, Math.max(110, label.length * 7.5 + 32)), h: BOX_H };
}

/** Merged edge labels collapse to the first one plus a count. */
export function labelText(labels: string[]): string {
  return labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : (labels[0] ?? "");
}

/** Rough rendered width of small (11px) text. */
export function textWidth(text: string, px = 11): number {
  return text.length * px * 0.58;
}

/** Children of a box, positioned relative to the top-left of its interior. */
export interface Interior {
  rects: Map<string, Rect>;
  /** Waypoints for edges that skip layers, keyed by `from->to`. */
  bends: Map<string, Point[]>;
  w: number;
  h: number;
}

interface InteriorEdge {
  key: string;
  from: string;
  to: string;
  labels: string[];
}

const interiors = new WeakMap<Index, Map<string, Interior>>();

/**
 * Lays out a box's children left → right by dataflow. Depends only on the
 * box's own subtree, so an interior looks the same from every focus.
 * With `labels`, gaps widen to fit edge labels.
 */
export function layoutInterior(ix: Index, id: string, labels = false): Interior {
  let byId = interiors.get(ix);
  if (!byId) interiors.set(ix, (byId = new Map()));
  const key = `${id}|${labels}`;
  let out = byId.get(key);
  if (!out) byId.set(key, (out = computeInterior(ix, id, labels)));
  return out;
}

function computeInterior(ix: Index, id: string, labels: boolean): Interior {
  // Ambient children sit in the frame header, outside the dataflow.
  const nodes = childrenOf(ix, id).filter((c) => !isAmbient(ix, c));
  const edges = internalEdges(ix, id);
  const layer = assignLayers(nodes, edges.map((e) => [e.from, e.to]));

  // Edges spanning several layers get a lane node in each layer they cross,
  // so ordering keeps them clear of boxes.
  const all = [...nodes];
  const segments: [string, string][] = [];
  const lanes = new Map<string, string[]>();
  for (const e of edges) {
    const la = layer.get(e.from)!;
    const lb = layer.get(e.to)!;
    const chain: string[] = [];
    let prev = e.from;
    for (let l = la + 1; l < lb; l++) {
      const lane = `${e.key}#${l}`;
      layer.set(lane, l);
      all.push(lane);
      chain.push(lane);
      segments.push([prev, lane]);
      prev = lane;
    }
    segments.push([prev, e.to]);
    if (chain.length) lanes.set(e.key, chain);
  }
  const isLane = (n: string) => !nodes.includes(n);
  const layers = orderLayers(all, segments, layer);

  // Each gap is wide enough for the labels of edges leaving that layer.
  const gaps = layers.map((_, i) =>
    Math.max(
      LAYER_GAP,
      ...edges
        .filter((e) => labels && e.labels.length && layer.get(e.from) === i)
        .map((e) => textWidth(labelText(e.labels)) + 32),
    ),
  );

  const cols = layers.map((l) => l.map((n) => ({ id: n, ...(isLane(n) ? { w: 0, h: LANE_H } : boxSize(ix, n)) })));
  const colH = cols.map((col) => col.reduce((s, b) => s + b.h, 0) + ROW_GAP * (col.length - 1));
  const h = Math.max(0, ...colH);
  const rects = new Map<string, Rect>();
  let x = 0;
  cols.forEach((col, i) => {
    const colW = Math.max(...col.map((b) => b.w));
    let y = (h - colH[i]!) / 2;
    for (const b of col) {
      rects.set(b.id, { x: x + (colW - b.w) / 2, y, w: b.w, h: b.h });
      y += b.h + ROW_GAP;
    }
    x += colW + gaps[i]!;
  });

  const bends = new Map<string, Point[]>();
  for (const [key, chain] of lanes) {
    bends.set(
      key,
      chain.map((n) => {
        const r = rects.get(n)!;
        return { x: r.x, y: r.y + r.h / 2 };
      }),
    );
    chain.forEach((n) => rects.delete(n));
  }
  return { rects, bends, w: Math.max(0, x - (gaps.at(-1) ?? 0)), h };
}

/** Edges between descendants of `id`, lifted to its children and merged. */
function internalEdges(ix: Index, id: string): InteriorEdge[] {
  const out = new Map<string, InteriorEdge>();
  for (const e of ix.doc.edges) {
    const from = childContaining(ix, e.from, id);
    const to = childContaining(ix, e.to, id);
    if (!from || !to || from === to || isAmbient(ix, from) || isAmbient(ix, to)) continue;
    const key = `${from}->${to}`;
    let ie = out.get(key);
    if (!ie) out.set(key, (ie = { key, from, to, labels: [] }));
    if (e.label && !ie.labels.includes(e.label)) ie.labels.push(e.label);
  }
  return [...out.values()];
}

/** Longest-path layering, after dropping edges that close a cycle. */
function assignLayers(nodes: string[], edges: [string, string][]): Map<string, number> {
  const succ = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [a, b] of edges) succ.get(a)!.push(b);

  const preds = new Map(nodes.map((n) => [n, [] as string[]]));
  const state = new Map<string, "open" | "done">();
  const visit = (n: string) => {
    state.set(n, "open");
    for (const m of succ.get(n)!) {
      if (state.get(m) === "open") continue; // back edge
      preds.get(m)!.push(n);
      if (!state.has(m)) visit(m);
    }
    state.set(n, "done");
  };
  for (const n of nodes) if (!state.has(n)) visit(n);

  const layer = new Map<string, number>();
  const depth = (n: string): number => {
    let d = layer.get(n);
    if (d === undefined) {
      d = Math.max(0, ...preds.get(n)!.map((p) => depth(p) + 1));
      layer.set(n, d);
    }
    return d;
  };
  nodes.forEach(depth);
  return layer;
}

/** Groups nodes by layer, then reorders within layers by barycenter sweeps to cut crossings. */
function orderLayers(nodes: string[], edges: [string, string][], layer: Map<string, number>): string[][] {
  const layers: string[][] = Array.from({ length: Math.max(-1, ...layer.values()) + 1 }, () => []);
  for (const n of nodes) layers[layer.get(n)!]!.push(n);

  const nbrs = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [a, b] of edges) {
    nbrs.get(a)!.push(b);
    nbrs.get(b)!.push(a);
  }
  const pos = new Map<string, number>();
  const setPos = (l: string[]) => l.forEach((n, i) => pos.set(n, (i + 0.5) / l.length));
  layers.forEach(setPos);

  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0;
    const order = [...layers.keys()];
    if (!down) order.reverse();
    for (const i of order) {
      const l = layers[i]!;
      const bary = new Map(
        l.map((n) => {
          const ps = nbrs
            .get(n)!
            .filter((m) => (down ? layer.get(m)! < i : layer.get(m)! > i))
            .map((m) => pos.get(m)!);
          return [n, ps.length ? ps.reduce((s, p) => s + p, 0) / ps.length : pos.get(n)!];
        }),
      );
      l.sort((a, b) => bary.get(a)! - bary.get(b)!);
      setPos(l);
    }
  }
  return layers;
}

const SIDE_VEC: Record<Side, [number, number]> = {
  in: [0, 0],
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * Direction of `s` as seen from its sibling `a`: from where they sit in their
 * parent's interior, or at top level from their declared sides.
 */
export function relativeDir(ix: Index, s: string, a: string): Dir {
  const p = ix.parent.get(a);
  const placed = p !== undefined && layoutInterior(ix, p).rects;
  let dx: number;
  let dy: number;
  if (!placed || !placed.has(s) || !placed.has(a)) {
    // Top level, or an ambient box with no place in the interior: use declared sides.
    const [sx, sy] = SIDE_VEC[ix.doc.boxes[s]?.side ?? "in"];
    const [ax, ay] = SIDE_VEC[ix.doc.boxes[a]?.side ?? "in"];
    [dx, dy] = [sx - ax, sy - ay];
  } else {
    const rs = placed.get(s)!;
    const ra = placed.get(a)!;
    [dx, dy] = [rs.x + rs.w / 2 - (ra.x + ra.w / 2), rs.y + rs.h / 2 - (ra.y + ra.h / 2)];
  }
  if (dx === 0 && dy === 0) return "right";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}
