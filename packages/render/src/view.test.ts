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

  it("shows upstream and downstream stages around a nested focus", () => {
    const v = deriveView(load(pipeline), { focus: "clean" });
    expect(v.neighbors.get("ingest")).toBe("left");
    expect(v.neighbors.get("transform")).toBe("right");
    expect(v.neighbors.has("publish")).toBe(false);
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
      for (const focus of Object.keys(ix.doc.boxes)) {
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
