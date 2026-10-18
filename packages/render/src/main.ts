import * as d3 from "d3";
import { validate, type MapDoc } from "@smap/ir";
import { arrange } from "./arrange";
import { createRenderer } from "./draw";
import { ancestors, indexDoc } from "./model";
import { deriveView, type ViewState } from "./view";

// Maps to choose from: the file passed to `npm run view` (served at
// /@smap/map.json) when there is one, otherwise the fixtures.
const fixtures = import.meta.glob<unknown>("../../../fixtures/*.json", { eager: true, import: "default" });
const FILE = "file";

interface Loaded {
  label: string;
  doc?: unknown;
  problem?: string;
}

async function loadFile(): Promise<Loaded | undefined> {
  // Only `npm run view` serves a map; its responses carry the file's path.
  const res = await fetch("/@smap/map.json");
  const header = res.headers.get("x-smap-path");
  if (!header) return undefined;
  const path = decodeURIComponent(header);
  const label = path.split("/").slice(-3).join("/");
  const text = await res.text();
  if (!res.ok) return { label, problem: text };
  try {
    return { label, doc: JSON.parse(text) };
  } catch (e) {
    return { label, problem: `${path} is not valid JSON: ${(e as Error).message}` };
  }
}

async function main() {
  const maps = new Map<string, Loaded>();
  const file = await loadFile();
  // Viewing a repo's map shows only that map; the fixtures are for development.
  if (file) maps.set(FILE, file);
  else
    for (const [path, doc] of Object.entries(fixtures)) {
      const name = path.split("/").pop()!.replace(/\.json$/, "");
      maps.set(name, { label: name, doc });
    }
  const chosen = new URLSearchParams(location.search).get("fixture") ?? (file ? FILE : "app");

  // Dev-only map switcher; switching starts the new map at its start focus.
  d3.select<HTMLSelectElement, unknown>("#fixture")
    .on("change", (ev: Event) => {
      location.href = `?fixture=${encodeURIComponent((ev.target as HTMLSelectElement).value)}`;
    })
    .selectAll("option")
    .data([...maps.keys()])
    .join("option")
    .attr("value", (n) => n)
    .property("selected", (n) => n === chosen)
    .text((n) => maps.get(n)!.label);

  const map = maps.get(chosen);
  if (!map) return showProblems([`unknown map "${chosen}"`], []);
  if (map.problem) return showProblems([map.problem], []);
  const { errors, warnings } = validate(map.doc);
  showProblems(errors, warnings);
  if (!errors.length) start(map.doc as MapDoc);
}

/** Lists validation problems over the map; errors stop rendering, warnings don't. */
function showProblems(errors: string[], warnings: string[]) {
  d3.select("#problems")
    .classed("blocking", errors.length > 0)
    .selectAll("div")
    .data([...errors.map((m) => `error: ${m}`), ...warnings.map((m) => `warning: ${m}`)])
    .join("div")
    .text((m) => m);
}

function start(doc: MapDoc) {
  const ix = indexDoc(doc);

  // Focus and selection live in the URL hash (`#focus` or `#focus+selected`),
  // so reload and browser back/forward work. External and ambient boxes are
  // selected rather than focused.
  function readState(): ViewState {
    const [id = "", sel] = location.hash.slice(1).split("+").map(decodeURIComponent);
    const focusable = Object.hasOwn(doc.boxes, id) && !selectable(id);
    const selected = sel !== undefined && selectable(sel) ? sel : undefined;
    return { focus: focusable ? id : doc.startFocus, selected };
  }

  function selectable(id: string): boolean {
    const box = doc.boxes[id];
    return !!(box?.external || box?.ambient);
  }

  function go(focus: string, selected?: string) {
    location.hash = encodeURIComponent(focus) + (selected ? `+${encodeURIComponent(selected)}` : "");
  }

  function select(id: string | undefined) {
    const state = readState();
    if (id !== state.selected) go(state.focus, id);
  }

  function up() {
    const { focus } = readState();
    const target = ix.parent.get(focus) ?? (focus === doc.startFocus ? undefined : doc.startFocus);
    if (target) go(target);
  }

  const render = createRenderer(document.querySelector<SVGSVGElement>("#map")!, {
    click: (id) => (selectable(id) ? select(id === readState().selected ? undefined : id) : go(id)),
    up,
    // Empty space clears a selection first; otherwise it zooms out, like clicking the frame.
    background: () => (readState().selected ? select(undefined) : up()),
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

  window.addEventListener("hashchange", update);
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && readState().selected) select(undefined);
    else if (ev.key === "Escape" || ev.key === "Backspace") up();
  });
  update();
}

void main();
