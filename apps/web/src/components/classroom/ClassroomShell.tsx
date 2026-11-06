"use client";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { ArrowRight, BookOpen, Box, Check, ChevronLeft, Copy, GraduationCap, KeyRound, Link as LinkIcon, LogOut, Plus, Settings2, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { setClassroomWorkspace, flushClassroomBeforeLogout } from "@/lib/classroom/client";
import type { Course } from "@/lib/classroom/store";
import "./classroom.css";
import { useClassroomViewport } from "@/lib/useClassroomViewport";

type Student = { id: string; courseId: string; name: string };
type Identity = { enabled: boolean; session?: { role: "admin" | "student" } | null; student?: { id: string; name: string; courseName: string } | null };
type Design = { fileName: string; path: string; name: string; thumbnailUrl?: string };
async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/classroom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
  return data;
}
const Source = () => <a href={process.env.NEXT_PUBLIC_SOURCE_CODE_URL || "https://github.com/rrmm94/layerling"} target="_blank" rel="noreferrer">Quellcode · AGPL-3.0</a>;
const Brand = () => <a className="school-brand" href="/"><img src="/assets/layerling/layerling-logo.svg" alt="" /><span>layerling<span className="school-brand-sub">KLASSENZIMMER</span></span></a>;

export function ClassroomShell({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useClassroomViewport(identity?.enabled === true);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") { setIdentity({ enabled: false }); return; }
    const student = new URLSearchParams(location.search).get("student");
    fetch(`/api/classroom${student ? `?student=${encodeURIComponent(student)}` : ""}`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setClassroomWorkspace(data.student?.id ?? null); setIdentity(data); })
      .catch(e => setError(e.message));
  }, []);
  // A cookie is shared between tabs: stop an already-open editor when another account logs in or the session expires.
  useEffect(() => {
    if (!identity?.enabled || !identity.session) return;
    const check = async () => {
      try {
        const response = await fetch("/api/classroom", { cache: "no-store" }); const next = await response.json();
        if (!response.ok || !next.session || next.session.role !== identity.session?.role || (identity.session?.role === "student" && next.student?.id !== identity.student?.id)) setExpired(true);
      } catch { /* A network interruption leaves the editor's unsaved work intact. */ }
    };
    const timer = window.setInterval(check, 15000); window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [identity]);
  if (error) return <main className="school"><div className="school-empty"><h1>Verbindung nicht möglich</h1><p role="alert">{error}</p><button onClick={() => location.reload()}>Erneut versuchen</button></div></main>;
  if (!identity) return <main className="school"><div className="school-empty">Klassenraum wird geöffnet …</div></main>;
  if (!identity.enabled) return children;
  if (!identity.session) return <Login />;
  if (expired) return <main className="school"><div className="school-empty"><h1>Bitte erneut anmelden</h1><p>Die Sitzung ist abgelaufen oder auf diesem Gerät wurde ein anderer Zugang angemeldet.</p><button onClick={() => location.assign("/")}>Zur Anmeldung</button></div></main>;
  const logout = async () => { setLogoutBusy(true); setLogoutError(""); try { await flushClassroomBeforeLogout(); await api({ action: "logout" }); location.assign("/"); } catch (e) { setLogoutError((e as Error).message); } finally { setLogoutBusy(false); } };
  if (identity.session.role === "admin" && !identity.student) return <><Admin onLogout={logout} />{logoutError && <div className="school-logout-error" role="alert">{logoutError}</div>}</>;
  return <><div className="school-workspace-bar"><span><GraduationCap size={18} /><strong>{identity.student?.name}</strong><span> / {identity.student?.courseName}</span></span><div>{identity.session.role === "admin" && <a href="/">← Kursverwaltung</a>}<button onClick={logout} disabled={logoutBusy}><LogOut size={15} /> {logoutBusy ? "Wird gespeichert …" : "Abmelden"}</button></div></div>{logoutError && <div className="school-logout-error" role="alert">{logoutError}</div>}<div className="school-editor-container">{children}</div></>;
}

