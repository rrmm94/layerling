import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/classroom/route";
import { GET as projects, POST as save, DELETE as remove } from "@/app/api/shared-projects/route";
import { GET as thumbnail, POST as saveThumbnail } from "@/app/api/project-thumbnail/route";
import { GET as mcp } from "@/app/api/layerling-mcp/route";
import { createSession, readDatabase, workspaceDirectory, mutate } from "@/lib/classroom/store";
import { exportLylProject } from "@/lib/lylProject";
import { DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";

let dir: string, admin: string, course: { id: string; code: string }, ben: { id: string }, tim: { id: string }, benCookie: string, personalCode: string;
const cookie = (token: string) => `layerling_session=${token}`;
function request(url: string, method = "GET", auth = "", body?: BodyInit, extra: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { method, headers: { Origin: "http://localhost", ...(auth ? { Cookie: auth } : {}), ...extra }, body });
}
const action = (body: Record<string, unknown>, auth = admin, origin = "http://localhost") => POST(request("/api/classroom", "POST", auth, JSON.stringify(body), { "Content-Type": "application/json", Origin: origin }));
async function packageBytes() { return exportLylProject({ projectId: "keyring", projectName: "Schlüsselanhänger", shapes: [], snapGrid: "Off", workspace: DEFAULT_WORKPLANE_WORKSPACE, assets: [] }); }
async function seed() {
  const bytes = await packageBytes();
  const response = await save(request("/api/shared-projects?fileName=Schluessel.lyl", "POST", benCookie, bytes, { "if-none-match": "*" }));
  expect(response.status).toBe(201);
  return bytes;
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "layerling-classroom-"));
  vi.stubEnv("LAYERLING_CLASSROOM", "true"); vi.stubEnv("LAYERLING_CLASSROOM_DATA_DIR", dir); vi.stubEnv("LAYERLING_ADMIN_PASSWORD", "test-only-long-admin-password"); vi.stubEnv("LAYERLING_COOKIE_SECURE", "false");
  await readDatabase(); admin = cookie(await createSession({ role: "admin" }));
  const created = await (await action({ action: "createCourse", name: "3D-Druck" })).json(); course = created.course;
  const b = await (await action({ action: "createStudent", courseId: course.id, name: "Ben" })).json(); ben = b.student; personalCode = b.personalCode;
  tim = (await (await action({ action: "createStudent", courseId: course.id, name: "Tim" })).json()).student;
  benCookie = cookie(await createSession({ role: "student", studentId: ben.id }));
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });

