import { describe, expect, it } from "vitest";
import app from "../../../fixtures/app.json";
import pipeline from "../../../fixtures/pipeline.json";
import smap from "../../../fixtures/smap.json";
import { validate } from "./validate";

describe("validate", () => {
  it("accepts the fixtures cleanly", () => {
    for (const doc of [app, pipeline, smap]) expect(validate(doc)).toEqual({ errors: [], warnings: [] });
  });

  it("names what is wrong", () => {
    const doc = {
      startFocus: "a",
      boxes: {
        a: { label: "A", side: "in", sources: [], children: ["b", "ghost"] },
        b: { label: "B", side: "sideways", sources: [], children: [] },
        db: { label: "DB", side: "down", external: true, sources: [], children: ["b"] },
      },
      edges: [{ id: "e1", from: "a", to: "nowhere" }],
    };
    expect(validate(doc).errors).toEqual([
      'box "a": child "ghost" is not a box',
      'box "b": "side" must be one of in, left, right, up, down',
      'box "db" is external, so it can\'t have children',
      'box "b" has two parents: "a" and "db"',
      'edge "e1": "to" must be a box id',
    ]);
  });
});
