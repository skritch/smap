import { boxSize, labelText, layoutInterior, textWidth, type Dir, type Point, type Rect } from "./geometry";
import type { Index } from "./model";
import type { View, ViewEdge } from "./view";

export type Role = "frame" | "child" | "neighbor" | "ambient";

export interface SceneBox {
  id: string;
  role: Role;
  rect: Rect;
  label: string;
  axes?: string;
  external: boolean;
  emphasis?: "selected" | "related" | "dimmed";
}

export interface SceneEdge {
  key: string;
  d: string;
  label: string;
  labelAt: Point;
  labelAnchor: "start" | "middle" | "end";
  /** Frame side the label sits outside of, for edges to neighbors. */
  labelSide?: Dir;
  emphasis?: "related" | "dimmed";
  both?: boolean;
}

/** Everything positioned, in frame coordinates (frame top-left at 0,0). */
export interface Scene {
  boxes: SceneBox[];
  edges: SceneEdge[];
  bounds: Rect;
}

const PAD = 28;
const TITLE_H = 36;
const AXES_H = 16;
const MIN_FRAME = { w: 280, h: 160 };
const CHIP_H = 22;
const CHIP_GAP = 8;
const NEIGHBOR_GAP = 56;
/** Views with more edges than this drop edge labels to stay readable. */
const LABEL_BUDGET = 8;
const LABEL_OFFSET = 8;
const LABEL_LINE = 14;
const STACK_GAP = 20;
const MARGIN = 48;
const DIRS: Dir[] = ["left", "right", "up", "down"];
const OPPOSITE: Record<Dir, Dir> = { left: "right", right: "left", up: "down", down: "up" };

export function arrange(ix: Index, view: View): Scene {
  const labels = view.edges.length <= LABEL_BUDGET;
  const interior = layoutInterior(ix, view.focus, labels);
  const axes = ix.doc.boxes[view.focus]?.axes;
  const header = TITLE_H + (axes ? AXES_H : 0);
  // Ambient chips line the right of the header, beside the title.
  const chipW = view.chips.map((id) => textWidth(ix.doc.boxes[id]?.label ?? id, 12) + 24);
  const chipsW = chipW.reduce((t, w) => t + w + CHIP_GAP, 0);
  const titleW = textWidth(ix.doc.boxes[view.focus]?.label ?? view.focus, 14);
  const fw = Math.max(
    MIN_FRAME.w,
    interior.w + 2 * PAD,
    textWidth(axes ?? "") + 2 * PAD,
    titleW + chipsW + 2 * PAD + 24,
  );
  const fh = Math.max(MIN_FRAME.h, interior.h + 2 * PAD + header);
  const ox = (fw - interior.w) / 2;
  const oy = header + (fh - header - interior.h) / 2;

  const rects = new Map<string, Rect>([[view.focus, { x: 0, y: 0, w: fw, h: fh }]]);
  for (const [id, r] of interior.rects) rects.set(id, { ...r, x: r.x + ox, y: r.y + oy });
  let chipX = fw - 12 - chipsW + CHIP_GAP;
  view.chips.forEach((id, i) => {
    rects.set(id, { x: chipX, y: 11, w: chipW[i]!, h: CHIP_H });
    chipX += chipW[i]! + CHIP_GAP;
  });

  // One stack of neighbors per side, ordered by where their edges land inside.
  for (const dir of DIRS) {
    const vertical = dir === "left" || dir === "right";
    const ids = [...view.neighbors].filter(([, d]) => d === dir).map(([id]) => id);
    if (!ids.length) continue;
    // Side gaps leave room for the edge labels that sit just outside the frame.
    const gap = !vertical || !labels
      ? NEIGHBOR_GAP
      : Math.max(
          NEIGHBOR_GAP,
          ...view.edges
            .filter((e) => ids.includes(e.from) || ids.includes(e.to))
            .map((e) => textWidth(labelText(e.labels)) + 2 * LABEL_OFFSET + 24),
        );
    // Each neighbor wants to sit level with the boxes it connects to, so its
    // edges run straight; packing only moves it as far as needed to avoid overlap.
    const target = (id: string) => {
      const ps = view.edges
        .filter((e) => e.from === id || e.to === id)
        .map((e) => center(rects.get(e.from === id ? e.to : e.from)!))
        .map((c) => (vertical ? c.y : c.x));
      return ps.length ? ps.reduce((s, p) => s + p, 0) / ps.length : (vertical ? fh : fw) / 2;
    };
    const targets = new Map(ids.map((id) => [id, target(id)]));
    ids.sort((a, b) => targets.get(a)! - targets.get(b)!);

    const sizes = ids.map((id) => boxSize(ix, id));
    const starts = pack(
      ids.map((id, i) => ({ center: targets.get(id)!, size: vertical ? sizes[i]!.h : sizes[i]!.w })),
      STACK_GAP,
    );
    const colW = Math.max(...sizes.map((s) => s.w));
    ids.forEach((id, i) => {
      const s = sizes[i]!;
      const at = starts[i]!;
      if (dir === "left") rects.set(id, { x: -gap - colW + (colW - s.w) / 2, y: at, ...s });
      else if (dir === "right") rects.set(id, { x: fw + gap + (colW - s.w) / 2, y: at, ...s });
      else rects.set(id, { x: at, y: dir === "up" ? -gap - s.h : fh + gap, ...s });
    });
  }

  const sel = view.selection;
  const box = (id: string, role: Role): SceneBox => {
    const b = ix.doc.boxes[id];
    return {
      id,
      role,
      rect: rects.get(id)!,
      label: b?.label ?? id,
      axes: b?.axes,
      external: b?.external ?? false,
      emphasis: !sel || role === "frame" ? undefined : id === sel.id ? "selected" : sel.related.has(id) ? "related" : "dimmed",
    };
  };
  const boxes = [
    box(view.focus, "frame"),
    ...view.children.map((id) => box(id, "child")),
    ...view.chips.map((id) => box(id, "ambient")),
    ...[...view.neighbors.keys()].map((id) => box(id, "neighbor")),
  ];
  const edges = view.edges.map((e) => {
    const bends = interior.bends.get(e.key)?.map((p) => ({ x: p.x + ox, y: p.y + oy })) ?? [];
    const edge = routeEdge(labels ? e : { ...e, labels: [] }, { rects, neighbors: view.neighbors, focus: view.focus, bends });
    edge.both = e.both;
    if (sel) edge.emphasis = sel.edges.has(e.key) ? "related" : "dimmed";
    return edge;
  });
  spreadLabels(edges);

  return { boxes, edges, bounds: pad(union([...rects.values()]), MARGIN) };
}

