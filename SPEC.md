# SMAP Draft Spec

---

## 1. Vision

### 1.1 What this is

A tool that turns a codebase into a **zoomable, hierarchical map**. The map is meant to be the *primary* way to navigate an unfamiliar repo, instead of the file tree.

The use case: open a large, illegible (often vibecoded) repo for the first time and let the tool run for about a minute. It shows a map of the overall structure. From then on, navigate the codebase through the map: zoom into components, click through to code.

The feeling should be **opening the hood of a car**: all the moving parts laid out, at a level of detail you can take in.

### 1.2 Approximate, not rigorous

- This is **not** an architecture diagram and not a deterministic extraction of structure. The goal is an *approximate, natural* view: the codebase roughly as it exists in an experienced practitioner's mental model.
- Many parts are omitted. Lower-level details are hidden. Neighboring components at the same level of abstraction are out of sight until relevant.
- The representation can be **stupid**, especially in a first pass. We draw boxes and arrows in sensible places. We don't attempt a faithful model of program semantics.
- Producing this view is an **LLM-driven "compile"** from source to map, in the spirit of [vibe-compiler](https://github.com/skritch/vibe-compiler).

### 1.3 Hierarchical graph, focus + context

- The map is a hierarchy of components, in principle arbitrarily zoomable.
- At any focus, the screen shows a **sensible amount of stuff**: the focused component's interior, plus its immediate context (upstreams, downstreams, persistence, etc.) arranged around it.
- **Zoom example:** the view is centered on "the app". Click the routing box and routing becomes the focus. Business logic, previously a sibling, moves off to the side as a neighbor. Routing's interior appears: handlers, grouped sensibly. Click a handler to zoom into its GET/POST/etc. implementations.

### 1.4 Directions as dimensions

Spatial directions carry meaning, like mapping data dimensions to x, y and color in a plotting library. The mapping is semi-rigorous, heuristic, and chosen per context.

- **Web app:** left = toward the user (server, internet); right = toward backend systems (external APIs); down = toward persistence (DB, filesystem).
- **Data pipeline:** left→right = dataflow (sources → DAG of grouped stages → outputs, with possible recursive edges); up = alerting; down = side reads and writes of config and metadata.
- A component's **interior dimensions need not match its exterior ones.**

### 1.5 Other dimensions of the space

Beyond the 2D plane, a program has further "dimensions", shown one at a time, never all at once. See [Dimensions in Data Engineering](https://samkrit.ch/posts/2025-08-30-data-dimensions/).

- **Lifecycle.** The app is *instantiated* by an execution graph of its own: read CLI and config → validate → instantiate server with routes → app object. Same structure, a different point in the program's lifecycle. The output of the construction graph *is* the app shown in the runtime view.
- **Compilation / build.** Another dimension.
- **Tests.** E.g. tests associated with each component, shown as a separate layer or overlay.
- **Plumbing.** App-wide dependencies like logging are a lower layer, hidden by default. If the 2D view is SimCity, these are the pipes under the street, revealed on demand.

### 1.6 Programs within programs

Interiors of a program can often be thought of as *other programs running in the context of the original*:

- A Python web server runs a routing program.
- Each route is a program in a DSL of HTTP plus business logic.
- An embedded SQL query is a program run by the database.

Often a program conceptually "interpolates inputs into a DSL program and runs it", possibly with very different semantics: streaming, reactive, differentiable, etc. Zooming in is something like entering that inner program.

This is inspiration for v1, not a requirement.

### 1.7 Binding

Like D3: **things in the codebase are bound to visual elements.** Which entities become nodes and which become edges depends on context:

- **App-like interiors:** components are nodes; the data and types flowing between them are edge labels.
- **Dataflow interiors:** data are nodes; transformations are edges.

### 1.8 Object permanence

The map is a map. Things stay where they are across zooms, regenerations and edits, so spatial memory works.

### 1.9 Interaction

- Click a node → go to the code.
- Rearrange with natural-language input ("this section is too granular", "group these differently").
- Alternate views and dimensions on request (e.g. the tests layer).
- **Targets:** browser first (prototype), then a VS Code plugin as an alternative to the textual view.
- Graphics must be performant.

### 1.10 Non-goals for v1

- Huge monorepos. The initial target is "understand the codebases at my new job."
- Exact or deterministic architecture recovery.
- Language-specific ASTs or type resolution.
- Multiple dimensions (lifecycle, build, tests), the plumbing layer, typed "interior kinds".
- 3D.

---

## 2. MVP Architecture

```
source tree ──► ingest ──► LLM compile passes ──► map IR (+ source map) ──► view derivation ──► layout ──► render
  (strings)   (det.)         (orchestrated)          (persisted JSON)         (det.)           (det.)
```

The LLM only touches the compile passes. Everything else is deterministic.

### 2.1 Map data structure

The v1 IR is deliberately stupid: nodes, edges, directions.

**Box (node)**

| field      | notes                                                                                 |
|------------|---------------------------------------------------------------------------------------|
| `id`       | stable across regeneration and edits                                                  |
| `label`    | short name                                                                            |
| `summary`  | one line                                                                              |
| `side`     | `in \| left \| right \| up \| down`, placement relative to parent                     |
| `axes`     | optional sentence describing what this box's interior directions mean                 |
| `sources`  | files and/or symbol names this box covers (see §2.4)                                  |
| `children` | child boxes (may be unexpanded / not yet computed)                                    |

**Edge**

| field   | notes                         |
|---------|-------------------------------|
| `id`    | stable                        |
| `from`  | box id                        |
| `to`    | box id                        |
| `label` | optional (e.g. type flowing)  |

Example fixture:

```json
{
  "root": "app",
  "boxes": {
    "app":      { "label": "App", "summary": "Order service", "side": "in",
                  "axes": "left = user, right = backend services, down = persistence",
                  "sources": ["src/"], "children": ["routes", "logic", "config"] },
    "server":   { "label": "HTTP server", "side": "left",  "sources": ["src/main.py"], "children": [] },
    "db":       { "label": "Postgres",    "side": "down",  "sources": ["src/db.py"],   "children": [] },
    "payments": { "label": "Payments API","side": "right", "sources": ["src/clients/pay.py"], "children": [] },
    "routes":   { "label": "Routing",     "side": "in",    "sources": ["src/routes/"], "children": [] },
    "logic":    { "label": "Business logic","side": "in",  "sources": ["src/orders.py"], "children": [] },
    "config":   { "label": "Config",      "side": "in",    "sources": ["src/config.py"], "children": [] }
  },
  "edges": [
    { "id": "e1", "from": "server", "to": "routes" },
    { "id": "e2", "from": "routes", "to": "logic", "label": "OrderRequest" },
    { "id": "e3", "from": "logic",  "to": "db" },
    { "id": "e4", "from": "logic",  "to": "payments" }
  ]
}
```

Open questions:
- How are external neighbors (server, DB, payments) parented? As siblings of `app` under an implicit root, or as children with an outward `side`?
- Exact ID scheme.
- On-disk location and format (e.g. a `.codemap/` directory).

### 2.2 Rendering

- Browser first. Must also work later inside a VS Code webview.
- **Focus model:** render the focused box's interior plus its context. Neighbors outside the focus are projected onto the frame's sides as stubs or ports, according to `side`.
- **Detail budget:** decided by the renderer, not the LLM. Show what fits; collapse the rest ("+N more").
- **Transitions:** keyed by stable IDs, D3-style enter/update/exit, so zooming and edits animate rather than redraw.
- **Layout:** deterministic given the IR. Pin positions once placed. A constraint-capable layered layout engine (ELK is a candidate) running off the main thread.

Open questions:
- Renderer technology (SVG / Canvas / WebGL). Node counts per view are small by design.
- Camera model: true continuous zoom vs. discrete focus changes with animated transitions.

### 2.3 Source ingest

- Read the whole source tree as strings, respecting ignore rules (`.gitignore`, vendored code, build output).
- Content-hash every file, for caching and incrementality.
- Cheap symbol extraction: regex for definitions (`def`, `class`, `function`, `export`, …) per language. No ASTs in v1.
- A string index for fast name lookup (ripgrep-style).

Open questions:
- Whether tree-sitter is worth adding later.

### 2.4 Source maps

- Every box's `sources` lists the files and symbol **names** it covers. The LLM names things; ingest resolves names to file and line spans deterministically. LLMs are unreliable with line numbers.
- **Primary anchor** per box: where a click navigates. Other anchors are shown on hover or in a side panel.
- **Containment invariant:** a child's sources are a subset of its parent's. Enforced in code.
- **Coverage:** every file is assigned to some box or appears in a visible "unassigned" bucket. Coverage % is a first-class metric.

### 2.5 LLM usage

Mostly a fixed workflow (a tree walk with structured calls), not free-roaming agents.

| pass             | model  | input                                                                           | output                                                    |
|------------------|--------|---------------------------------------------------------------------------------|-----------------------------------------------------------|
| file digest      | small  | one file                                                                        | purpose, key symbols, external touchpoints (DB/HTTP/env/fs/queues), imports |
| skeleton         | large  | all digests + manifests + README + entrypoint heads                             | "what is this project", top-level boxes, sides, edges, file→box assignment |
| refine box       | large  | box's digests + full text of key files                                          | children, edges, assignment                               |
| coverage repair  | large  | unassigned files + current boxes                                                | assignments (one retry, then leave unassigned)            |
| edit             | large  | NL instruction + current subtree                                                | patch ops (rename / merge / split / move / set side / reassign) |

Deterministic glue:
- **Candidate edges** between siblings are computed by import and name grep across their files. The LLM labels and prunes them rather than inventing edges.
- **Validation:** schema check, containment, ID reuse.

Refinement is **lazy**: run eagerly to about depth 2, then on demand as the user zooms.

Open questions:
- How the skeleton pass determines the project's basic shape (app vs. pipeline vs. multi-process system) and chooses directional semantics.
- Prompt design for sides and axes.

### 2.6 LLM connections / harness

- The orchestrator is our own code. Tentatively TypeScript, to share code with the browser and VS Code targets.
- Structured calls go through the API directly, with JSON-schema outputs.
- Exploratory steps that need to read or grep around (e.g. "where is the app constructed?") use an existing agent harness, such as the Claude Agent SDK.
- **Caching:**
  - LLM pass outputs are keyed by the content hashes of their inputs.
  - Prompt caching applies to the shared prefix (repo summary, skeleton) across refinement calls.

Open questions:
- Model choices per pass.
- Concurrency and rate limits.
- Cost ceiling per run.

### 2.7 Persistence & incrementality

- The map IR and pass caches persist to disk.
- On source changes, re-run only the passes whose inputs changed, reusing IDs and pinned positions.

### 2.8 Evaluation

- 2–3 real repos (from work), each with hand-written "top-level boxes I'd draw".
- Re-run after prompt changes and compare.
- Track coverage % alongside.

---

## 3. Milestones

**M0: Dummy map.**
Render a hand-written fixture JSON (§2.1) in the browser: boxes, edges, sides. Click a box to make it the focus; go back up.

**M1: Navigation feel.**
- Focus + context: neighbors projected to frame sides.
- Stable-ID-keyed animated transitions.
- Pinned layout.
- Click → open file (e.g. a `vscode://file/...` link).

Iterate on the fixture until navigating it *feels* right.

**M2: Ingest + digests.**
- CLI reads a repo: file list, hashes, cheap symbols, string index.
- Per-file digests via a small model, cached.
- Dump to disk and inspect.

**M3: Skeleton pass.**
- First real map from a real repo: top-level boxes, sides, edges, assignment.
- Coverage repair and a visible unassigned bucket.
- Rendered in the M1 viewer.
- Start the eval set.

**M4: Lazy refinement.**
- Zooming into an unexpanded box triggers the refine pass.
- Candidate edges from grep.
- Source-map containment enforced.

**M5: Natural-language edits.**
Instruction → patch ops → animated update, with IDs preserved.

**M6: VS Code webview.**
Same viewer inside VS Code; click-to-code via the editor API.

**Later, unordered:**
- Lifecycle / construction dimension.
- Plumbing layer.
- Tests layer.
- Data-as-nodes binding for pipelines.
- Typed interior kinds.
- Incremental regeneration on diffs.
- Tree-sitter.
- Larger repos.
