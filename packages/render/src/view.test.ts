import { describe, expect, it } from "vitest";
import type { MapDoc } from "@smap/ir";
import app from "../../../fixtures/app.json";
import pipeline from "../../../fixtures/pipeline.json";
import smap from "../../../fixtures/smap.json";
import { arrange } from "./arrange";
import { layoutInterior } from "./geometry";
import { indexDoc } from "./model";
import { deriveView } from "./view";

const load = (doc: unknown) => indexDoc(doc as MapDoc);

/** Children of `id` in left-to-right order of their centers. */
function xOrder(doc: unknown, id: string): string[] {
  const { rects } = layoutInterior(load(doc), id);
  return [...rects].sort(([, a], [, b]) => a.x + a.w / 2 - (b.x + b.w / 2)).map(([k]) => k);
}

describe("deriveView", () => {
  it("places top-level neighbors by declared side", () => {
    const v = deriveView(load(app), { focus: "app" });
    expect(Object.fromEntries(v.neighbors)).toEqual({ server: "left", db: "down", payments: "right" });
    expect(v.edges.map((e) => e.key).sort()).toEqual(
      ["logic->db", "logic->payments", "routes->logic", "server->routes"].sort(),
    );
  });

  it("turns former siblings into neighbors on zoom", () => {
    const v = deriveView(load(app), { focus: "routes" });
    expect(Object.fromEntries(v.neighbors)).toEqual({ server: "left", logic: "right" });
    expect(v.edges.map((e) => e.key).sort()).toEqual(["routes->logic", "server->routes"]);
  });

  it("lifts deep edges to the visible boxes and merges labels", () => {
    const v = deriveView(load(pipeline), { focus: "pipeline" });
    const transformToModel = v.edges.find((e) => e.key === "transform->model");
    expect(transformToModel?.labels).toEqual(["features.parquet"]);
    expect(v.edges.some((e) => e.key === "transform->analysis")).toBe(true);
    expect(v.neighbors.get("analysis")).toBe("down");
  });

  it("merges opposite edges into one double-ended edge", () => {
    const v = deriveView(load(smap), { focus: "smap" });
    const pair = v.edges.filter((e) => [e.from, e.to].sort().join() === "user,view");
    expect(pair).toHaveLength(1);
    expect(pair[0]!.both).toBe(true);
  });

  it("shows only connected context around a top-level box other than the start", () => {
    const v = deriveView(load(pipeline), { focus: "analysis" });
    expect([...v.neighbors.keys()]).toEqual(["pipeline"]);
  });

  it("shows upstream and downstream stages around a nested focus", () => {
    const v = deriveView(load(pipeline), { focus: "clean" });
    expect(v.neighbors.get("ingest")).toBe("left");
    expect(v.neighbors.get("transform")).toBe("right");
    expect(v.neighbors.has("publish")).toBe(false);
  });
});

describe("ambient boxes", () => {
  it("shows ambient children as chips, not children, with no drawn edges", () => {
    const v = deriveView(load(app), { focus: "app" });
    expect(v.chips).toEqual(["config"]);
    expect(v.children).toEqual(["routes", "logic"]);
    expect(v.edges.some((e) => e.from === "config" || e.to === "config")).toBe(false);
  });

  it("drops an ancestor's ambient boxes when zoomed in", () => {
    const v = deriveView(load(app), { focus: "routes" });
    expect(v.chips).toEqual([]);
    expect(v.neighbors.has("config")).toBe(false);
  });

  it("collapses edges to an ambient neighbor onto the frame", () => {
    const top = deriveView(load(pipeline), { focus: "pipeline" });
    expect(top.edges.filter((e) => e.to === "alerts").map((e) => e.key)).toEqual(["pipeline->alerts"]);
    const clean = deriveView(load(pipeline), { focus: "clean" });
    expect(clean.edges.filter((e) => e.to === "alerts").map((e) => e.key)).toEqual(["clean->alerts"]);
  });

  it("selecting an ambient box reveals what it connects to", () => {
    const chip = deriveView(load(app), { focus: "app", selected: "config" }).selection!;
    expect([...chip.related].sort()).toEqual(["logic", "routes"]);
    const alerts = deriveView(load(pipeline), { focus: "pipeline", selected: "alerts" }).selection!;
    expect([...alerts.related].sort()).toEqual(
      ["clean_events", "dedupe_orders", "export_scores", "fetch_events", "score_users"],
    );
  });
});

