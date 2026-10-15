import * as d3 from "d3";
import type { Scene, SceneBox, SceneEdge } from "./arrange";
import type { Rect } from "./geometry";

const DURATION = 500;

export interface Handlers {
  focus(id: string): void;
  up(): void;
}

/**
 * Keyed by box id and edge key, so focus changes animate. A box that changes
 * role (child → frame) moves between layers but starts from its old rect.
 */
export function createRenderer(svgEl: SVGSVGElement, on: Handlers): (scene: Scene) => void {
  const svg = d3.select(svgEl);
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
  let prev = new Map<string, Rect>();
  let first = true;

  return (scene) => {
    const t = d3.transition().duration(first ? 0 : DURATION);
    const ids = new Set(scene.boxes.map((b) => b.id));
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
              .attr("transform", (d) => translate(prev.get(d.id) ?? d.rect))
              .style("opacity", (d) => (prev.has(d.id) ? 1 : 0))
              .on("click", (ev: MouseEvent, d) => {
                ev.stopPropagation();
                if (d.role === "frame") on.up();
                else on.focus(d.id);
              });
            g.append("rect")
              .attr("width", (d) => (prev.get(d.id) ?? d.rect).w)
              .attr("height", (d) => (prev.get(d.id) ?? d.rect).h);
            g.append("text").attr("class", "label");
            g.append("text").attr("class", "meta");
            return g;
          },
          (update) => update,
          (exit) => {
            // Boxes that moved to the other layer vanish here; the rest fade out.
            exit.filter((d) => ids.has(d.id)).remove();
            exit
              .filter((d) => !ids.has(d.id))
              .transition(t)
              .style("opacity", 0)
              .remove();
          },
        )
        .attr("class", (d) => `box ${d.role}`);

      merged.transition(t).attr("transform", (d) => translate(d.rect)).style("opacity", 1);
      merged
        .select("rect")
        .transition(t)
        .attr("width", (d) => d.rect.w)
        .attr("height", (d) => d.rect.h);
      merged
        .select<SVGTextElement>("text.label")
        .text((d) => d.label)
        .attr("text-anchor", (d) => (d.role === "frame" ? "start" : "middle"))
        .transition(t)
        .attr("x", (d) => (d.role === "frame" ? 14 : d.rect.w / 2))
        .attr("y", (d) => (d.role === "frame" ? 22 : d.rect.h / 2));
      merged
        .select<SVGTextElement>("text.meta")
        .text((d) => (d.role === "frame" ? (d.axes ?? "") : d.childCount ? `▸ ${d.childCount}` : ""))
        .attr("text-anchor", (d) => (d.role === "frame" ? "start" : "end"))
        .transition(t)
        .attr("x", (d) => (d.role === "frame" ? 14 : d.rect.w - 8))
        .attr("y", (d) => (d.role === "frame" ? 40 : 13));
    };
    joinBoxes(frameLayer, scene.boxes.filter((b) => b.role === "frame"));
    joinBoxes(nodeLayer, scene.boxes.filter((b) => b.role !== "frame"));

    edgeLayer
      .selectAll<SVGPathElement, SceneEdge>("path")
      .data(scene.edges, (d) => d.key)
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("d", (d) => d.d)
            .attr("marker-end", "url(#arrow)")
            .style("opacity", 0),
        (update) => update,
        (exit) => exit.transition(t).style("opacity", 0).remove(),
      )
      .transition(t)
      .attr("d", (d) => d.d)
      .style("opacity", 1);

    labelLayer
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
            .style("opacity", 0),
        (update) => update,
        (exit) => exit.transition(t).style("opacity", 0).remove(),
      )
      .text((d) => d.label)
      .attr("text-anchor", (d) => d.labelAnchor)
      .transition(t)
      .attr("x", (d) => d.labelAt.x)
      .attr("y", (d) => d.labelAt.y)
      .style("opacity", 1);

    prev = new Map(scene.boxes.map((b) => [b.id, b.rect]));
    first = false;
  };
}

function translate(r: Rect): string {
  return `translate(${r.x},${r.y})`;
}
