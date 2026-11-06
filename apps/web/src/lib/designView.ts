import { editorStorage } from "@/lib/classroom/client";
/**
 * Where the camera looked in a design, kept with the design so it opens the way it was left (#220).
 * The view is not part of the design's undo history and saving it never saves the design: it is
 * written to the browser on its own, and a `.lyl` file carries it along as optional editor state.
 */
export type DesignView = {
  orthographic: boolean;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
};

const DESIGN_VIEW_STORAGE_PREFIX = "layerling.designView.";

function vector3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const numbers = value.map((entry) => (typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) < 1e7 ? entry : null));
  return numbers.every((entry) => entry !== null) ? (numbers as [number, number, number]) : null;
}

/** A view read from storage or a file, or null when it is anything but a camera that can look at something. */
export function normalizeDesignView(value: unknown): DesignView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const position = vector3(raw.position);
  const target = vector3(raw.target);
  const up = vector3(raw.up);
  const zoom = raw.zoom;
  if (!position || !target || !up || typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0 || zoom > 1e6) return null;
  // A camera sitting on its target, or an up direction of no length, cannot look anywhere.
  if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 1e-6) return null;
  if (Math.hypot(up[0], up[1], up[2]) < 1e-6) return null;
  return { orthographic: raw.orthographic === true, position, target, up, zoom };
}

export function readDesignView(projectId: string | null | undefined): DesignView | null {
  if (!projectId) return null;
  try {
    const stored = editorStorage().getItem(DESIGN_VIEW_STORAGE_PREFIX + projectId);
    return stored ? normalizeDesignView(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function writeDesignView(projectId: string | null | undefined, view: DesignView | null) {
  if (!projectId) return;
  try {
    if (view) editorStorage().setItem(DESIGN_VIEW_STORAGE_PREFIX + projectId, JSON.stringify(view));
    else editorStorage().removeItem(DESIGN_VIEW_STORAGE_PREFIX + projectId);
  } catch {
    // Without storage the design simply opens in the standard view, as it always did.
  }
}

/**
 * Four views a design keeps on request, under the keys 7, 8, 9 and 0: Shift and the key saves the
 * view, the key alone goes back to it. Kept like the design's own view - per design, beside it in
 * the browser and in a `.lyl` file -, never in the undo history.
 */
export const SAVED_VIEW_KEYS = ["7", "8", "9", "0"] as const;
export type SavedDesignViews = (DesignView | null)[];

const SAVED_VIEWS_STORAGE_PREFIX = "layerling.savedViews.";

/** The four slots read from storage or a file, or null when none holds a view. */
export function normalizeSavedViews(value: unknown): SavedDesignViews | null {
  if (!Array.isArray(value)) return null;
  const views = SAVED_VIEW_KEYS.map((_, slot) => normalizeDesignView(value[slot]));
  return views.some(Boolean) ? views : null;
}

export function readSavedViews(projectId: string | null | undefined): SavedDesignViews {
  const empty = SAVED_VIEW_KEYS.map(() => null);
  if (!projectId) return empty;
  try {
    const stored = editorStorage().getItem(SAVED_VIEWS_STORAGE_PREFIX + projectId);
    return (stored ? normalizeSavedViews(JSON.parse(stored)) : null) ?? empty;
  } catch {
    return empty;
  }
}

export function writeSavedViews(projectId: string | null | undefined, views: SavedDesignViews | null) {
  if (!projectId) return;
  try {
    const kept = normalizeSavedViews(views);
    if (kept) editorStorage().setItem(SAVED_VIEWS_STORAGE_PREFIX + projectId, JSON.stringify(kept));
    else editorStorage().removeItem(SAVED_VIEWS_STORAGE_PREFIX + projectId);
  } catch {
    // Without storage a saved view lasts until the design is left.
  }
}

/**
 * The view a new design opens in and Home goes back to, when the user chose one (#853). It is kept
 * per browser, like whether the editor starts in perspective, so the projection is not part of it:
 * the view is kept as the normal camera would see it.
 */
const START_VIEW_STORAGE_KEY = "layerling.editor.startView";

export function readStartView(): DesignView | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = editorStorage().getItem(START_VIEW_STORAGE_KEY);
    return stored ? normalizeDesignView(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function writeStartView(view: DesignView | null) {
  try {
    const kept = normalizeDesignView(view);
    if (kept) editorStorage().setItem(START_VIEW_STORAGE_KEY, JSON.stringify(kept));
    else editorStorage().removeItem(START_VIEW_STORAGE_KEY);
  } catch {
    // Without storage new designs keep opening in the standard view.
  }
}

/**
 * The slot a key press names, and whether it saves (Shift) or goes back. The key's position
 * (`Digit7`) counts too, because Shift turns the digit into "/" and the like, and on some layouts
 * the digit itself needs Shift.
 */
export function savedViewForKey(key: string, code: string, shiftKey: boolean): { slot: number; save: boolean } | undefined {
  const keys: readonly string[] = SAVED_VIEW_KEYS;
  const slot = keys.indexOf(keys.includes(key) ? key : (/^Digit([0-9])$/.exec(code)?.[1] ?? ""));
  return slot < 0 ? undefined : { slot, save: shiftKey };
}
