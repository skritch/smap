# smap

A zoomable, hierarchical map of a codebase, meant as the primary way to navigate an unfamiliar repo. See [SPEC.md](SPEC.md).

Right now maps are written by hand (or by an agent): there is no compiler yet.

## Setup

```sh
npm install
```

## Viewing a map

```sh
npm run view -- <map.json | repo dir>   # a repo dir means <repo>/.smap/map.json
```

This opens the viewer and reloads it whenever the map file changes. Paths are relative to where you run it, so an alias works from anywhere:

```sh
smap() { npm --prefix ~/smap run view -- "${1:-.}"; }
```

The dropdown in the top left also lists the example maps in `fixtures/`. `npm run dev` opens the viewer on the fixtures alone.

Navigation: click a box to zoom in. Click the frame, empty space, a breadcrumb, or press Esc to zoom out. External (dashed) and ambient (rounded) boxes are selected rather than zoomed into: their connections light up.

## Writing a map

See [docs/writing-maps.md](docs/writing-maps.md) for the format and conventions. Point an agent at that file. Check a map with:

```sh
npm run check -- <map.json | repo dir>
```

## Development

```sh
npm test            # vitest
npm run typecheck
```

Packages: `packages/ir` (map types and validation), `packages/render` (the viewer).