describe("selection", () => {
  it("narrows the view to a selected external and what it connects to", () => {
    const ix = load(app);
    const v = deriveView(ix, { focus: "app", selected: "payments" });
    expect(v.children).toEqual(["logic"]);
    expect(v.chips).toEqual([]);
    expect([...v.neighbors.keys()]).toEqual(["payments"]);
    expect(v.edges.map((e) => e.key)).toEqual(["logic->payments"]);
    const scene = arrange(ix, v);
    const plain = arrange(ix, deriveView(ix, { focus: "app" }));
    const width = (s: typeof scene) => s.boxes.find((b) => b.id === "payments")!.rect.w;
    expect(width(scene)).toBeGreaterThan(width(plain));
    // Same scale as the full view, not zoomed in on what remains.
    expect(scene.bounds.w).toBeGreaterThanOrEqual(plain.bounds.w);
  });

  it("opens connected boxes up to the boxes really connected, within budget", () => {
    const v = deriveView(load(pipeline), { focus: "pipeline", selected: "orders_db" });
    expect(v.children.sort()).toEqual(["fetch_orders", "fetch_users"]);
    expect([...v.selection!.related].sort()).toEqual(["fetch_orders", "fetch_users"]);
  });

  it("keeps the full view's left-to-right order when opening boxes up", () => {
    const ix = load(pipeline);
    const scene = arrange(ix, deriveView(ix, { focus: "pipeline", selected: "alerts" }));
    const x = (id: string) => scene.boxes.find((b) => b.id === id)!.rect.x;
    expect(x("fetch_events")).toBeLessThan(x("clean_events"));
    expect(x("clean_events")).toBeLessThan(x("score_users"));
    expect(x("score_users")).toBeLessThan(x("export_scores"));
  });

  it("ignores a selection that is not visible", () => {
    const v = deriveView(load(app), { focus: "routes", selected: "payments" });
    expect(v.selection).toBeUndefined();
  });
});

describe("layoutInterior", () => {
  it("lays stages out left to right by dataflow", () => {
    expect(xOrder(pipeline, "pipeline")).toEqual(["ingest", "clean", "transform", "model", "publish"]);
    expect(xOrder(smap, "smap")).toEqual(["compile", "ir", "view"]);
    expect(xOrder(smap, "compile")).toEqual(["ingest", "digest", "skeleton", "refine"]);
  });

  it("keeps a chain of stages on one straight line", () => {
    const { rects } = layoutInterior(load(pipeline), "pipeline");
    const ys = ["ingest", "clean", "transform", "model", "publish"].map((id) => rects.get(id)!.y);
    expect(new Set(ys).size).toBe(1);
  });

  it("gives edges that skip layers a lane clear of the boxes they pass", () => {
    const { rects, bends } = layoutInterior(load(pipeline), "pipeline");
    const [lane] = bends.get("ingest->transform") ?? [];
    const clean = rects.get("clean")!;
    expect(lane).toBeDefined();
    expect(lane!.y < clean.y || lane!.y > clean.y + clean.h).toBe(true);
  });

  it("does not overlap boxes in any fixture view", () => {
    for (const doc of [app, pipeline, smap]) {
      const ix = load(doc);
      const focusable = Object.entries(ix.doc.boxes).filter(([, b]) => !b.external && !b.ambient);
      const states = focusable.flatMap(([focus]) => {
        const external = [...deriveView(ix, { focus }).neighbors.keys()].filter((n) => ix.doc.boxes[n]?.external);
        return [{ focus }, ...external.map((selected) => ({ focus, selected }))];
      });
      for (const state of states) {
        const focus = `${state.focus}${"selected" in state ? ` +${state.selected}` : ""}`;
        const rects = arrange(ix, deriveView(ix, state)).boxes.filter((b) => b.role !== "frame");
        for (const [i, a] of rects.entries()) {
          for (const b of rects.slice(i + 1)) {
            const overlap =
              a.rect.x < b.rect.x + b.rect.w &&
              b.rect.x < a.rect.x + a.rect.w &&
              a.rect.y < b.rect.y + b.rect.h &&
              b.rect.y < a.rect.y + a.rect.h;
            expect(overlap, `${focus}: ${a.id} overlaps ${b.id}`).toBe(false);
          }
        }
      }
    }
  });
});

describe("arrange", () => {
  it("drops edge labels in views over the label budget", () => {
    const labelled = (doc: unknown, focus: string) => {
      const ix = load(doc);
      return arrange(ix, deriveView(ix, { focus })).edges.some((e) => e.label);
    };
    expect(labelled(pipeline, "pipeline")).toBe(false);
    expect(labelled(pipeline, "clean")).toBe(true);
    expect(labelled(app, "app")).toBe(true);
  });

  it("draws edges between neighbors on one side and staggers them by flow", () => {
    const ix = load(pipeline);
    expect(deriveView(ix, { focus: "ingest" }).edges.some((e) => e.key === "clean->transform")).toBe(true);
    const v = deriveView(ix, { focus: "transform" });
    expect(v.edges.some((e) => e.key === "ingest->clean")).toBe(true);
    const rects = new Map(arrange(ix, v).boxes.map((b) => [b.id, b.rect]));
    expect(rects.get("ingest")!.x).toBeLessThan(rects.get("clean")!.x);
  });

  it("lines neighbors up with the boxes they connect to", () => {
    const ix = load(app);
    const rects = new Map(arrange(ix, deriveView(ix, { focus: "app" })).boxes.map((b) => [b.id, b.rect]));
    const cy = (id: string) => rects.get(id)!.y + rects.get(id)!.h / 2;
    const cx = (id: string) => rects.get(id)!.x + rects.get(id)!.w / 2;
    expect(cy("server")).toBeCloseTo(cy("routes"));
    expect(cy("payments")).toBeCloseTo(cy("logic"));
    expect(cx("db")).toBeCloseTo(cx("logic"));
  });
});
