import * as d3 from "d3";
import type { Scene, SceneBox, SceneEdge } from "./arrange";
import type { Dir, Rect } from "./geometry";

const DURATION = 500;
/** Axis arrows, drawn pointing right and turned into place. */
const COMPASS: [Dir, number][] = [
  ["right", 0],
  ["down", 90],
  ["left", 180],
  ["up", 270],
];

export interface Handlers {
  /** A non-frame box was clicked. */
  click(id: string): void;
  /** The frame was clicked. */
  up(): void;
  /** Empty space was clicked. */
  background(): void;
}

/**
 * Keyed by box id and edge key, so focus changes animate. A box that changes
 * role (child → frame) moves between layers but starts from its old rect.
 */
export function createRenderer(svgEl: SVGSVGElement, on: Handlers): (scene: Scene) => void {
  const svg = d3.select(svgEl).on("click", () => on.background());
  svg
    .append("defs")
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 10)
    .attr("refY", 5)
    .attr("markerWidth", 12)
    .attr("markerHeight", 12)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M3,1.5 L10,5 L3,8.5 z");
  const frameLayer = svg.append("g").attr("class", "frame-layer");
  const edgeLayer = svg.append("g").attr("class", "edges");
  const nodeLayer = svg.append("g").attr("class", "nodes");
  const labelLayer = svg.append("g").attr("class", "edge-labels");
  let prev = new Map<string, SceneBox>();
  let prevFocus: string | undefined;
  let first = true;

  return (scene) => {
    const t = d3.transition().duration(first ? 0 : DURATION);
    const now = new Map(scene.boxes.map((b) => [b.id, b]));
    const ids = new Set(now.keys());
    // Where a box is drawn, or failing that, the area its drawn descendants cover.
    const region = (boxes: Map<string, SceneBox>, id: string): Rect | undefined => {
      const own = boxes.get(id);
      if (own) return own.rect;
      const inside = [...boxes.values()].filter((b) => b.ancestors.includes(id)).map((b) => b.rect);
      return inside.length ? union(inside) : undefined;
    };
    // A box entering or leaving with an ancestor travels with it: it is carried
    // from (or into) where the ancestor was (or goes), scaled to match. A box
    // opening up into the boxes inside it grows into them, and back.
    const enterFrom = (d: SceneBox) => {
      const was = prev.get(d.id);
      if (was) return translate(was.rect);
      const opened = region(prev, d.id);
      if (opened) return carry(d.rect, d.rect, opened);
      for (const a of d.ancestors) {
        const from = region(prev, a);
        const to = region(now, a);
        if (from && to) return carry(d.rect, to, from);
      }
      return translate(d.rect);
    };
    const exitTo = (d: SceneBox) => {
      const opened = region(now, d.id);
      if (opened) return carry(d.rect, d.rect, opened);
      for (const a of d.ancestors) {
        const from = region(prev, a);
        const to = region(now, a);
        if (from && to) return carry(d.rect, from, to);
      }
      return translate(d.rect);
    };
    const { x, y, w, h } = scene.bounds;
    svg.transition(t).attr("viewBox", `${x} ${y} ${w} ${h}`);

    const joinBoxes = (layer: d3.Selection<SVGGElement, unknown, null, undefined>, data: SceneBox[]) => {
      const merged = layer
        .selectAll<SVGGElement, SceneBox>("g.box")
        .data(data, (d) => d.id)
        .join(
          (enter) => {
            const g = enter
              .append("g")
              .attr("transform", enterFrom)
              .style("opacity", (d) => (prev.has(d.id) ? 1 : 0))
              .on("click", (ev: MouseEvent, d) => {
                ev.stopPropagation();
                if (d.role === "frame") on.up();
                else on.click(d.id);
              });
            g.append("rect")
              .attr("width", (d) => (prev.get(d.id) ?? d).rect.w)
              .attr("height", (d) => (prev.get(d.id) ?? d).rect.h);
            // A box that changed layer starts its label where it was last drawn.
            g.append("text")
              .attr("class", "label")
              .attr("text-anchor", "middle")
              // Labels are all capitals, so center the cap height (Plex Mono's is 0.7em).
              .attr("dy", "0.35em")
              .text((d) => d.label)
              .style("font-size", (d) => labelFont(prev.get(d.id) ?? d).size)
              .style("letter-spacing", (d) => labelFont(prev.get(d.id) ?? d).spacing)
              .attr("x", function (d) {
                return labelPos(prev.get(d.id) ?? d, this).x;
              })
              .attr("y", function (d) {
                return labelPos(prev.get(d.id) ?? d, this).y;
              });
            appendCompass(g);
            return g;
          },
          (update) => update,
          (exit) => {
            // Boxes that moved to the other layer vanish here; the rest fade out.
            exit.filter((d) => ids.has(d.id)).remove();
            // Raised so a box shrinking into its parent stays on top of it.
            exit
              .filter((d) => !ids.has(d.id))
              .raise()
              .transition(t)
              .attr("transform", exitTo)
              .style("opacity", 0)
              .remove();
          },
        )
        .attr("class", (d) => ["box", d.role, d.external && "external", d.emphasis].filter(Boolean).join(" "));

      merged
        .transition(t)
        .attr("transform", (d) => translate(d.rect))
        .style("opacity", (d) => opacity(d.emphasis));
      merged
        .select("rect")
        .transition(t)
        .attr("width", (d) => d.rect.w)
        .attr("height", (d) => d.rect.h);
      merged
        .select<SVGTextElement>("text.label")
        .text((d) => d.label)
        .transition(t)
        .style("font-size", (d) => labelFont(d).size)
        .style("letter-spacing", (d) => labelFont(d).spacing)
        .attr("x", function (d) {
          return labelPos(d, this).x;
        })
        .attr("y", function (d) {
          return labelPos(d, this).y;
        });
      // The compass sits just past the frame title and appears once it has settled.
      const compass = merged.select<SVGGElement>("g.compass");
      compass.selectAll<SVGGElement, unknown>("g.arrow").style("display", function () {
        const box = d3.select<SVGGElement, SceneBox>(this.closest<SVGGElement>("g.box")!).datum();
        return box.axes?.[this.dataset.dir as Dir] ? null : "none";
      });
      compass
        .attr("transform", function (d) {
          const title = (this.parentNode as SVGGElement).querySelector<SVGTextElement>("text.label")!;
          return `translate(${14 + measure(d, title) + 20},22)`;
        })
        .style("opacity", 0)
        .transition()
        .delay(first ? 0 : DURATION)
        .duration(first ? 0 : DURATION / 2)
        .style("opacity", (d) => (d.axes ? 1 : 0));
    };
    joinBoxes(frameLayer, scene.boxes.filter((b) => b.role === "frame"));
    joinBoxes(nodeLayer, scene.boxes.filter((b) => b.role !== "frame"));

    // Edges inside a frame travel with it, like its children: leaving edges
    // ride the old frame to where it goes, arriving ones grow out of where the
    // new frame was. With nothing to travel with, they leave quickly and
    // arrive late, so they never hang off boxes that are still moving.
    const moved = prevFocus !== undefined && prevFocus !== scene.focus;
    const oldFrameWas = moved ? prev.get(prevFocus!) : undefined;
    const oldFrameNow = moved ? now.get(prevFocus!) : undefined;
    const newFrameWas = moved ? prev.get(scene.focus) : undefined;
    const exitCarry = oldFrameWas && oldFrameNow ? mapRect(oldFrameWas.rect, oldFrameNow.rect) : null;
    const enterCarry = newFrameWas ? mapRect(now.get(scene.focus)!.rect, newFrameWas.rect) : null;
    const out = first ? 0 : DURATION / 4;
    const late = { delay: first ? 0 : DURATION * 0.6, duration: first ? 0 : DURATION * 0.4 };
    const entering = new Set<string>();
    const leave = <E extends d3.BaseType>(exit: d3.Selection<E, SceneEdge, SVGGElement, unknown>) => {
      if (exitCarry) exit.transition(t).attr("transform", exitCarry).style("opacity", 0).remove();
      else exit.transition().duration(out).style("opacity", 0).remove();
    };
    const arrive = <E extends d3.BaseType>(sel: d3.Selection<E, SceneEdge, SVGGElement, unknown>) => {
      const s = sel.filter((d) => entering.has(d.key));
      if (enterCarry) {
        s.attr("transform", enterCarry)
          .transition(t)
          .attr("transform", "translate(0,0) scale(1,1)")
          .style("opacity", (d) => opacity(d.emphasis));
      } else {
        s.transition()
          .delay(late.delay)
          .duration(late.duration)
          .style("opacity", (d) => opacity(d.emphasis));
      }
    };

    const paths = edgeLayer
      .selectAll<SVGPathElement, SceneEdge>("path")
      .data(scene.edges, (d) => d.key)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("d", (d) => d.d)
            .attr("marker-end", "url(#arrow)")
            .style("opacity", 0)
            .each((d) => entering.add(d.key)),
        (update) => update,
        (exit) => leave(exit),
      )
      .classed("related", (d) => d.emphasis === "related")
      .attr("marker-start", (d) => (d.both ? "url(#arrow)" : null));
    paths
      .filter((d) => !entering.has(d.key))
      .transition(t)
      .attr("d", (d) => d.d)
      .style("opacity", (d) => opacity(d.emphasis));
    arrive(paths);

    const labels = labelLayer
      .selectAll<SVGTextElement, SceneEdge>("text")
      .data(
        scene.edges.filter((e) => e.label),
        (d) => d.key,
      )
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("x", (d) => d.labelAt.x)
            .attr("y", (d) => d.labelAt.y)
            .style("opacity", 0)
            .each((d) => entering.add(d.key)),
        (update) => update,
        (exit) => leave(exit),
      )
      .text((d) => d.label)
      .attr("text-anchor", (d) => d.labelAnchor);
    labels
      .filter((d) => !entering.has(d.key))
      .transition(t)
      .attr("x", (d) => d.labelAt.x)
      .attr("y", (d) => d.labelAt.y)
      .style("opacity", (d) => opacity(d.emphasis));
    arrive(labels);

    prev = new Map(scene.boxes.map((b) => [b.id, b]));
    prevFocus = scene.focus;
    first = false;
  };
}