describe("classroom login and administration", () => {
  it("does not publish courses or names to visitors", async () => {
    expect(await (await GET(request("/api/classroom"))).json()).toEqual({ enabled: true, session: null });
    expect((await GET(request("/api/classroom?admin=1"))).status).toBe(200); // anonymous status has no private data
    const response = await action({ action: "course", code: course.code }, "");
    expect(await response.json()).toEqual({ course: { name: "3D-Druck", personalCodes: false } });
  });
  it("logs in by class code and normalized name with an HttpOnly cookie", async () => {
    const response = await action({ action: "login", code: course.code.toLowerCase(), name: " ben " }, "");
    expect(response.status).toBe(200); const header = response.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=strict");
    const state = await (await GET(request("/api/classroom", "GET", header.split(";")[0]))).json();
    expect(state.student.name).toBe("Ben"); expect(state.session.role).toBe("student");
  });
  it("rejects a wrong class code or unknown name", async () => {
    expect((await action({ action: "login", code: "WRONG", name: "Ben" }, "")).status).toBe(401);
    expect((await action({ action: "login", code: course.code, name: "Marie" }, "")).status).toBe(401);
  });
  it("authenticates the administrator and rejects a wrong password", async () => {
    expect((await action({ action: "adminLogin", password: "wrong" }, "")).status).toBe(401);
    expect((await action({ action: "adminLogin", password: "test-only-long-admin-password" }, "")).status).toBe(200);
  });
  it("can require personal codes without storing their plaintext", async () => {
    await action({ action: "updateCourse", courseId: course.id, name: "3D-Druck", personalCodes: true });
    expect((await action({ action: "login", code: course.code, name: "Ben" }, "")).status).toBe(401);
    expect((await action({ action: "login", code: course.code, name: "Ben", personalCode }, "")).status).toBe(200);
    const raw = await fs.readFile(path.join(dir, "classroom.json"), "utf8"); expect(raw).not.toContain(personalCode); expect(raw).not.toContain("test-only-long-admin-password");
    const reset = await (await action({ action: "resetStudentCode", studentId: ben.id })).json();
    expect((await action({ action: "login", code: course.code, name: "Ben", personalCode }, "")).status).toBe(401);
    expect((await action({ action: "login", code: course.code, name: "Ben", personalCode: reset.personalCode }, "")).status).toBe(200);
  });
  it("rejects duplicate names in one course but permits them in another", async () => {
    expect((await action({ action: "createStudent", courseId: course.id, name: "BEN" })).status).toBe(409);
    const other = (await (await action({ action: "createCourse", name: "Robotik" })).json()).course;
    expect((await action({ action: "createStudent", courseId: other.id, name: "Ben" })).status).toBe(200);
  });
  it("reserves management and copying for administrators", async () => {
    for (const a of ["createCourse", "createStudent", "deleteStudent", "copyDesign"]) expect((await action({ action: a, name: "x", studentId: tim.id }, benCookie)).status).toBe(403);
    expect((await GET(request("/api/classroom?admin=1", "GET", benCookie))).status).toBe(403);
  });
  it("rejects cross-origin writes, large bodies and invalid JSON", async () => {
    expect((await action({ action: "createCourse", name: "x" }, admin, "https://evil.example")).status).toBe(403);
    expect((await action({ action: "createCourse", name: "x".repeat(17000) })).status).toBe(413);
    expect((await POST(request("/api/classroom", "POST", admin, "{", { "Content-Type": "application/json" }))).status).toBe(400);
  });
  it("rotates invitations and revokes a deleted student's access", async () => {
    await action({ action: "rotateCourse", courseId: course.id });
    expect((await action({ action: "course", code: course.code }, "")).status).toBe(401);
    expect((await action({ action: "deleteCourse", courseId: course.id })).status).toBe(400);
    await action({ action: "deleteStudent", studentId: ben.id });
    expect((await projects(request("/api/shared-projects", "GET", benCookie))).status).toBe(401);
  });
  it("invalidates logout tokens and expired sessions", async () => {
    await action({ action: "logout" }, benCookie);
    expect((await projects(request("/api/shared-projects", "GET", benCookie))).status).toBe(401);
    const files = await fs.readdir(path.join(dir, "sessions"));
    for (const file of files) { const f = path.join(dir, "sessions", file); const data = JSON.parse(await fs.readFile(f, "utf8")); data.expires = 0; await fs.writeFile(f, JSON.stringify(data)); }
    expect((await action({ action: "createCourse", name: "x" })).status).toBe(403);
  });
  it("does not silently overwrite a corrupted database", async () => {
    await fs.writeFile(path.join(dir, "classroom.json"), "not json");
    await expect(readDatabase()).rejects.toThrow(); expect(await fs.readFile(path.join(dir, "classroom.json"), "utf8")).toBe("not json");
  });
  it.each(["short", "REPLACE_WITH_A_LONG_RANDOM_PASSWORD", "x".repeat(201)])("refuses an unusable bootstrap password", async password => {
    await fs.rm(path.join(dir, "classroom.json")); vi.stubEnv("LAYERLING_ADMIN_PASSWORD", password);
    await expect(readDatabase()).rejects.toThrow("12 bis 200");
    await expect(fs.stat(path.join(dir, "classroom.json"))).rejects.toThrow();
  });
  it("serializes mutations and releases the filesystem lock after a failure", async () => {
    await expect(mutate(() => { throw new Error("test"); })).rejects.toThrow("test");
    expect((await action({ action: "createCourse", name: "Still works" })).status).toBe(200);
  });
  it("throttles repeated failed name guesses", async () => {
    let response: Response | undefined;
    for (let i = 0; i < 21; i++) response = await action({ action: "login", code: course.code, name: "unknown" }, "");
    expect(response!.status).toBe(429);
  });
});
describe("server design isolation", () => {
  it("requires login for reads, writes, deletes, settings and thumbnails", async () => {
    for (const handler of [projects, save, remove, thumbnail]) expect((await handler(request("/api/shared-projects"))).status).toBe(401);
    expect((await projects(request("/api/shared-projects?settings=default"))).status).toBe(401);
  });
  it("saves, lists and reloads a valid package only inside the student's directory", async () => {
    const bytes = await seed();
    const response = await projects(request("/api/shared-projects", "GET", benCookie)); const data = await response.json();
    expect(data.projects).toHaveLength(1); expect(response.headers.get("cache-control")).toContain("no-store");
    const timCookie = cookie(await createSession({ role: "student", studentId: tim.id }));
    expect((await (await projects(request("/api/shared-projects", "GET", timCookie))).json()).projects).toHaveLength(0);
    const read = await projects(request("/api/shared-projects?fileName=Schluessel.lyl", "GET", benCookie));
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    expect((await projects(request("/api/shared-projects?fileName=Schluessel.lyl", "GET", timCookie))).status).toBe(404);
    expect(new Uint8Array(await fs.readFile(path.join(workspaceDirectory(ben.id), "Schluessel.lyl")))).toEqual(bytes);
  });
  it("rejects forged workspace selectors, proxy identities and path traversal", async () => {
    await seed();
    expect((await projects(request(`/api/shared-projects?student=${tim.id}`, "GET", benCookie))).status).toBe(403);
    expect((await projects(request("/api/shared-projects", "GET", benCookie, undefined, { "x-layerling-student": tim.id }))).status).toBe(403);
    expect((await projects(request("/api/shared-projects?path=../", "GET", benCookie))).status).toBe(400);
    vi.stubEnv("LAYERLING_USER_HEADER", "X-Forwarded-User");
    expect((await projects(request("/api/shared-projects", "GET", "", undefined, { "X-Forwarded-User": ben.id }))).status).toBe(401);
  });
  it("lets an administrator inspect a selected workspace, but requires a selector", async () => {
    await seed();
    expect((await projects(request("/api/shared-projects", "GET", admin))).status).toBe(403);
    expect((await (await projects(request(`/api/shared-projects?student=${ben.id}`, "GET", admin))).json()).projects).toHaveLength(1);
  });
  it("copies between students without changing the source, and persists across re-login", async () => {
    const bytes = await seed();
    const copied = await action({ action: "copyDesign", from: ben.id, to: tim.id, fileName: "Schluessel.lyl", path: "" });
    expect(copied.status).toBe(201); const data = await copied.json();
    const original = await fs.readFile(path.join(workspaceDirectory(ben.id), "Schluessel.lyl"));
    const duplicate = await fs.readFile(path.join(workspaceDirectory(tim.id), data.project.fileName));
    expect(new Uint8Array(original)).toEqual(bytes); expect(duplicate).toEqual(original);
    await fs.writeFile(path.join(workspaceDirectory(tim.id), data.project.fileName), "changed copy");
    expect(await fs.readFile(path.join(workspaceDirectory(ben.id), "Schluessel.lyl"))).toEqual(original);
    const login = await action({ action: "login", code: course.code, name: "Ben" }, "");
    const newCookie = login.headers.get("set-cookie")!.split(";")[0];
    expect((await (await projects(request("/api/shared-projects", "GET", newCookie))).json()).projects).toHaveLength(1);
  });
  it("copies nested designs and rejects missing sources or recipients", async () => {
    await seed(); await fs.mkdir(path.join(workspaceDirectory(ben.id), "Vorlagen"));
    await fs.rename(path.join(workspaceDirectory(ben.id), "Schluessel.lyl"), path.join(workspaceDirectory(ben.id), "Vorlagen", "Schluessel.lyl"));
    expect((await action({ action: "copyDesign", from: ben.id, to: tim.id, fileName: "Schluessel.lyl", path: "Vorlagen" })).status).toBe(201);
    expect((await action({ action: "copyDesign", from: ben.id, to: tim.id, fileName: "absent.lyl" })).status).toBe(404);
    expect((await action({ action: "copyDesign", from: ben.id, to: "other", fileName: "Schluessel.lyl" })).status).toBe(404);
  });
  it("keeps preview images private even when the project id is known", async () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    expect((await saveThumbnail(request("/api/project-thumbnail", "POST", benCookie, JSON.stringify({ projectId: "known", dataUrl: image }), { "Content-Type": "application/json" }))).status).toBe(200);
    const timCookie = cookie(await createSession({ role: "student", studentId: tim.id }));
    expect((await thumbnail(request("/api/project-thumbnail?projectId=known", "GET", timCookie))).status).toBe(404);
    expect((await thumbnail(request("/api/project-thumbnail?projectId=known", "GET", benCookie))).status).toBe(200);
  });
  it("disables the global MCP bridge in classroom mode", async () => {
    vi.stubEnv("LAYERLING_MCP_REMOTE", "true"); vi.stubEnv("LAYERLING_MCP_TOKEN", "test-token-of-sufficient-length");
    expect((await mcp(request("/api/layerling-mcp"))).status).toBe(404);
    expect(await (await mcp(request("/api/layerling-mcp?status=1"))).json()).toEqual({ remote: false });
  });
});
