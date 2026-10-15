import * as d3 from "d3";
import type { Scene, SceneBox, SceneEdge } from "./arrange";
import type { Rect } from "./geometry";

const DURATION = 500;

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
    .attr("refX", 9)
    .attr("refY", 5)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M0,0 L10,5 L0,10 z");
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
    // A box entering or leaving with its parent travels with it: it is carried
    // from (or into) where the parent was (or goes), scaled to match.
    const enterFrom = (d: SceneBox) => {
      const was = prev.get(d.id);
      if (was) return translate(was.rect);
      const parentWas = d.parent && prev.get(d.parent);
      const parentNow = d.parent && now.get(d.parent);
      return parentWas && parentNow ? carry(d.rect, parentNow.rect, parentWas.rect) : translate(d.rect);
    };
    const exitTo = (d: SceneBox) => {
      const parentWas = d.parent && prev.get(d.parent);
      const parentNow = d.parent && now.get(d.parent);
      return parentWas && parentNow ? carry(d.rect, parentWas.rect, parentNow.rect) : translate(d.rect);
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
              .text((d) => d.label)
              .attr("x", function (d) {
                return labelPos(prev.get(d.id) ?? d, this).x;
              })
              .attr("y", function (d) {
                return labelPos(prev.get(d.id) ?? d, this).y;
              });
            g.append("text").attr("class", "axes");
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
        .attr("x", function (d) {
          return labelPos(d, this).x;
        })
        .attr("y", function (d) {
          return labelPos(d, this).y;
        });
      merged
        .select<SVGTextElement>("text.axes")
        .text((d) => (d.role === "frame" ? (d.axes ?? "") : ""))
        .attr("x", 14)
        .attr("y", 40);
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
 * Labels stay centered (text-anchor middle) in every role, so moving between
 * roles is a plain position tween. The frame title sits at the top left.
 */
function labelPos(b: SceneBox, el: SVGTextElement): { x: number; y: number } {
  if (b.role === "frame") return { x: 14 + el.getComputedTextLength() / 2, y: 22 };
  return { x: b.rect.w / 2, y: b.rect.h / 2 };
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

function translate(r: Rect): string {
  return `translate(${r.x},${r.y})`;
}