function Login() {
  const [admin, setAdmin] = useState(() => new URLSearchParams(location.search).has("admin"));
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("class") ?? "");
  const [course, setCourse] = useState<{ name: string; personalCodes: boolean } | null>(null);
  const [loginName, setName] = useState(""); const [secret, setSecret] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function findCourse() { const data = await api({ action: "course", code }); setCourse(data.course); }
  useEffect(() => { if (code) { setBusy(true); findCourse().catch(e => setError(e.message)).finally(() => setBusy(false)); } }, []); // invitation links preselect the course
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (admin) { await api({ action: "adminLogin", password: secret }); location.assign("/"); }
      else if (!course) await findCourse();
      else { await api({ action: "login", code, name: loginName, personalCode: secret }); location.assign("/"); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="school school-login"><header><Brand /><span className="school-pill"><ShieldCheck size={15} /> Dein eigener Klassenraum</span></header><div className="school-login-grid"><section className="school-intro"><div className="school-eyebrow">KLEINE IDEEN. GROSSE MÖGLICHKEITEN.</div><h1>Deine Ideen.<br />In einer neuen<br /><em>Dimension.</em></h1><p>Entwerfen, ausprobieren, weiterbauen.<br />Dein Platz für 3D – gemeinsam im Kurs.</p><div className="school-object-scene" aria-hidden="true"><div className="school-cube"><Box size={135} strokeWidth={1.2} /></div><div className="school-orbit"><span /><span /><span /></div><div className="school-scene-label"><span /> Platz für deinen nächsten Entwurf</div></div></section><section className="school-login-card"><div className="school-icon-tile">{admin ? <ShieldCheck /> : <GraduationCap />}</div><div className="school-eyebrow">{admin ? "FÜR LEHRKRÄFTE" : course ? course.name : "WILLKOMMEN BEI LAYERLING"}</div><h2>{admin ? "Kurse verwalten" : course ? "Wer bist du?" : "Dein Kurs wartet."}</h2><p>{admin ? "Melde dich an, um deine Kurse und Schülerzugänge zu verwalten." : course ? "Gib deinen Login-Namen ein. Dann kann es losgehen!" : "Gib den Klassencode ein, den du von deiner Lehrkraft bekommen hast."}</p><form onSubmit={submit}>{admin ? <label>Admin-Passwort<input type="password" value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="current-password" autoFocus /></label> : !course ? <label>Klassencode<input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="z. B. A2B3C4D5E6F7" maxLength={30} required autoFocus autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go" /></label> : <><label>Dein Login-Name<input value={loginName} onChange={e => setName(e.target.value)} placeholder="z. B. Ben" maxLength={80} required autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" /></label>{course.personalCodes && <label>Dein persönlicher Code<input type="password" value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="current-password" /></label>}</>}{error && <div className="school-error" role="alert">{error}</div>}<button className="school-primary" disabled={busy}>{busy ? "Einen Moment …" : admin ? "Anmelden" : course ? "Los geht’s" : "Kurs finden"}<ArrowRight size={18} /></button></form><div className="school-login-note"><ShieldCheck size={16} />{admin ? "Geschützter Bereich für die Lehrkraft" : "Deine Entwürfe bleiben auf unserem Server."}</div>{course && !admin && <button className="school-text-button" onClick={() => { setCourse(null); setError(""); setSecret(""); history.replaceState(null, "", "/"); }}><ChevronLeft size={16} /> Anderen Kurs wählen</button>}</section></div><footer><span>Ein Raum zum Lernen. Ein Platz für deine Ideen.</span><div><button className="school-text-button" onClick={() => { setAdmin(!admin); setError(""); setSecret(""); }}>{admin ? "Zur Schüler-Anmeldung" : "Anmeldung für Lehrkräfte"}</button><Source /></div></footer></main>;
}

