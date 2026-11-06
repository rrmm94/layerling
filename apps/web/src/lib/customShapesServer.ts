import { classroomFetch } from "@/lib/classroom/client";
import { CUSTOM_SHAPE_FOLDER_DEPTH, joinFolderPath } from "@/lib/customShapeFolders";
import { SHARED_PROJECTS_ENDPOINT } from "@/lib/sharedProjectsEndpoint";

/*
 * Custom shapes on the server: one folder of the shared store, with one .lyl
 * per shape - the same files and the same requests as any design there, so
 * store.php and the Node route need nothing new. The folder shows on the start
 * page too, where a shape can be opened and changed like a design. Its name is
 * English on purpose: it is one folder for every language.
 *
 * Folders of custom shapes are folders inside it, up to three levels deep, as
 * in the browser; each goes by its path inside it ("Brackets/M3"). Deeper
 * ones made on the start page are left alone.
 */

export const CUSTOM_SHAPES_FOLDER = "Custom shapes";
const LYL_MEDIA_TYPE = "application/vnd.layerling.project+zip";

export type ServerCustomShape = {
  fileName: string;
  /** The path of the folder inside "Custom shapes" it sits in ("Brackets/M3"); null at the top. */
  folder: string | null;
  name: string;
  updatedAt: number;
  size: number;
  revision: string;
  thumbnailUrl?: string;
};

/** `folders` are paths, each folder after the one it sits in. */
export type ServerCustomShapes = { shapes: ServerCustomShape[]; folders: string[] };

/** The store path of a folder of custom shapes, or of the custom shapes folder itself. */
function folderPath(folder: string | null) {
  return folder ? `${CUSTOM_SHAPES_FOLDER}/${folder}` : CUSTOM_SHAPES_FOLDER;
}

/** The id a server shape goes by in the editor. One at the top keeps the id it always had. */
export function serverCustomShapeId(shape: Pick<ServerCustomShape, "fileName" | "folder">) {
  return `server:${shape.folder ? `${shape.folder}/` : ""}${shape.fileName}`;
}

function query(folder: string | null, fileName?: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ path: folderPath(folder), ...extra });
  if (fileName) params.set("fileName", fileName);
  return `${SHARED_PROJECTS_ENDPOINT}?${params.toString()}`;
}

async function failure(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error ?? fallback);
}

/** The file a shape is kept under: its name, made safe for every file system. */
export function customShapeFileName(name: string) {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 100) || "Shape";
  return `${base}.lyl`;
}

async function listFolder(folder: string | null) {
  const response = await classroomFetch(query(folder), { cache: "no-store" });
  if (!response.ok) throw await failure(response, "Could not list the custom shapes on the server");
  const payload = await response.json() as { projects?: Array<Omit<ServerCustomShape, "folder">>; folders?: Array<{ name: string }> };
  return {
    shapes: (payload.projects ?? []).map((shape) => ({ ...shape, folder })),
    folders: (payload.folders ?? []).map((entry) => entry.name),
  };
}

/**
 * The shapes and folders, or null when the server keeps nothing (no store on
 * this installation). A store without the folder yet has no shapes.
 */
export async function listServerCustomShapes(): Promise<ServerCustomShapes | null> {
  const rootResponse = await classroomFetch(SHARED_PROJECTS_ENDPOINT, { cache: "no-store" }).catch(() => null);
  if (!rootResponse) return null;
  const root = await rootResponse.json().catch(() => ({})) as { enabled?: boolean; folders?: Array<{ name: string }> };
  if (!root.enabled) return null;
  if (!root.folders?.some((folder) => folder.name === CUSTOM_SHAPES_FOLDER)) return { shapes: [], folders: [] };
  const folders: string[] = [];
  // One level at a time, each level's folders asked for together.
  const walk = async (folder: string | null, depth: number): Promise<ServerCustomShape[]> => {
    const listed = await listFolder(folder);
    if (depth >= CUSTOM_SHAPE_FOLDER_DEPTH) return listed.shapes;
    const inside = [...listed.folders].sort((a, b) => a.localeCompare(b)).map((name) => joinFolderPath(folder, name));
    folders.push(...inside);
    const deeper = await Promise.all(inside.map((path) => walk(path, depth + 1)));
    return [...listed.shapes, ...deeper.flat()];
  };
  const shapes = (await walk(null, 0)).sort((a, b) => a.updatedAt - b.updatedAt || a.name.localeCompare(b.name));
  return { shapes, folders };
}

