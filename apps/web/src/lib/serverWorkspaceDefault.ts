import { classroomFetch } from "@/lib/classroom/client";
import { SHARED_PROJECTS_ENDPOINT } from "@/lib/sharedProjectsEndpoint";
import {
  DEFAULT_SNAP_GRID,
  normalizeSnapGrid,
  normalizeWorkspaceSettings,
  WORKSPACE_DEFAULT_SAVED_EVENT,
  WORKSPACE_DEFAULT_STORAGE_KEY,
} from "@/lib/workplaneSettings";

/*
 * "Make default" on the server. The default lives in the browser, and a browser whose data was cleared starts
 * every new design with the built-in settings again. Where the installation has a server store (Docker,
 * store.php), the default goes there too, and a browser picks it up when the start page loads:
 *
 * - the store has one: it becomes this browser's default, so the last one saved in any browser wins;
 * - the store has none yet, but this browser does: it goes up, so a default made before the store kept one
 *   is not lost.
 *
 * One default for the whole store, as the store is one folder for whoever uses it. Without a store nothing
 * changes; every failure leaves the browser's own default as it was.
 */

const settingsUrl = () => `${SHARED_PROJECTS_ENDPOINT}?settings=default`;

type StoredDefault = { workspace: unknown; snap: unknown };

function storedDefault(storage: Storage): StoredDefault | null {
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_DEFAULT_STORAGE_KEY) ?? "null") as StoredDefault | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Sends this browser's default to the store. False when there is none, or no store took it. */
export async function pushWorkspaceDefaultToServer(storage: Storage, fetchImpl: typeof fetch = classroomFetch) {
  const local = storedDefault(storage);
  if (!local) return false;
  try {
    const response = await fetchImpl(settingsUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: local.workspace, snap: local.snap }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Brings this browser and the store together, as described above. Says what happened: "pulled" (the
 * store's default is now this browser's), "pushed", or "none" (no store, nothing to share, or a failure).
 */
export async function syncWorkspaceDefaultWithServer(storage: Storage, fetchImpl: typeof fetch = classroomFetch): Promise<"pulled" | "pushed" | "none"> {
  let payload: { enabled?: boolean; settings?: { workspace?: unknown; snap?: unknown } | null } | null;
  try {
    const response = await fetchImpl(settingsUrl(), { cache: "no-store" });
    if (!response.ok) return "none";
    payload = await response.json();
  } catch {
    return "none";
  }
  // A store that is off answers the listing; only one that is on says what it keeps.
  if (!payload || payload.enabled !== true || !("settings" in payload)) return "none";
  const server = payload.settings;
  if (server && typeof server === "object" && server.workspace && typeof server.workspace === "object") {
    try {
      // Written straight, not through saveWorkspaceDefault: that would send it back to where it came from.
      storage.setItem(WORKSPACE_DEFAULT_STORAGE_KEY, JSON.stringify({
        workspace: normalizeWorkspaceSettings(server.workspace),
        snap: normalizeSnapGrid(server.snap, DEFAULT_SNAP_GRID),
      }));
      return "pulled";
    } catch {
      return "none";
    }
  }
  return (await pushWorkspaceDefaultToServer(storage, fetchImpl)) ? "pushed" : "none";
}

/** From now on, every default saved in this browser also goes to the store. Returns the way to stop. */
export function sendSavedWorkspaceDefaultsToServer(storage: Storage) {
  const send = () => void pushWorkspaceDefaultToServer(storage);
  window.addEventListener(WORKSPACE_DEFAULT_SAVED_EVENT, send);
  return () => window.removeEventListener(WORKSPACE_DEFAULT_SAVED_EVENT, send);
}