function Admin({ onLogout }: { onLogout: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]); const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState(""); const [search, setSearch] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"course" | "student" | "settings" | null>(null); const [entryName, setEntryName] = useState(""); const [personalCodes, setPersonalCodes] = useState(false);
  const [designStudent, setDesignStudent] = useState<Student | null>(null); const [designs, setDesigns] = useState<Design[]>([]); const [target, setTarget] = useState("");
  const course = courses.find(c => c.id === selected);
  const courseStudents = students.filter(s => s.courseId === selected && s.name.toLowerCase().includes(search.toLowerCase()));
  async function refresh() {
    const response = await fetch("/api/classroom?admin=1", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setCourses(data.courses); setStudents(data.students); setSelected(prev => data.courses.some((c: Course) => c.id === prev) ? prev : data.courses[0]?.id ?? "");
  }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoaded(true)); }, []);
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try { const data = await api(body); await refresh(); return data; }
    catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  const invite = course ? `${location.origin}/?class=${course.code}` : "";
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} kopiert.`); } catch { setMessage(`${label}: ${value}`); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); const data = await act({ action: modal === "course" ? "createCourse" : modal === "settings" ? "updateCourse" : "createStudent", courseId: selected, name: entryName, personalCodes });
    if (!data) return;
    if (data.course) setSelected(data.course.id);
    if (data.personalCode) setMessage(`Zugang für ${entryName} erstellt. Persönlicher Code: ${data.personalCode}. ${course?.personalCodes ? "Bitte jetzt sicher weitergeben." : "Nur erforderlich, wenn persönliche Codes für diesen Kurs aktiviert werden."}`);
    setModal(null); setEntryName("");
  }
  async function showDesigns(student: Student) {
    setError(""); setDesignStudent(student); setDesigns([]); setTarget("");
    try {
      const response = await fetch("/api/shared-projects?all=1", { headers: { "x-layerling-student": student.id }, cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setDesigns(data.projects ?? []);
    } catch (e) { setError((e as Error).message); }
  }
  return <main className="school school-admin"><aside className="school-sidebar"><Brand /><div className="school-sidebar-label">DEIN ARBEITSBEREICH</div><div className="school-nav-active"><BookOpen size={18} /> Kursverwaltung</div><div className="school-sidebar-label school-course-heading">MEINE KURSE<button title="Kurs anlegen" aria-label="Kurs anlegen" onClick={() => { setEntryName(""); setPersonalCodes(false); setModal("course"); }}><Plus size={17} /></button></div><nav>{courses.map(c => <button key={c.id} className={c.id === selected ? "selected" : ""} onClick={() => { setSelected(c.id); setSearch(""); }}><span className="school-course-dot" />{c.name}<span>{students.filter(s => s.courseId === c.id).length}</span></button>)}</nav><div className="school-sidebar-bottom"><ShieldCheck size={20} /><div><strong>Lehrkraft</strong><small>Administrator</small></div><button onClick={onLogout} title="Abmelden" aria-label="Abmelden"><LogOut size={18} /></button></div></aside><div className="school-main"><header className="school-topbar"><span>Klassenzimmer <span>/</span> Kursverwaltung</span><span className="school-pill"><span className="school-online-dot" /> Server-Speicherung aktiv</span></header><div className="school-content"><div className="school-title-row"><div><div className="school-eyebrow">GEMEINSAM IDEEN FORMEN</div><h1>Deine Kurse</h1><p>Ein eigener Platz für jede Klasse. Und für jede Idee.</p></div><button className="school-primary" onClick={() => { setEntryName(""); setPersonalCodes(false); setModal("course"); }}><Plus size={18} /> Neuer Kurs</button></div><label className="school-mobile-course">Kurs auswählen<select aria-label="Kurs auswählen" value={selected} onChange={e => { setSelected(e.target.value); setSearch(""); }} disabled={!courses.length}><option value="" disabled>Bitte Kurs auswählen</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="school-stats"><div><span className="school-stat-icon"><BookOpen /></span><div><strong>{courses.length}</strong><span>Kurse</span></div></div><div><span className="school-stat-icon green"><Users /></span><div><strong>{students.length}</strong><span>Schülerzugänge</span></div></div><div><span className="school-stat-icon blue"><ShieldCheck /></span><div><strong>Getrennt & gespeichert</strong><span>Eigene Entwürfe für jeden Zugang</span></div></div></div>{error && <div className="school-error" role="alert">{error}</div>}{message && !designStudent && <div className="school-success" role="status"><Check size={18} /><span>{message}</span><button onClick={() => setMessage("")} aria-label="Hinweis schließen"><X size={16} /></button></div>}{!loaded ? <div className="school-empty">Kurse werden geladen …</div> : course ? <><section className="school-course-card"><div className="school-course-title"><div className="school-icon-tile"><BookOpen /></div><div><span className="school-eyebrow">AUSGEWÄHLTER KURS</span><h2>{course.name}</h2><span>{students.filter(s => s.courseId === selected).length} Schülerzugänge · {course.personalCodes ? "Mit persönlichem Code" : "Anmeldung mit Login-Namen"}</span></div><button className="school-outline" onClick={() => { setEntryName(course.name); setPersonalCodes(course.personalCodes); setModal("settings"); }}><Settings2 size={16} /> Einstellungen</button></div><div className="school-invitation"><div><span className="school-small-label">KLASSENCODE</span><button className="school-code" title="Klassencode kopieren" onClick={() => copy(course.code, "Klassencode")}>{course.code}<Copy size={15} /></button></div><div className="school-invitation-divider" /><div className="school-invite-text"><LinkIcon size={20} /><div><strong>Mit einem Link direkt in den Kurs</strong><p>Teile den Einladungslink. Die Kinder geben nur noch ihren Namen ein.</p></div></div><button className="school-outline" onClick={() => copy(invite, "Einladungslink")}><Copy size={16} /> Einladungslink kopieren</button></div></section><section className="school-student-section"><div className="school-section-head"><div><h2>Schülerzugänge <span>{students.filter(s => s.courseId === selected).length}</span></h2><p>Entwürfe ansehen, weitergeben und gemeinsam weiterdenken.</p></div><button className="school-primary" onClick={() => { setEntryName(""); setModal("student"); }}><Plus size={17} /> Zugang anlegen</button></div><input className="school-search" aria-label="Schülerzugänge suchen" placeholder="Login-Namen suchen …" value={search} onChange={e => setSearch(e.target.value)} /><div className="school-student-grid">{courseStudents.map((student, index) => <article className="school-student-card" key={student.id}><div className={`school-avatar color-${index % 4}`}>{student.name.slice(0, 2).toUpperCase()}</div><h3>{student.name}</h3><span>Eigener 3D-Arbeitsbereich</span><button className="school-outline" onClick={() => showDesigns(student)}><Box size={16} /> Entwürfe ansehen <ArrowRight size={15} /></button><div className="school-student-actions"><button title="Persönlichen Code neu erzeugen" onClick={async () => { const data = await act({ action: "resetStudentCode", studentId: student.id }); if (data) setMessage(`Neuer persönlicher Code für ${student.name}: ${data.personalCode}`); }} disabled={busy}><KeyRound size={14} /> Code erneuern</button><button aria-label={`${student.name} entfernen`} disabled={busy} onClick={async () => { if (confirm(`Zugang ${student.name} entfernen? Die Anmeldung wird gesperrt. Entwurfsdateien bleiben für eine Wiederherstellung im Backup erhalten.`)) await act({ action: "deleteStudent", studentId: student.id }); }}><Trash2 size={14} /></button></div></article>)}{!courseStudents.length && <div className="school-empty-inline">{search ? "Kein passender Login-Name gefunden." : "Hier ist Platz für deine Klasse. Lege den ersten Schülerzugang an."}</div>}</div></section></> : <div className="school-empty"><BookOpen size={40} /><h2>Dein erster Kurs beginnt hier.</h2><p>Lege einen Kurs an und füge die Login-Namen deiner Schüler hinzu.</p></div>}<div className="school-admin-footer"><span><ShieldCheck size={15} /> Entwürfe werden auf deinem Server gespeichert.</span><Source /></div></div></div>{modal && <div className="school-overlay"><section className="school-dialog" role="dialog" aria-modal="true" aria-labelledby="school-dialog-title"><button className="school-dialog-close" onClick={() => setModal(null)} aria-label="Schließen"><X /></button><div className="school-icon-tile">{modal === "student" ? <Users /> : <BookOpen />}</div><h2 id="school-dialog-title">{modal === "course" ? "Neuen Kurs anlegen" : modal === "student" ? "Schülerzugang anlegen" : "Kurseinstellungen"}</h2><form onSubmit={save}><label>{modal === "student" ? "Login-Name" : "Kursname"}<input value={entryName} onChange={e => setEntryName(e.target.value)} maxLength={80} required autoFocus placeholder={modal === "student" ? "z. B. Ben" : "z. B. 3D-Druck"} /></label>{modal !== "student" && <label className="school-checkbox"><input type="checkbox" checked={personalCodes} onChange={e => setPersonalCodes(e.target.checked)} /> Persönliche Schülercodes zusätzlich verlangen</label>}{error && <div className="school-error" role="alert">{error}</div>}<button className="school-primary" disabled={busy}>{busy ? "Wird gespeichert …" : "Speichern"}<Check size={17} /></button></form>{modal === "settings" && <div className="school-settings-actions"><button className="school-outline" disabled={busy} onClick={async () => { if (confirm("Klassencode erneuern? Bisherige Einladungslinks funktionieren danach nicht mehr. Bereits angemeldete Kinder bleiben bis zur Abmeldung angemeldet.")) { const data = await act({ action: "rotateCourse", courseId: selected }); if (data) { setModal(null); setMessage("Klassencode und Einladungslink wurden erneuert."); } } }}>Klassencode erneuern</button><button className="school-danger" disabled={busy} onClick={async () => { if (confirm("Leeren Kurs endgültig entfernen?")) { const data = await act({ action: "deleteCourse", courseId: selected }); if (data) setModal(null); } }}>Leeren Kurs entfernen</button></div>}</section></div>}{designStudent && <div className="school-overlay"><section className="school-dialog school-design-dialog" role="dialog" aria-modal="true" aria-labelledby="school-design-title"><button className="school-dialog-close" onClick={() => setDesignStudent(null)} aria-label="Schließen"><X /></button><div className="school-eyebrow">SCHÜLER-ARBEITSBEREICH</div><h2 id="school-design-title">Entwürfe von {designStudent.name}</h2><a className="school-primary" href={`/?student=${designStudent.id}`}>Arbeitsbereich öffnen <ArrowRight size={17} /></a><p>Dort kannst du Entwürfe öffnen, bearbeiten und Vorlagen erstellen.</p><label>Kopie weitergeben an<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Schülerzugang auswählen …</option>{courses.map(c => <optgroup label={c.name} key={c.id}>{students.filter(s => s.courseId === c.id && s.id !== designStudent.id).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</optgroup>)}</select></label>{error && <div className="school-error" role="alert">{error}</div>}{message && <div className="school-success" role="status">{message}</div>}<div className="school-design-list">{designs.map(design => <div key={`${design.path}/${design.fileName}`}><Box size={22} /><div><strong>{design.name}</strong><small>{design.path || "Entwürfe"}</small></div><button className="school-outline" disabled={!target || busy} onClick={async () => { const data = await act({ action: "copyDesign", from: designStudent.id, to: target, path: design.path, fileName: design.fileName }); if (data) setMessage(`„${design.name}“ wurde als eigenständige Kopie an ${students.find(s => s.id === target)?.name} weitergegeben.`); }}><Copy size={15} /> Kopieren</button></div>)}{!designs.length && <p>Noch keine Entwürfe auf dem Server.</p>}</div></section></div>}</main>;
}