async function ensureFolder() {
  const response = await classroomFetch(`${SHARED_PROJECTS_ENDPOINT}?${new URLSearchParams({ folder: CUSTOM_SHAPES_FOLDER }).toString()}`, { method: "POST" });
  // 409: it is there already, which is what we wanted.
  if (!response.ok && response.status !== 409) throw await failure(response, "Could not create the custom shapes folder on the server");
}

/** Puts a new shape into the folder; a name already taken is refused, never overwritten. */
export async function saveServerCustomShape(name: string, bytes: Uint8Array, thumbnailDataUrl: string, takenMessage: string, folder: string | null = null) {
  await ensureFolder();
  const fileName = customShapeFileName(name);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("project", new Blob([body], { type: LYL_MEDIA_TYPE }), fileName);
  if (thumbnailDataUrl.startsWith("data:image/png")) {
    const thumbnail = await (await classroomFetch(thumbnailDataUrl)).blob();
    if (thumbnail.size > 0) form.append("thumbnail", thumbnail, `${fileName}.png`);
  }
  const response = await classroomFetch(query(folder, fileName), { method: "POST", headers: { "If-None-Match": "*" }, body: form });
  if (response.status === 409 || response.status === 412) throw new Error(takenMessage);
  if (!response.ok) throw await failure(response, "Could not save the shape on the server");
  const payload = await response.json() as { project?: Omit<ServerCustomShape, "folder"> };
  if (!payload.project) throw new Error("Could not save the shape on the server");
  return { ...payload.project, folder };
}

type ServerShapeRef = Pick<ServerCustomShape, "fileName" | "folder" | "revision">;

export async function readServerCustomShape(shape: Pick<ServerCustomShape, "fileName" | "folder">) {
  const response = await classroomFetch(query(shape.folder, shape.fileName), { cache: "no-store" });
  if (!response.ok) throw await failure(response, "This shape is no longer on the server");
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteServerCustomShape(shape: ServerShapeRef) {
  const response = await classroomFetch(query(shape.folder, shape.fileName), { method: "DELETE", headers: { "If-Match": `"${shape.revision}"` } });
  if (!response.ok) throw await failure(response, "Could not delete the shape on the server");
}

/** There is no renaming a file in the store, so it is a copy under the new name, then away with the old one. */
export async function renameServerCustomShape(shape: ServerShapeRef, name: string, takenMessage: string) {
  const target = customShapeFileName(name);
  if (target === shape.fileName) return;
  const response = await classroomFetch(query(shape.folder, shape.fileName, { copyTo: target }), { method: "POST", headers: { "If-Match": `"${shape.revision}"` } });
  if (response.status === 409) throw new Error(takenMessage);
  if (!response.ok) throw await failure(response, "Could not rename the shape on the server");
  await deleteServerCustomShape(shape);
}

/** Into a folder, or with `null` back to the top; its picture goes along. A name taken there is refused. */
export async function moveServerCustomShape(shape: ServerShapeRef, folder: string | null, takenMessage: string) {
  if ((shape.folder ?? null) === folder) return;
  const response = await classroomFetch(query(shape.folder, shape.fileName, { moveTo: folderPath(folder) }), { method: "POST", headers: { "If-Match": `"${shape.revision}"` } });
  if (response.status === 409) throw new Error(takenMessage);
  if (!response.ok) throw await failure(response, "Could not move the shape on the server");
}

/** A new folder at the top, or inside the folder at `parent`. */
export async function createServerCustomShapeFolder(name: string, takenMessage: string, parent: string | null = null) {
  await ensureFolder();
  const response = await classroomFetch(query(parent, undefined, { folder: name.trim() }), { method: "POST" });
  if (response.status === 409) throw new Error(takenMessage);
  if (!response.ok) throw await failure(response, "Could not create the folder on the server");
}

export async function renameServerCustomShapeFolder(folder: string, name: string, takenMessage: string) {
  const response = await classroomFetch(query(folder, undefined, { renameTo: name.trim() }), { method: "POST" });
  if (response.status === 409) throw new Error(takenMessage);
  if (!response.ok) throw await failure(response, "Could not rename the folder on the server");
}

/** The folder with every shape in it. */
export async function deleteServerCustomShapeFolder(folder: string) {
  const response = await classroomFetch(query(folder, undefined, { deleteFolder: "1", recursive: "1" }), { method: "DELETE" });
  if (!response.ok) throw await failure(response, "Could not delete the folder on the server");
}
