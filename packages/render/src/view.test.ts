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
    expect([...alerts.related].sort()).toEqual(["clean", "ingest", "model", "publish"]);
  });
});

describe("selection", () => {
  it("highlights the boxes connected to a selected external, without moving anything", () => {
    const ix = load(app);
    const plain = deriveView(ix, { focus: "app" });
    const v = deriveView(ix, { focus: "app", selected: "payments" });
    expect([...v.selection!.related]).toEqual(["logic"]);
    expect([...v.selection!.edges]).toEqual(["logic->payments"]);
    const rects = (view: typeof v) => arrange(ix, view).boxes.map((b) => [b.id, b.rect]);
    expect(rects(v)).toEqual(rects(plain));
  });

  it("highlights the visible box containing a deeper connection", () => {
    const v = deriveView(load(pipeline), { focus: "pipeline", selected: "orders_db" });
    expect([...v.selection!.related]).toEqual(["ingest"]);
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
      for (const [focus] of focusable) {
        const rects = arrange(ix, deriveView(ix, { focus })).boxes.filter((b) => b.role !== "frame");
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
