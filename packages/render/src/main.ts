import * as d3 from "d3";
import type { MapDoc } from "@smap/ir";

// Pick a fixture with ?fixture=<name> (default: app).
const fixtures = import.meta.glob<MapDoc>("../../../fixtures/*.json", { eager: true, import: "default" });
const byName = Object.fromEntries(
  Object.entries(fixtures).map(([path, doc]) => [path.split("/").pop()!.replace(/\.json$/, ""), doc]),
);
const name = new URLSearchParams(location.search).get("fixture") ?? "app";
const doc = byName[name];
if (!doc) throw new Error(`unknown fixture "${name}"; have: ${Object.keys(byName).join(", ")}`);

// Placeholder: smoke-test the toolchain with a keyed D3 join over box ids.
// Layout and real rendering come next.
const boxes = Object.entries(doc.boxes).map(([id, box]) => ({ id, ...box }));

d3.select<SVGSVGElement, unknown>("#map")
  .selectAll("text")
  .data(boxes, (d) => (d as { id: string }).id)
  .join("text")
  .attr("x", 20)
  .attr("y", (_, i) => 30 + i * 22)
  .text((d) => `${d.id} (${d.side}): ${d.label}`);
