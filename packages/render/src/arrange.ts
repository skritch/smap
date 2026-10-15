import { boxSize, labelText, layoutInterior, pack, textWidth, type Dir, type Point, type Rect } from "./geometry";
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
  parent?: string;
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
  focus: string;
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
/** Outward shift per step upstream/downstream among neighbors on one side. */
const STAGGER = 40;
const MARGIN = 48;
const DIRS: Dir[] = ["left", "right", "up", "down"];
/** Spacing between edge ends sharing one side of a box; wider than an arrowhead. */
const PORT_GAP = 10;
/** Furthest a lone edge end moves to stay level with its partner. */
const ALIGN_REACH = 12;
/** How close a straight edge may pass to a box it doesn't connect to. */
const CLEARANCE = 6;
/** How far a detouring edge passes beyond the boxes it goes around. */
const LANE_OFFSET = 12;
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
        .map((e) => (e.from === id ? e.to : e.from))
        .filter((other) => !view.neighbors.has(other))
        .map((other) => center(rects.get(other)!))
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
    const depth = flowDepth(ids, view.edges, dir);
    ids.forEach((id, i) => {
      const s = sizes[i]!;
      const at = starts[i]!;
      const out = depth.get(id)! * STAGGER;
      if (dir === "left") rects.set(id, { x: -gap - colW + (colW - s.w) / 2 - out, y: at, ...s });
      else if (dir === "right") rects.set(id, { x: fw + gap + (colW - s.w) / 2 + out, y: at, ...s });
      else rects.set(id, { x: at, y: dir === "up" ? -gap - s.h - out : fh + gap + out, ...s });
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
      parent: ix.parent.get(id),
      emphasis: !sel || role === "frame" ? undefined : id === sel.id ? "selected" : sel.related.has(id) ? "related" : "dimmed",
    };
  };
  const boxes = [
    box(view.focus, "frame"),
    ...view.children.map((id) => box(id, "child")),
    ...view.chips.map((id) => box(id, "ambient")),
    ...[...view.neighbors.keys()].map((id) => box(id, "neighbor")),
  ];
  const bendsOf = (e: ViewEdge) => interior.bends.get(e.key)?.map((p) => ({ x: p.x + ox, y: p.y + oy })) ?? [];
  const sides = new Map(
    view.edges.map((e) => [
      e.key,
      interior.bends.has(e.key)
        ? (["right", "left"] as [Dir, Dir])
        : ports(e, rects.get(e.from)!, rects.get(e.to)!, view.neighbors),
    ]),
  );
  const ends = spreadPorts(view.edges, sides, rects);
  const edges = view.edges.map((e) => {
    const lane = bendsOf(e);
    const bends = lane.length ? lane : aroundBlockers(e, ends.get(e.key) as [Point, Point], rects, view);
    // Edges between neighbors are context only and stay unlabeled.
    const betweenNeighbors = view.neighbors.has(e.from) && view.neighbors.has(e.to);
    const shown = labels && !betweenNeighbors ? e : { ...e, labels: [] };
    const edge = routeEdge(shown, sides.get(e.key)!, ends.get(e.key) as [Point, Point], {
      rects,
      neighbors: view.neighbors,
      focus: view.focus,
      bends,
    });
    edge.both = e.both;
    if (sel) edge.emphasis = sel.edges.has(e.key) ? "related" : "dimmed";
    return edge;
  });
  spreadLabels(edges);

  return { focus: view.focus, boxes, edges, bounds: pad(union([...rects.values()]), MARGIN) };
}

interface RouteCtx {
  rects: Map<string, Rect>;
  neighbors: Map<string, Dir>;
  focus: string;
  /** Lane waypoints for edges that skip layers. */
  bends: Point[];
}

