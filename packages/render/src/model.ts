import type { MapDoc } from "@smap/ir";

/** Lookup tables derived once per MapDoc. */
export interface Index {
  doc: MapDoc;
  parent: Map<string, string>;
  /** Boxes with no parent: the start focus and its neighbors. */
  topLevel: string[];
}

export function indexDoc(doc: MapDoc): Index {
  const parent = new Map<string, string>();
  for (const [id, box] of Object.entries(doc.boxes)) {
    for (const c of box.children) parent.set(c, id);
  }
  const topLevel = Object.keys(doc.boxes).filter((id) => !parent.has(id));
  return { doc, parent, topLevel };
}

export function childrenOf(ix: Index, id: string): string[] {
  return ix.doc.boxes[id]?.children ?? [];
}

/** Ancestors of `id`, nearest first. */
export function ancestors(ix: Index, id: string): string[] {
  const out: string[] = [];
  for (let p = ix.parent.get(id); p !== undefined; p = ix.parent.get(p)) out.push(p);
  return out;
}

/** Other children of `id`'s parent; for top-level boxes, the other top-level boxes. */
export function siblings(ix: Index, id: string): string[] {
  const p = ix.parent.get(id);
  const all = p === undefined ? ix.topLevel : childrenOf(ix, p);
  return all.filter((s) => s !== id);
}

/** The child of `p` that contains `id`, or null if `id` is not strictly inside `p`. */
export function childContaining(ix: Index, id: string, p: string): string | null {
  for (let cur = id; ; ) {
    const up = ix.parent.get(cur);
    if (up === undefined) return null;
    if (up === p) return cur;
    cur = up;
  }
}
