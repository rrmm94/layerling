/** Reproducible Chromium touch regression check. Run only against a LOCAL test classroom. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";

const base = process.env.LAYERLING_TEST_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Use a local TEST instance: this check creates disposable courses and designs.");
const password = (await readFile(process.env.LAYERLING_TEST_ADMIN_PASSWORD_FILE || ".codex/classroom-dev/admin-password", "utf8")).trim();
const output = process.env.LAYERLING_TEST_SCREENSHOTS || "test-results/ipad";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.LAYERLING_TEST_CHROMIUM ? { executablePath: process.env.LAYERLING_TEST_CHROMIUM } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const options = { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, locale: "de-DE", userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" };
const admin = await browser.newContext(options);
const page = await admin.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const courseIds = [], studentIds = [];
async function api(context, data) {
  const response = await context.request.post(`${base}/api/classroom`, { data });
  const value = await response.json();
  assert.ok(response.ok(), `${data.action}: ${value.error || response.status()}`);
  return value;
}
async function shot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }
async function layout(page) {
  const problems = await page.evaluate(() => {
    const visible = e => e.getBoundingClientRect().width && e.getBoundingClientRect().height;
    const problems = [];
    for (const e of document.querySelectorAll(".school,.school-dialog,.school-main,.school-workspace-bar")) {
      if (visible(e) && e.scrollWidth > e.clientWidth + 2) problems.push(`Overflow: ${e.className}`);
    }
    for (const e of document.querySelectorAll(".school button,.school a,.school-workspace-bar button")) {
      const rect = e.getBoundingClientRect();
      if (visible(e) && (rect.height < 43.5 || rect.width < 43.5)) problems.push(`Small touch target: ${e.getAttribute("aria-label") || e.textContent.trim()}`);
    }
    for (const e of document.querySelectorAll(".school input:not([type=checkbox]),.school select,.school-editor-container input")) {
      if (visible(e) && parseFloat(getComputedStyle(e).fontSize) < 16) problems.push("Input below 16px (Safari focus zoom)");
    }
    return problems;
  });
  assert.deepEqual(problems, []);
}
async function geometry(context) {
  const response = await context.request.get(`${base}/api/shared-projects?all=1`);
  assert.ok(response.ok());
  const { projects } = await response.json();
  for (const project of projects) {
    const file = await context.request.get(`${base}/api/shared-projects?${new URLSearchParams({ path: project.path || "", fileName: project.fileName })}`);
    assert.ok(file.ok());
    const bytes = await file.body();
    const document = JSON.parse(strFromU8(unzipSync(bytes)["project.json"]));
    if (document.states.some(state => state.nodes.length > 0)) return { bytes, project };
  }
  return null;
}
async function eventually(check, message, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(message);
}
// Send real multi-touch input, rather than substituting mouse drags for fingers.
async function gesture(page, start, end) {
  const cdp = await page.context().newCDPSession(page);
  const points = coords => coords.map(([x,y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(start) });
  for (let step = 1; step <= 10; step++) {
    const next = start.map(([x,y], i) => [x + (end[i][0]-x)*step/10, y + (end[i][1]-y)*step/10]);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(next) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(400);
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Dein Kurs wartet.", exact: true }).waitFor();
  await layout(page); await shot(page, "ipad-anmeldung-hochformat");
  await api(admin, { action: "adminLogin", password });
  await page.reload();
  await page.getByRole("button", { name: "Neuer Kurs", exact: true }).tap();
  const name = `iPad-Werkstatt · ${Date.now().toString(36).slice(-4)}`;
  await page.getByLabel("Kursname", { exact: true }).fill(name);
  await layout(page);
  await page.getByRole("button", { name: "Speichern", exact: true }).tap();
  await page.getByRole("heading", { name, exact: true }).waitFor();
  const state = await (await admin.request.get(`${base}/api/classroom?admin=1`)).json();
  const course = state.courses.find(c => c.name === name); assert.ok(course); courseIds.push(course.id);
  await page.getByRole("button", { name: "Zugang anlegen", exact: true }).tap();
  await page.getByLabel("Login-Name", { exact: true }).fill("Ben");
  await page.getByRole("button", { name: "Speichern", exact: true }).tap();
  await page.getByRole("heading", { name: "Ben", exact: true }).waitFor();
  const updated = await (await admin.request.get(`${base}/api/classroom?admin=1`)).json();
  const ben = updated.students.find(s => s.courseId === course.id && s.name === "Ben"); studentIds.push(ben.id);
  const tim = (await api(admin, { action: "createStudent", courseId: course.id, name: "Tim" })).student; studentIds.push(tim.id);
  await page.getByRole("button", { name: "Hinweis schließen", exact: true }).tap();
  for (const [width,height] of [[768,1024],[1024,700],[744,1133],[507,768]]) {
    await page.setViewportSize({ width, height }); await layout(page);
  }
  await page.getByRole("combobox", { name: "Kurs auswählen", exact: true }).selectOption(course.id);
  assert.ok(await page.getByRole("heading", { name, exact: true }).isVisible());
  await shot(page, "ipad-geteilte-ansicht");
  await page.setViewportSize({ width: 1024, height: 700 });
  await shot(page, "ipad-kursverwaltung-querformat");

  // Model the Safari keyboard shrinking visualViewport while innerHeight stays unchanged.
  await page.getByRole("button", { name: "Zugang anlegen", exact: true }).tap();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport, { height: { configurable: true, value: 330 }, offsetTop: { configurable: true, value: 30 } });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await eventually(() => page.locator(".school-dialog").evaluate(e => { const r=e.getBoundingClientRect();return r.top >= 30 && r.bottom <= 360; }), "Dialog hidden behind simulated keyboard");
  await page.getByRole("button", { name: "Schließen", exact: true }).tap();
  await page.evaluate(() => { delete window.visualViewport.height; delete window.visualViewport.offsetTop; window.visualViewport.dispatchEvent(new Event("resize")); });

  let saved;
  for (const [width,height,simple] of [[768,1024,false],[1024,700,true],[744,1133,true],[507,768,true]]) {
    const child = await browser.newContext({ ...options, viewport: { width, height } });
    const p = await child.newPage(); p.setDefaultTimeout(60000); p.on("pageerror", e => errors.push(e.message));
    await p.goto(`${base}/?class=${course.code}&mode=${simple ? "simple" : "full"}`);
    await p.getByLabel("Dein Login-Name", { exact: true }).fill("Ben");
    await p.getByRole("button", { name: "Los geht’s", exact: true }).tap();
    await p.getByRole("button", { name: "Neuen 3D-Entwurf anlegen", exact: true }).tap();
    await p.locator(".shape-menu-trigger").tap();
    await p.getByRole("button", { name: "Quader", exact: true }).tap();
    const canvas = p.locator(".workplane-stage canvas").first();
    const rect = await canvas.boundingBox(); assert.ok(rect && rect.height > 150);
    await p.touchscreen.tap(rect.x + rect.width * .58, rect.y + rect.height * .58);
    await p.getByText("Quader hinzugefügt", { exact: true }).waitFor();
    await layout(p);
    const regions = await p.evaluate(() => ({ ribbon: document.querySelector(".secondary-toolbar").getBoundingClientRect().bottom, tools: document.querySelector(".toolbar-mode-content").getBoundingClientRect().bottom, canvas: document.querySelector(".workplane-stage").getBoundingClientRect().top, camera: document.querySelector(".camera-controls").getBoundingClientRect().bottom, floor: document.querySelector(".editor-body").getBoundingClientRect().bottom, name: document.querySelector(".toolbar-project-name input").getBoundingClientRect().width }));
    assert.ok(regions.canvas >= regions.tools - 2, `Wrapped tools cover canvas: ${JSON.stringify(regions)}`);
    assert.ok(regions.camera <= regions.floor + 2, `Camera controls clipped: ${JSON.stringify(regions)}`);
    assert.ok(regions.name >= 150, "Project name squeezed out on portrait iPad");
    const controls = p.locator(".camera-controls");
    await controls.evaluate(e => { e.scrollTop = e.scrollHeight; });
    await p.locator(".camera-controls button").last().scrollIntoViewIfNeeded();
    await controls.evaluate(e => { e.scrollTop = 0; });
    if (width === 1024) {
      // An empty part of the workplane rotates with one finger, zooms/pans with two.
      const free = await p.evaluate(() => { const canvas=document.querySelector(".workplane-stage").getBoundingClientRect();const inspector=document.querySelector(".shape-inspector");const edge=inspector?.getBoundingClientRect().left;return edge > 0 ? Math.min(canvas.right,edge) : canvas.right; });
      const before = await canvas.screenshot();
      await gesture(p, [[free*.65,rect.y+rect.height*.18]], [[free*.8,rect.y+rect.height*.28]]);
      assert.notDeepEqual(await canvas.screenshot(), before, "One-finger orbit did not change the viewport");
      const zoomBefore = await canvas.screenshot();
      await gesture(p, [[free*.35,rect.y+rect.height*.25],[free*.65,rect.y+rect.height*.25]], [[free*.25,rect.y+rect.height*.25],[free*.75,rect.y+rect.height*.25]]);
      assert.notDeepEqual(await canvas.screenshot(), zoomBefore, "Pinch did not change the viewport");
      const panBefore = await canvas.screenshot();
      await gesture(p, [[free*.35,rect.y+rect.height*.25],[free*.65,rect.y+rect.height*.25]], [[free*.35+30,rect.y+rect.height*.25+20],[free*.65+30,rect.y+rect.height*.25+20]]);
      assert.notDeepEqual(await canvas.screenshot(), panBefore, "Two-finger pan did not change the viewport");
    }
    await shot(p, `ipad-editor-${width}-${height}`);
    await p.getByRole("button", { name: "Abmelden", exact: true }).tap();
    await p.getByRole("heading", { name: "Dein Kurs wartet.", exact: true }).waitFor();
    await api(child, { action: "login", code: course.code, name: "Ben" });
    saved = await geometry(child); assert.ok(saved, "CAD geometry was not saved on the server");
    await child.close();
    console.log(`PASS iPad touch ${width}×${height} (${simple ? "simple" : "full"}): layout, placement, save, logout`);
  }
  // The teacher can still forward the actual CAD package after touch editing.
  const copy = await api(admin, { action: "copyDesign", from: ben.id, to: tim.id, fileName: saved.project.fileName, path: saved.project.path });
  const recipient = await browser.newContext(options);
  await api(recipient, { action: "login", code: course.code, name: "Tim" });
  const received = await recipient.request.get(`${base}/api/shared-projects?fileName=${encodeURIComponent(copy.project.fileName)}`);
  assert.deepEqual(await received.body(), saved.bytes);
  await recipient.close();
  assert.deepEqual(errors, []);
  console.log("PASS teacher copy, keyboard viewport and zero browser errors");
} finally {
  for (const id of studentIds) await api(admin, { action: "deleteStudent", studentId: id }).catch(() => {});
  for (const id of courseIds) await api(admin, { action: "deleteCourse", courseId: id }).catch(() => {});
  await api(admin, { action: "logout" }).catch(() => {});
  await browser.close();
}
