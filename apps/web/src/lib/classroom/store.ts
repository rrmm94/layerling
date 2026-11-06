/** Single-server classroom store. Keep this directory outside the public web root. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export type Course = { id: string; name: string; code: string; personalCodes: boolean };
export type Student = { id: string; courseId: string; name: string; codeHash: string };
export type Database = { version: 1; adminHash: string; courses: Course[]; students: Student[] };
export type Session = { role: "admin" | "student"; studentId?: string; expires: number };
export class ClassroomError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const enabled = () => process.env.LAYERLING_CLASSROOM === "true";
export function dataDirectory() {
  const dir = process.env.LAYERLING_CLASSROOM_DATA_DIR?.trim();
  if (!dir) throw new ClassroomError("LAYERLING_CLASSROOM_DATA_DIR fehlt.", 503);
  return path.resolve(dir);
}
export function workspaceDirectory(studentId: string) {
  if (!/^[a-f0-9-]{36}$/.test(studentId)) throw new ClassroomError("Ungültiger Zugang.");
  return path.join(dataDirectory(), "projects", studentId);
}
export const newCode = () => randomBytes(6).toString("hex").toUpperCase();
export const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("de");
export function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value)) throw new ClassroomError("Bitte einen Namen mit 1 bis 80 Zeichen eingeben.");
  return value.trim().normalize("NFKC");
}
export async function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(secret, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifySecret(secret: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const hash = await scrypt(secret, salt, 64) as Buffer;
  return timingSafeEqual(hash, Buffer.from(expected, "hex"));
}
async function atomicJson(file: string, value: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}
/** A filesystem lock also serializes independent Next workers. Never overwrite an unreadable store. */
export async function mutate<T>(action: (db: Database) => T | Promise<T>): Promise<T> {
  const dir = dataDirectory();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = await fs.open(path.join(dir, ".lock"), "wx", 0o600).catch(() => { throw new ClassroomError("Die Verwaltung ist gerade beschäftigt. Bitte erneut versuchen.", 409); });
  try {
    let db: Database;
    try { db = JSON.parse(await fs.readFile(path.join(dir, "classroom.json"), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const secretFile = process.env.LAYERLING_ADMIN_PASSWORD_FILE;
      const password = secretFile ? (await fs.readFile(secretFile, "utf8")).trim() : process.env.LAYERLING_ADMIN_PASSWORD ?? "";
      if (password.length < 12 || password.length > 200 || password === "REPLACE_WITH_A_LONG_RANDOM_PASSWORD") throw new ClassroomError("Zum ersten Start ein eigenes Admin-Passwort mit 12 bis 200 Zeichen konfigurieren.", 503);
      db = { version: 1, adminHash: await hashSecret(password), courses: [], students: [] };
    }
    if (db.version !== 1) throw new ClassroomError("Unbekannte Version der Kursdaten.", 503);
    const result = await action(db);
    await atomicJson(path.join(dir, "classroom.json"), db);
    return result;
  } finally { await lock.close(); await fs.unlink(path.join(dir, ".lock")); }
}
export async function readDatabase(): Promise<Database> {
  try {
    const db: Database = JSON.parse(await fs.readFile(path.join(dataDirectory(), "classroom.json"), "utf8"));
    if (db.version !== 1) throw new ClassroomError("Unbekannte Version der Kursdaten.", 503);
    return db;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return mutate(db => structuredClone(db));
  }
}
const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createSession(session: Omit<Session, "expires">) {
  const token = randomBytes(32).toString("hex");
  const dir = path.join(dataDirectory(), "sessions");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Expired sessions are removed at login, keeping storage bounded across restarts.
  for (const file of await fs.readdir(dir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const entry = JSON.parse(await fs.readFile(path.join(dir, file), "utf8").catch(() => "null")) as Session | null;
    if (!entry || entry.expires <= Date.now()) await fs.rm(path.join(dir, file), { force: true });
  }
  await atomicJson(path.join(dir, `${sessionKey(token)}.json`), { ...session, expires: Date.now() + 12 * 60 * 60 * 1000 });
  return token;
}
export function requestToken(request: Request) {
  return /(?:^|;\s*)layerling_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1];
}
export async function getSession(request: Request): Promise<Session | null> {
  const token = requestToken(request);
  if (!token) return null;
  const file = path.join(dataDirectory(), "sessions", `${sessionKey(token)}.json`);
  const session = JSON.parse(await fs.readFile(file, "utf8").catch(() => "null")) as Session | null;
  if (!session || session.expires <= Date.now()) return null;
  if (session.role === "student" && !(await readDatabase()).students.some(s => s.id === session.studentId)) return null;
  return session;
}
export async function logout(request: Request) {
  const token = requestToken(request);
  if (token) await fs.rm(path.join(dataDirectory(), "sessions", `${sessionKey(token)}.json`), { force: true });
}
export async function requireAdmin(request: Request) {
  if ((await getSession(request))?.role !== "admin") throw new ClassroomError("Nur für die Lehrkraft.", 403);
}
export async function workspaceStudent(request: Request) {
  const session = await getSession(request);
  if (!session) throw new ClassroomError("Bitte zuerst anmelden.", 401);
  const requested = request.headers.get("x-layerling-student") || new URL(request.url).searchParams.get("student");
  const id = session.role === "admin" ? requested : session.studentId;
  if (session.role === "student" && requested && requested !== id) throw new ClassroomError("Kein Zugriff auf andere Zugänge.", 403);
  const student = (await readDatabase()).students.find(s => s.id === id);
  if (!student) throw new ClassroomError("Bitte einen Schülerzugang auswählen.", 403);
  return student;
}
