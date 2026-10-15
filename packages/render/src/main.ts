import * as d3 from "d3";
import type { MapDoc } from "@smap/ir";
import { arrange } from "./arrange";
import { createRenderer } from "./draw";
import { ancestors, indexDoc } from "./model";
import { deriveView, type ViewState } from "./view";

// Pick a fixture with ?fixture=<name> (default: app).
const fixtures = import.meta.glob<MapDoc>("../../../fixtures/*.json", { eager: true, import: "default" });
const byName = Object.fromEntries(
  Object.entries(fixtures).map(([path, doc]) => [path.split("/").pop()!.replace(/\.json$/, ""), doc]),
);
const fixtureName = new URLSearchParams(location.search).get("fixture") ?? "app";
const doc: MapDoc = (() => {
  const found = byName[fixtureName];
  if (!found) throw new Error(`unknown fixture "${fixtureName}"; have: ${Object.keys(byName).join(", ")}`);
  return found;
})();
const ix = indexDoc(doc);

// Dev-only fixture switcher; switching starts the new map at its start focus.
d3.select<HTMLSelectElement, unknown>("#fixture")
  .on("change", (ev: Event) => {
    location.href = `?fixture=${encodeURIComponent((ev.target as HTMLSelectElement).value)}`;
  })
  .selectAll("option")
  .data(Object.keys(byName).sort())
  .join("option")
  .attr("value", (n) => n)
  .property("selected", (n) => n === fixtureName)
  .text((n) => n);

// The focus lives in the URL hash, so reload and browser back/forward work.
// External and ambient boxes are selected rather than focused.
let selected: string | undefined;

function readState(): ViewState {
  const id = decodeURIComponent(location.hash.slice(1));
  const focusable = Object.hasOwn(doc.boxes, id) && !selectable(id);
  return { focus: focusable ? id : doc.startFocus, selected };
}

function selectable(id: string): boolean {
  const box = doc.boxes[id];
  return !!(box?.external || box?.ambient);
}

function select(id: string | undefined) {
  if (id === selected) return;
  selected = id;
  update();
}

function go(id: string) {
  location.hash = encodeURIComponent(id);
}

function up() {
  const { focus } = readState();
  const target = ix.parent.get(focus) ?? (focus === doc.startFocus ? undefined : doc.startFocus);
  if (target) go(target);
}

const render = createRenderer(document.querySelector<SVGSVGElement>("#map")!, {
  click: (id) => (selectable(id) ? select(id === selected ? undefined : id) : go(id)),
  up,
  background: () => select(undefined),
});

function renderCrumbs(focus: string) {
  const trail = ix.parent.has(focus) || focus === doc.startFocus
    ? [...ancestors(ix, focus).reverse(), focus]
    : [doc.startFocus, focus];
  d3.select("#crumbs")
    .selectAll("a")
    .data(trail)
    .join("a")
    .text((id) => doc.boxes[id]?.label ?? id)
    .attr("href", (id) => `#${encodeURIComponent(id)}`)
    .classed("current", (id) => id === focus);
}

function update() {
  const state = readState();
  render(arrange(ix, deriveView(ix, state)));
  renderCrumbs(state.focus);
}

window.addEventListener("hashchange", () => {
  selected = undefined;
  update();
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && selected) select(undefined);
  else if (ev.key === "Escape" || ev.key === "Backspace") up();
});
update();
