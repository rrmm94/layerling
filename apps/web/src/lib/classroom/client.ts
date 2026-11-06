/** Scope editor caches to this tab's authenticated workspace, including shared classroom computers. */
let workspace: string | null = null;
export function setClassroomWorkspace(id: string | null) { workspace = id; }
export function classroomWorkspace() { return workspace; }
export function scopedKey(key: string) { return workspace ? `classroom.${workspace}.${key}` : key; }
export function scopedDatabase(name: string) { return scopedKey(name); }
export function editorStorage(): Storage {
  if (!workspace) return window.localStorage;
  const storage = window.localStorage;
  const prefix = `classroom.${workspace}.`;
  const keys = () => Object.keys(storage).filter(k => k.startsWith(prefix));
  return {
    get length() { return keys().length; },
    key: index => keys()[index]?.slice(prefix.length) ?? null,
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
    clear: () => keys().forEach(k => storage.removeItem(k)),
  };
}
export function classroomFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!workspace || !url.startsWith("/api/")) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("x-layerling-student", workspace);
  return fetch(input, { ...init, headers });
}
export function workspaceUrl(url: string) {
  if (!workspace || !url.startsWith("/api/")) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("student", workspace);
  return parsed.pathname + parsed.search;
}
/** Preserve the selected admin workspace when the editor rewrites its own URL. */
export function workspacePageUrl(url: string) {
  if (!workspace) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set("student", workspace);
  return parsed.pathname + parsed.search;
}