/**
 * Label type per role. Set here rather than in the stylesheet so it tweens
 * with the box instead of snapping when the role class changes.
 */
function labelFont(b: SceneBox): { size: string; spacing: string } {
  const [size, spacing] = b.role === "frame" ? [13, 2.34] : b.role === "ambient" ? [11, 0.44] : [11.5, 0.46];
  return { size: `${size * b.scale}px`, spacing: `${spacing * b.scale}px` };
}

/**
 * Labels stay centered (text-anchor middle) in every role, so moving between
 * roles is a plain position tween. The frame title sits at the top left; its
 * width is measured at the frame's type, which the label may not have yet.
 */
function labelPos(b: SceneBox, el: SVGTextElement): { x: number; y: number } {
  if (b.role !== "frame") return { x: b.rect.w / 2, y: b.rect.h / 2 };
  return { x: 14 + measure(b, el) / 2, y: 22 };
}

/** Width of `b`'s label set in its type, which `el` may not have yet. */
function measure(b: SceneBox, el: SVGTextElement): number {
  const { fontSize, letterSpacing } = el.style;
  const font = labelFont(b);
  el.style.fontSize = font.size;
  el.style.letterSpacing = font.spacing;
  const w = el.getComputedTextLength();
  el.style.fontSize = fontSize;
  el.style.letterSpacing = letterSpacing;
  return w;
}

