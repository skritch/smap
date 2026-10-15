// Map IR as rendered by the viewer (SPEC §2.1).

export type Side = "in" | "left" | "right" | "up" | "down";

export interface Box {
  label: string;
  summary?: string;
  side: Side;
  /** What this box's interior directions mean. */
  axes?: string;
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
