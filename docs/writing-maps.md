# Writing smap maps by hand

You are drawing a map of a codebase for someone onboarding to it. The map is a zoomable hierarchy of boxes: the top level shows the whole system, and each box opens into its own interior. It should look like an experienced engineer's mental model of the code. It is **approximate, not an architecture diagram**: leave things out, group freely, and prefer a clear picture over a complete one.

Write the map to `.smap/map.json` in the root of the repo you're mapping. Check it after every edit:

```sh
npm --prefix <path to smap checkout> run check -- <repo root>
```

The user views it with `npm run view`, and the page reloads whenever the file changes.

## Shape of the file

```json
{
  "startFocus": "app",
  "boxes": {
    "app":      { "label": "App", "summary": "Order service", "side": "in",
                  "axes": { "left": "user", "right": "backend services", "down": "persistence" },
                  "sources": ["src/"], "children": ["routes", "logic", "config"] },
    "routes":   { "label": "Routing", "side": "in", "sources": ["src/routes/"], "children": [] },
    "logic":    { "label": "Business logic", "side": "in", "sources": ["src/orders.py"], "children": [] },
    "config":   { "label": "Config", "ambient": true, "side": "in", "sources": ["src/config.py"], "children": [] },
    "server":   { "label": "HTTP server", "external": true, "side": "left", "sources": ["src/main.py"], "children": [] },
    "db":       { "label": "Postgres", "external": true, "side": "down", "sources": ["src/db.py"], "children": [] },
    "payments": { "label": "Payments API", "external": true, "side": "right", "sources": ["src/clients/pay.py"], "children": [] }
  },
  "edges": [
    { "id": "e1", "from": "server", "to": "routes" },
    { "id": "e2", "from": "routes", "to": "logic", "label": "OrderRequest" },
    { "id": "e3", "from": "logic",  "to": "db" },
    { "id": "e4", "from": "logic",  "to": "payments" },
    { "id": "e5", "from": "config", "to": "routes" },
    { "id": "e6", "from": "config", "to": "logic" }
  ]
}
```

More complete examples are in the smap repo's `fixtures/`: a web app, a data pipeline, and smap itself.

### Boxes

| field      | required | meaning |
|------------|----------|---------|
| `label`    | yes | Short name, a few words. |
| `side`     | yes | `in`, `left`, `right`, `up` or `down`: where the box sits relative to its parent. Children inside a box use `in`. Top-level neighbors use the direction they sit in, relative to the start focus. |
| `sources`  | yes | Repo-relative files or directories this box covers. May be empty for things outside the repo. |
| `children` | yes | Ids of the boxes inside this one. May be empty. Every box has at most one parent. |
| `summary`  | no  | One line. |
| `axes`     | no  | What directions mean inside this box, as an object with any of `left`, `right`, `up`, `down`, e.g. `{"left": "upstream: sources", "right": "downstream: outputs", "down": "persistence"}`. Leave out directions with no meaning. Shown as arrows beside the box's title; hovering one shows its meaning. |
| `external` | no  | `true` for things outside the codebase: databases, third-party APIs, queues, the HTTP server in front of the app. They can't have children. |
| `ambient`  | no  | `true` for things that touch almost everything: config, logging, alerting, metrics. The map keeps their edges, but the viewer summarizes them instead of drawing each one. |

### Edges

| field   | required | meaning |
|---------|----------|---------|
| `id`    | yes | Unique. `e1`, `e2`, … is fine. |
| `from`, `to` | yes | Box ids, **at any depth**. Point edges at the most specific box that's true; the viewer lifts them to whatever is visible. |
| `label` | no  | What flows, in a word or two (`OrderRequest`, `users.parquet`). Usually leave it out. |

### How the viewer reads it

- `startFocus` is the box the view opens on. It must have no parent.
- **Boxes with no parent other than the start focus are its neighbors**: the outside world around it (the HTTP server, the database, an S3 bucket). Their `side` places them around the frame.
- Clicking a box zooms into it. Its siblings and its parent's neighbors become the context around it, shown only where an edge connects them.
- Clicking an external or ambient box highlights what it connects to.

## Conventions

- **Directions mean something.** Pick a main flow for each box's interior and state it in `axes`. For a web app: left = toward the user, right = backend services, down = persistence. For a pipeline: left = upstream, right = downstream, up = alerting, down = side reads. The viewer lays children out left → right along the edges, so edges should point along the flow.
- **About 5–8 things per box.** If a box has more children, group them into intermediate boxes. Two or three levels deep is plenty for a first map.
- **Keep edges light.** An edge says "these are connected", not a protocol spec. Don't add both `a → b` and `b → a`; one edge is enough, and the viewer would merge them anyway.
- **Group similar neighbors.** Three alerting sinks become one "Alerting" box. Several on-disk stores become one.
- **Config is ambient, inside the box it configures.** Give it edges to the components that read it.
- **Alerting and logging are ambient externals.** Give them edges from the components that emit, and the viewer collapses them into one.
- **Startup is a different view.** Draw the running system. Don't draw "config → instantiates app"; that belongs to a lifecycle view we don't have yet.
- **The HTTP server, CLI entrypoint, or job runner in front of the app is external** in this runtime view.

## Workflow

1. Skim the repo: README, manifests, entrypoints, top-level directories.
2. Draft the top level: the start focus box, its 3–8 children, and the external neighbors. Pick `axes`. Run the check.
3. Add edges between the top-level children, then to the neighbors. Check, and let the user look.
4. Go one level deeper in the boxes that matter. Check after each edit.
5. Prefer fixing a confusing picture by regrouping over adding more boxes or edges.
