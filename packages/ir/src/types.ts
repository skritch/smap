// Map IR as rendered by the viewer (SPEC §2.1).

export type Side = "in" | "left" | "right" | "up" | "down";

/** What each direction means inside a box; directions with no meaning are left out. */
export type Axes = Partial<Record<Exclude<Side, "in">, string>>;

export interface Box {
  label: string;
  /** Outside the codebase (a database, an API, the user). Never has children. */
  external?: boolean;
  /**
   * Touches many things (config, alerting, logging). Its edges stay in the map
   * but the renderer summarizes them instead of drawing each one.
   */
  ambient?: boolean;
  summary?: string;
  side: Side;
  /** What this box's interior directions mean. */
  axes?: Axes;
  sources: string[];
  children: string[];
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface MapDoc {
  /** Box the view opens on. The renderer tracks the live focus separately. */
  startFocus: string;
  boxes: Record<string, Box>;
  edges: Edge[];
}