interface RouteCtx {
  rects: Map<string, Rect>;
  neighbors: Map<string, Dir>;
  focus: string;
  /** Lane waypoints for edges that skip layers. */
  bends: Point[];
}

function routeEdge(e: ViewEdge, ctx: RouteCtx): SceneEdge {
  const a = ctx.rects.get(e.from)!;
  const b = ctx.rects.get(e.to)!;
  const [pa, pb] = ctx.bends.length ? (["right", "left"] as const) : ports(e, a, b, ctx.neighbors);
  const p0 = portPoint(a, pa);
  const p1 = portPoint(b, pb);
  const label = labelText(e.labels);

  if (ctx.bends.length) {
    const pts = [p0, ...ctx.bends, p1];
    const d = pts.slice(1).reduce((acc, q, i) => {
      const p = pts[i]!;
      const mx = (p.x + q.x) / 2;
      return `${acc} C${mx},${p.y} ${mx},${q.y} ${q.x},${q.y}`;
    }, `M${p0.x},${p0.y}`);
    const first = ctx.bends[0]!;
    const labelAt = { x: (p0.x + first.x) / 2, y: (p0.y + first.y) / 2 };
    return { key: e.key, d, label, labelAt, labelAnchor: "middle" };
  }

  const k = Math.max(24, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2.5);
  const curve: Bezier = [p0, step(p0, pa, k), step(p1, pb, k), p1];
  const [, c0, c1] = curve;
  return {
    key: e.key,
    d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`,
    label,
    ...placeLabel(e, curve, ctx),
  };
}

type Bezier = [Point, Point, Point, Point];

function bezierAt([p0, c0, c1, p1]: Bezier, t: number): Point {
  const u = 1 - t;
  const f = (k: "x" | "y") => u * u * u * p0[k] + 3 * u * u * t * c0[k] + 3 * u * t * t * c1[k] + t * t * t * p1[k];
  return { x: f("x"), y: f("y") };
}

/**
 * Labels on edges to neighbors sit just outside the frame where the edge
 * crosses its border, like a port label; others sit mid-curve.
 */
function placeLabel(e: ViewEdge, curve: Bezier, ctx: RouteCtx): Pick<SceneEdge, "labelAt" | "labelAnchor" | "labelSide"> {
  const dir = ctx.neighbors.get(e.from) ?? ctx.neighbors.get(e.to);
  if (!dir || e.from === ctx.focus || e.to === ctx.focus) {
    return { labelAt: bezierAt(curve, 0.5), labelAnchor: "middle" };
  }
  const frame = ctx.rects.get(ctx.focus)!;
  const axis = dir === "left" || dir === "right" ? "x" : "y";
  const border = { left: frame.x, right: frame.x + frame.w, up: frame.y, down: frame.y + frame.h }[dir];
  const side = (t: number) => Math.sign(bezierAt(curve, t)[axis] - border);
  const steps = 64;
  let at = bezierAt(curve, 0.5);
  for (let i = 0; i < steps; i++) {
    if (side(i / steps) !== side((i + 1) / steps)) {
      at = bezierAt(curve, (i + 0.5) / steps);
      break;
    }
  }
  const out = step({ x: axis === "x" ? border : at.x, y: axis === "y" ? border : at.y }, dir, LABEL_OFFSET);
  if (dir === "up") out.y -= LABEL_LINE / 2;
  if (dir === "down") out.y += LABEL_LINE / 2;
  const anchor = dir === "left" ? "end" : dir === "right" ? "start" : "middle";
  return { labelAt: out, labelAnchor: anchor, labelSide: dir };
}

/** Pushes apart labels stacked along the same frame side. */
function spreadLabels(edges: SceneEdge[]) {
  for (const dir of DIRS) {
    const vertical = dir === "left" || dir === "right";
    const along = (e: SceneEdge) => (vertical ? e.labelAt.y : e.labelAt.x);
    const group = edges.filter((e) => e.label && e.labelSide === dir).sort((a, b) => along(a) - along(b));
    group.forEach((e, i) => {
      const prev = group[i - 1];
      if (!prev) return;
      if (vertical) e.labelAt.y = Math.max(e.labelAt.y, prev.labelAt.y + LABEL_LINE);
      else {
        const min = (textWidth(prev.label) + textWidth(e.label)) / 2 + 12;
        e.labelAt.x = Math.max(e.labelAt.x, prev.labelAt.x + min);
      }
    });
  }
}

/**
 * Places intervals in order along a line, each as near its target center as
 * possible without overlapping: overlapping runs merge into blocks centered on
 * their members' mean target. Returns start positions.
 */
function pack(items: { center: number; size: number }[], gap: number): number[] {
  interface Block {
    first: number;
    count: number;
    start: number;
    size: number;
    /** Sum over members of (target start − offset within block). */
    sum: number;
  }
  const blocks: Block[] = [];
  items.forEach((it, i) => {
    let b: Block = { first: i, count: 1, start: it.center - it.size / 2, size: it.size, sum: it.center - it.size / 2 };
    for (let prev = blocks.at(-1); prev && prev.start + prev.size + gap > b.start; prev = blocks.at(-1)) {
      blocks.pop();
      const shift = prev.size + gap;
      const sum = prev.sum + b.sum - shift * b.count;
      const count = prev.count + b.count;
      b = { first: prev.first, count, start: sum / count, size: shift + b.size, sum };
    }
    blocks.push(b);
  });
  const starts: number[] = [];
  for (const b of blocks) {
    let at = b.start;
    for (let i = b.first; i < b.first + b.count; i++) {
      starts.push(at);
      at += items[i]!.size + gap;
    }
  }
  return starts;
}

/** Which side of each endpoint the edge leaves from / arrives at. */
function ports(e: ViewEdge, a: Rect, b: Rect, neighbors: Map<string, Dir>): [Dir, Dir] {
  const nf = neighbors.get(e.from);
  if (nf) return [OPPOSITE[nf], nf];
  const nt = neighbors.get(e.to);
  if (nt) return [nt, OPPOSITE[nt]];
  if (b.x >= a.x + a.w) return ["right", "left"];
  if (b.x + b.w <= a.x) return ["left", "right"];
  return b.y >= a.y ? ["down", "up"] : ["up", "down"];
}

function portPoint(r: Rect, d: Dir): Point {
  const c = center(r);
  if (d === "left") return { x: r.x, y: c.y };
  if (d === "right") return { x: r.x + r.w, y: c.y };
  if (d === "up") return { x: c.x, y: r.y };
  return { x: c.x, y: r.y + r.h };
}

function step(p: Point, d: Dir, k: number): Point {
  if (d === "left") return { x: p.x - k, y: p.y };
  if (d === "right") return { x: p.x + k, y: p.y };
  if (d === "up") return { x: p.x, y: p.y - k };
  return { x: p.x, y: p.y + k };
}

function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function union(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function pad(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}