function routeEdge(e: ViewEdge, [pa, pb]: [Dir, Dir], [p0, p1]: [Point, Point], ctx: RouteCtx): SceneEdge {
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

  // Straight unless a box is in the way. Straight edges are still cubic
  // (control points on the line), so straight ↔ curved transitions morph.
  const blocked = [...ctx.rects]
    .filter(([id]) => id !== e.from && id !== e.to && id !== ctx.focus)
    .some(([, r]) => segmentHitsRect(p0, p1, r));
  // Bulge grows with length but stays capped, so long curves hug their row.
  const k = Math.min(60, Math.max(24, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2.5));
  const curve: Bezier = blocked
    ? [p0, step(p0, pa, k), step(p1, pb, k), p1]
    : [p0, lerp(p0, p1, 1 / 3), lerp(p0, p1, 2 / 3), p1];
  const [, c0, c1] = curve;
  return {
    key: e.key,
    d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`,
    label,
    ...placeLabel(e, curve, ctx),
  };
}

type Bezier = [Point, Point, Point, Point];

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Whether the segment a→b passes within CLEARANCE of `r` (Liang–Barsky clip). */
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const [x0, x1, y0, y1] = [r.x - CLEARANCE, r.x + r.w + CLEARANCE, r.y - CLEARANCE, r.y + r.h + CLEARANCE];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clips: [number, number][] = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

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
  const betweenNeighbors = ctx.neighbors.has(e.from) && ctx.neighbors.has(e.to);
  if (!dir || betweenNeighbors || e.from === ctx.focus || e.to === ctx.focus) {
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
 * How many steps each neighbor on one side sits from the frame along the flow
 * between them. Upstream sides (left, up) count edges pointing toward the
 * frame; downstream sides (right, down) count edges pointing away from it.
 */
function flowDepth(ids: string[], edges: ViewEdge[], dir: Dir): Map<string, number> {
  const upstream = dir === "left" || dir === "up";
  const nearer = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (!nearer.has(e.from) || !nearer.has(e.to)) continue;
    const [far, near] = upstream ? [e.from, e.to] : [e.to, e.from];
    nearer.get(far)!.push(near);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const walk = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(0, ...nearer.get(id)!.map((n) => walk(n) + 1));
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  ids.forEach(walk);
  return depth;
}

/**
 * Edge ends sharing one side of a box are spread PORT_GAP apart around the
 * side's midpoint, ordered by where each edge's other end is so they don't cross.
 */
function spreadPorts(edges: ViewEdge[], sides: Map<string, [Dir, Dir]>, rects: Map<string, Rect>) {
  const slots = new Map<string, { key: string; end: 0 | 1; order: number }[]>();
  for (const e of edges) {
    const [pa, pb] = sides.get(e.key)!;
    const ends: [string, Dir, string, 0 | 1][] = [
      [e.from, pa, e.to, 0],
      [e.to, pb, e.from, 1],
    ];
    for (const [box, side, other, end] of ends) {
      const c = center(rects.get(other)!);
      const slot = `${box}:${side}`;
      const list = slots.get(slot) ?? [];
      list.push({ key: e.key, end, order: side === "left" || side === "right" ? c.y : c.x });
      slots.set(slot, list);
    }
  }
  const out = new Map(edges.map((e) => [e.key, [] as Point[]]));
  for (const [slot, list] of slots) {
    const [box, side] = slot.split(":") as [string, Dir];
    const r = rects.get(box)!;
    const room = (side === "left" || side === "right" ? r.h : r.w) / 2 - 6;
    list.sort((a, b) => a.order - b.order);
    list.forEach((item, i) => {
      const offset = Math.max(-room, Math.min(room, (i - (list.length - 1) / 2) * PORT_GAP));
      const p = portPoint(r, side);
      out.get(item.key)![item.end] = side === "left" || side === "right" ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y };
    });
  }
  // An end alone on its side lines up with its partner when the two sides face
  // each other and the partner is within reach, so spreading the other end
  // doesn't tilt a level edge.
  for (const e of edges) {
    const [pa, pb] = sides.get(e.key)!;
    if (OPPOSITE[pa] !== pb) continue;
    const pts = out.get(e.key)!;
    const across = pa === "left" || pa === "right" ? "y" : "x";
    ([[e.from, pa, 0], [e.to, pb, 1]] as const).forEach(([box, side, end]) => {
      if (slots.get(`${box}:${side}`)!.length !== 1) return;
      const r = rects.get(box)!;
      const [lo, hi] = across === "y" ? [r.y + 6, r.y + r.h - 6] : [r.x + 6, r.x + r.w - 6];
      const want = pts[1 - end]![across];
      const shift = Math.abs(want - pts[end]![across]);
      if (want >= lo && want <= hi && shift <= ALIGN_REACH) pts[end] = { ...pts[end]!, [across]: want };
    });
  }
  return out;
}

/**
 * An edge from a side neighbor whose straight path is blocked by boxes inside
 * the frame passes just below (or above) each blocker, then arrives at its
 * target's facing side like any other input running parallel to the flow.
 */
function aroundBlockers(e: ViewEdge, [p0, p1]: [Point, Point], rects: Map<string, Rect>, view: View): Point[] {
  const side = view.neighbors.get(e.from) ?? view.neighbors.get(e.to);
  if (!side || (side !== "left" && side !== "right")) return [];
  if (view.neighbors.has(e.from) === view.neighbors.has(e.to)) return [];
  const [outer, inner] = view.neighbors.has(e.from) ? [e.from, e.to] : [e.to, e.from];
  if (inner === view.focus) return [];
  const blockers = view.children
    .filter((id) => id !== inner)
    .map((id) => rects.get(id)!)
    .filter((r) => segmentHitsRect(p0, p1, r));
  if (!blockers.length) return [];
  const below = center(rects.get(outer)!).y >= center(rects.get(inner)!).y;
  const y = below
    ? Math.max(...blockers.map((r) => r.y + r.h)) + LANE_OFFSET
    : Math.min(...blockers.map((r) => r.y)) - LANE_OFFSET;
  const pts = blockers.map((r) => ({ x: r.x + r.w / 2, y }));
  return pts.sort((a, b) => (p0.x < p1.x ? a.x - b.x : b.x - a.x));
}

/** Which side of each endpoint the edge leaves from / arrives at. */
function ports(e: ViewEdge, a: Rect, b: Rect, neighbors: Map<string, Dir>): [Dir, Dir] {
  const nf = neighbors.get(e.from);
  const nt = neighbors.get(e.to);
  if (nf && nt) return b.y >= a.y + a.h ? ["down", "up"] : b.y + b.h <= a.y ? ["up", "down"] : b.x >= a.x ? ["right", "left"] : ["left", "right"];
  if (nf) return [OPPOSITE[nf], nf];
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
