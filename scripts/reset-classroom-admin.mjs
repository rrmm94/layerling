// Run with the application stopped. Never pass a password as a command-line argument.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import readline from "node:readline";
const dir = process.argv[2];
if (!dir || !process.stdin.isTTY) throw new Error("Usage: node scripts/reset-classroom-admin.mjs <data-directory> (interactive terminal required)");
const root = path.resolve(dir);
const lock = await fs.open(path.join(root, ".lock"), "wx", 0o600);
async function password(prompt) {
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error) => {
      process.stdin.off("keypress", handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const handler = (text, key) => {
      if (key?.ctrl && key.name === "c") return done(new Error("Aborted"));
      if (key?.name === "return") return done();
      if (key?.name === "backspace") { value = value.slice(0, -1); return; }
      if (text && !key?.ctrl && value.length < 200) value += text;
    };
    process.stdin.on("keypress", handler);
  });
}
try {
  const file = path.join(root, "classroom.json");
  const db = JSON.parse(await fs.readFile(file, "utf8"));
  if (db.version !== 1) throw new Error("Unsupported store version");
  const secret = await password("Neues Admin-Passwort (mindestens 12 Zeichen): ");
  if (secret.length < 12 || secret !== await password("Passwort wiederholen: ")) throw new Error("Passwords differ or are too short");
  const salt = randomBytes(16).toString("hex");
  db.adminHash = `${salt}:${scryptSync(secret, salt, 64).toString("hex")}`;
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db), { mode: 0o600, flag: "wx" });
  await fs.rename(tmp, file);
  await fs.rm(path.join(root, "sessions"), { recursive: true, force: true });
  console.log("Admin-Passwort geändert; vorhandene Sitzungen entfernt.");
} finally { await lock.close(); await fs.unlink(path.join(root, ".lock")); }