/**
 * Arrows for the directions a frame's axes give meaning to; hovering one
 * shows its meaning beside the compass.
 */
function appendCompass(g: d3.Selection<SVGGElement, SceneBox, SVGGElement, unknown>) {
  const compass = g
    .append("g")
    .attr("class", "compass")
    .style("opacity", 0)
    .on("click", (ev: MouseEvent) => ev.stopPropagation());
  compass.append("circle").attr("r", 1.25);
  const meaning = compass.append("text").attr("class", "meaning").attr("x", 18).attr("dy", "0.35em");
  for (const [dir, angle] of COMPASS) {
    const arrow = compass
      .append("g")
      .attr("class", "arrow")
      .attr("data-dir", dir)
      .attr("transform", `rotate(${angle})`)
      .on("mouseenter", function () {
        const box = d3.select<SVGGElement, SceneBox>(this.closest<SVGGElement>("g.box")!).datum();
        meaning.text(box.axes?.[dir] ?? "");
      })
      .on("mouseleave", () => meaning.text(""));
    arrow.append("rect").attr("x", 2).attr("y", -6).attr("width", 12).attr("height", 12);
    arrow.append("path").attr("d", "M6,-2.75 L11,0 L6,2.75 z");
  }
}

function opacity(emphasis: string | undefined): number {
  return emphasis === "dimmed" ? 0.25 : 1;
}

/** Transform placing `r` (positioned within `from`) inside `to` instead, scaled to fit. */
function carry(r: Rect, from: Rect, to: Rect): string {
  const kx = to.w / from.w;
  const ky = to.h / from.h;
  return `translate(${to.x + (r.x - from.x) * kx},${to.y + (r.y - from.y) * ky}) scale(${Math.min(kx, ky)})`;
}

/** Transform moving any point in `from` to the matching point in `to`. */
function mapRect(from: Rect, to: Rect): string {
  const kx = to.w / from.w;
  const ky = to.h / from.h;
  return `translate(${to.x - from.x * kx},${to.y - from.y * ky}) scale(${kx},${ky})`;
}

function union(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function translate(r: Rect): string {
  return `translate(${r.x},${r.y})`;
}
