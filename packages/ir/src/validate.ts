export interface Validation {
  /** The map can't be rendered (or would render wrongly) until these are fixed. */
  errors: string[];
  /** Renders, but probably not what was meant. */
  warnings: string[];
}

const SIDES = ["in", "left", "right", "up", "down"];
const DIRS = ["left", "right", "up", "down"];
const BOX_KEYS = ["label", "summary", "side", "axes", "sources", "children", "external", "ambient"];
const EDGE_KEYS = ["id", "from", "to", "label"];

/** Checks a parsed map file. Messages name the box or edge at fault. */
export function validate(doc: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(doc)) return { errors: ["the map must be a JSON object"], warnings };
  for (const key of Object.keys(doc)) {
    if (!["startFocus", "boxes", "edges"].includes(key)) warnings.push(`unknown top-level field "${key}"`);
  }
  if (!isObject(doc.boxes)) return { errors: ['"boxes" must be an object of id → box'], warnings };
  const boxes = doc.boxes;
  const ids = new Set(Object.keys(boxes));

  const parent = new Map<string, string>();
  for (const [id, box] of Object.entries(boxes)) {
    const at = `box "${id}"`;
    if (!isObject(box)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    for (const key of Object.keys(box)) {
      if (!BOX_KEYS.includes(key)) warnings.push(`${at}: unknown field "${key}"`);
    }
    if (typeof box.label !== "string" || !box.label) errors.push(`${at}: "label" must be a non-empty string`);
    if (!SIDES.includes(box.side as string)) errors.push(`${at}: "side" must be one of ${SIDES.join(", ")}`);
    if (box.summary !== undefined && typeof box.summary !== "string") errors.push(`${at}: "summary" must be a string`);
    const axes = box.axes;
    // Older maps gave axes as one sentence; they still render, without the compass.
    if (typeof axes === "string") warnings.push(`${at}: "axes" is now an object like {"left": "user"}; the sentence is ignored`);
    else if (axes !== undefined) {
      const ok = isObject(axes) && Object.entries(axes).every(([k, v]) => DIRS.includes(k) && typeof v === "string" && v);
      if (!ok) errors.push(`${at}: "axes" must map some of ${DIRS.join(", ")} to non-empty strings`);
    }
    for (const key of ["external", "ambient"]) {
      if (box[key] !== undefined && typeof box[key] !== "boolean") errors.push(`${at}: "${key}" must be true or false`);
    }
    if (!isStrings(box.sources)) errors.push(`${at}: "sources" must be an array of strings (may be empty)`);
    if (!isStrings(box.children)) {
      errors.push(`${at}: "children" must be an array of box ids (may be empty)`);
      continue;
    }
    if (box.external && box.children.length) errors.push(`${at} is external, so it can't have children`);
    for (const c of box.children) {
      if (!ids.has(c)) errors.push(`${at}: child "${c}" is not a box`);
      else if (c === id) errors.push(`${at} lists itself as a child`);
      else if (parent.has(c)) errors.push(`box "${c}" has two parents: "${parent.get(c)}" and "${id}"`);
      else parent.set(c, id);
    }
  }

  // Containment must be a tree.
  for (const id of ids) {
    const seen = new Set([id]);
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) {
      if (seen.has(p)) {
        errors.push(`box "${id}" is inside itself (children form a cycle)`);
        break;
      }
      seen.add(p);
    }
  }

  const start = doc.startFocus;
  if (typeof start !== "string" || !ids.has(start)) {
    errors.push('"startFocus" must be the id of a box');
  } else {
    if (parent.has(start)) errors.push(`startFocus "${start}" must have no parent (it is inside "${parent.get(start)}")`);
    const b = boxes[start];
    if (isObject(b) && (b.external || b.ambient)) errors.push(`startFocus "${start}" can't be external or ambient`);
  }

  if (!Array.isArray(doc.edges)) {
    errors.push('"edges" must be an array (may be empty)');
  } else {
    const edgeIds = new Set<string>();
    const pairs = new Set<string>();
    doc.edges.forEach((e, i) => {
      if (!isObject(e)) {
        errors.push(`edge #${i} must be an object`);
        return;
      }
      const at = typeof e.id === "string" ? `edge "${e.id}"` : `edge #${i}`;
      for (const key of Object.keys(e)) {
        if (!EDGE_KEYS.includes(key)) warnings.push(`${at}: unknown field "${key}"`);
      }
      if (typeof e.id !== "string" || !e.id) errors.push(`${at}: "id" must be a non-empty string`);
      else if (edgeIds.has(e.id)) errors.push(`${at}: duplicate id`);
      else edgeIds.add(e.id);
      for (const key of ["from", "to"]) {
        if (typeof e[key] !== "string" || !ids.has(e[key] as string)) errors.push(`${at}: "${key}" must be a box id`);
      }
      if (e.label !== undefined && typeof e.label !== "string") errors.push(`${at}: "label" must be a string`);
      if (e.from === e.to) warnings.push(`${at} goes from "${e.from}" to itself and won't be drawn`);
      const pair = `${e.from}->${e.to}`;
      if (pairs.has(pair)) warnings.push(`${at} repeats ${pair}; edges between the same boxes are merged`);
      pairs.add(pair);
    });
  }

  return { errors, warnings };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
