import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { originMatchesRequest } from "@/lib/sameOrigin";
import { ClassroomError, enabled, readDatabase, mutate, name, normalize, newCode, hashSecret, verifySecret, createSession, getSession, requireAdmin, workspaceStudent, logout } from "@/lib/classroom/store";
import { classroomFailure } from "@/lib/classroom/guard";
import { GET as getProjects, POST as saveProject } from "@/app/api/shared-projects/route";

export const runtime = "nodejs";
export const revalidate = false;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const attempts = new Map<string, { count: number; until: number }>();
function throttle(key: string, max: number) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const hash = createHash("sha256").update(key).digest("hex");
  const entry = attempts.get(hash) ?? { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= max || (!attempts.has(hash) && attempts.size >= 5000)) throw new ClassroomError("Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.", 429);
  entry.count++; attempts.set(hash, entry);
}
function cookie(request: Request, token: string, maxAge = 43200) {
  // Set LAYERLING_COOKIE_SECURE=true for an HTTPS reverse proxy. Never trust client-supplied forwarding headers.
  return { name: "layerling_session", value: token, httpOnly: true, sameSite: "strict" as const, secure: process.env.LAYERLING_COOKIE_SECURE === "true" || new URL(request.url).protocol === "https:", path: "/", maxAge };
}
export async function GET(request: Request) {
  try {
    if (!enabled()) return json({ enabled: false });
    const db = await readDatabase();
    const session = await getSession(request);
    if (!session) return json({ enabled: true, session: null });
    if (new URL(request.url).searchParams.has("admin")) {
      await requireAdmin(request);
      return json({ courses: db.courses, students: db.students.map(({ codeHash: _, ...s }) => s) });
    }
    let student = null;
    if (session.role === "student" || new URL(request.url).searchParams.has("student")) {
      const selected = await workspaceStudent(request);
      student = { id: selected.id, name: selected.name, courseName: db.courses.find(c => c.id === selected.courseId)?.name };
    }
    return json({ enabled: true, session: { role: session.role }, student });
  } catch (error) { return classroomFailure(error); }
}
export async function POST(request: Request) {
  try {
    if (!enabled()) return json({ error: "Kursmodus ist ausgeschaltet." }, 404);
    if (!originMatchesRequest(request) || request.headers.get("sec-fetch-site") === "cross-site") throw new ClassroomError("Diese Anfrage stammt nicht von dieser Seite.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ClassroomError("JSON erwartet.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new ClassroomError("Anfrage fehlt.");
    let raw = ""; let bytes = 0; const decoder = new TextDecoder();
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 16384) { await reader.cancel(); throw new ClassroomError("Anfrage zu groß.", 413); } raw += decoder.decode(chunk.value, { stream: true }); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw + decoder.decode()); } catch { throw new ClassroomError("Ungültige Anfrage."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClassroomError("Ungültige Anfrage.");
    const str = (key: string) => typeof body[key] === "string" ? (body[key] as string).slice(0, 200) : "";
    const action = str("action");
    if (["course", "login", "adminLogin"].includes(action)) {
      throttle("all-logins", 1000);
      throttle(action === "adminLogin" ? "admin" : `course:${normalize(str("code"))}`, action === "adminLogin" ? 12 : 200);
    }
    if (action === "course") {
      const course = (await readDatabase()).courses.find(c => c.code === str("code").trim().toUpperCase());
      if (!course) throw new ClassroomError("Dieser Klassencode wurde nicht gefunden.", 401);
      return json({ course: { name: course.name, personalCodes: course.personalCodes } });
    }
    if (action === "adminLogin" || action === "login") {
      const db = await readDatabase();
      let studentId: string | undefined;
      if (action === "adminLogin") {
        if (!await verifySecret(str("password"), db.adminHash)) throw new ClassroomError("Anmeldung fehlgeschlagen.", 401);
      } else {
        throttle(`student:${normalize(str("code"))}:${normalize(str("name"))}`, 20);
        const course = db.courses.find(c => c.code === str("code").trim().toUpperCase());
        const student = db.students.find(s => s.courseId === course?.id && normalize(s.name) === normalize(str("name")));
        if (!course || !student || (course.personalCodes && !await verifySecret(str("personalCode").trim().toUpperCase(), student.codeHash))) throw new ClassroomError("Klassencode, Name oder persönlicher Code stimmen nicht.", 401);
        studentId = student.id;
      }
      // Rotate and invalidate the previous session when another account signs in.
      await logout(request);
      const token = await createSession({ role: action === "adminLogin" ? "admin" : "student", ...(studentId ? { studentId } : {}) });
      const response = json({ ok: true }); response.cookies.set(cookie(request, token)); return response;
    }
    if (action === "logout") { await logout(request); const response = json({ ok: true }); response.cookies.set(cookie(request, "", 0)); return response; }
    await requireAdmin(request);
    if (action === "copyDesign") {
      const db = await readDatabase();
      if (!db.students.some(s => s.id === str("from")) || !db.students.some(s => s.id === str("to"))) throw new ClassroomError("Schülerzugang nicht gefunden.", 404);
      const headers = new Headers(request.headers); headers.set("x-layerling-student", str("from")); headers.delete("content-length");
      const query = new URLSearchParams({ fileName: str("fileName"), path: str("path") });
      const source = await getProjects(new Request(new URL(`/api/shared-projects?${query}`, request.url), { headers }));
      if (!source.ok) return source;
      const filename = str("fileName").replace(/\.(lyl|skf)$/i, "").slice(0, 80) + ` (Kopie-${randomUUID().slice(0, 6)}).lyl`;
      headers.set("x-layerling-student", str("to")); headers.set("if-none-match", "*"); headers.delete("if-match"); headers.set("content-type", "application/octet-stream");
      // The normal project route validates the package and writes atomically without overwriting a design.
      const result = await saveProject(new Request(new URL(`/api/shared-projects?${new URLSearchParams({ fileName: filename })}`, request.url), { method: "POST", headers, body: await source.arrayBuffer() }));
      return result;
    }
    const result = await mutate(async db => {
      const course = db.courses.find(c => c.id === str("courseId"));
      const student = db.students.find(s => s.id === str("studentId"));
      if (action === "createCourse") {
        const course = { id: randomUUID(), name: name(body.name), code: newCode(), personalCodes: body.personalCodes === true };
        db.courses.push(course); return { course };
      }
      if (action === "updateCourse" || action === "rotateCourse" || action === "deleteCourse") {
        if (!course) throw new ClassroomError("Kurs nicht gefunden.", 404);
        if (action === "updateCourse") { course.name = name(body.name); course.personalCodes = body.personalCodes === true; }
        if (action === "rotateCourse") course.code = newCode();
        if (action === "deleteCourse") {
          if (db.students.some(s => s.courseId === course.id)) throw new ClassroomError("Bitte zuerst die Schülerzugänge entfernen.");
          db.courses = db.courses.filter(c => c.id !== course.id);
        }
        return { ok: true };
      }
      if (action === "createStudent") {
        if (!course) throw new ClassroomError("Kurs nicht gefunden.", 404);
        const loginName = name(body.name);
        if (db.students.some(s => s.courseId === course.id && normalize(s.name) === normalize(loginName))) throw new ClassroomError("Dieser Login-Name existiert in diesem Kurs bereits.", 409);
        const personalCode = newCode();
        const student = { id: randomUUID(), courseId: course.id, name: loginName, codeHash: await hashSecret(personalCode) };
        db.students.push(student); return { student: { id: student.id, name: student.name }, personalCode };
      }
      if (action === "resetStudentCode" || action === "deleteStudent") {
        if (!student) throw new ClassroomError("Zugang nicht gefunden.", 404);
        if (action === "deleteStudent") { db.students = db.students.filter(s => s.id !== student.id); return { ok: true }; }
        const personalCode = newCode(); student.codeHash = await hashSecret(personalCode); return { personalCode };
      }
      throw new ClassroomError("Unbekannte Aktion.");
    });
    return json(result);
  } catch (error) { return classroomFailure(error); }
}
