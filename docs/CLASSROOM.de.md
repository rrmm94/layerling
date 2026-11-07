# layerling für Klassen und Kurse

Die Erweiterung ist im Branch `main` dieses Forks enthalten.

Diese Fork-Erweiterung ergänzt den vorhandenen CAD-Editor um eine deutschsprachige Kursverwaltung für eine Lehrkraft. Sie benötigt den Node-Server; ein statischer Export mit PHP unterstützt den Kursmodus nicht.

## Ablauf

1. Lehrkraft: Auf der Startseite „Anmeldung für Lehrkräfte“ öffnen (oder `/?admin=1`) und mit dem Admin-Passwort anmelden.
2. „Neuer Kurs“ erstellt z. B. **3D-Druck**, einen zufälligen Klassencode und einen Einladungslink.
3. „Zugang anlegen“ erstellt die Login-Namen **Ben**, **Tim**, **Marie**. Namen müssen nur innerhalb desselben Kurses eindeutig sein. Pseudonyme sind möglich; E-Mail-Adressen werden nicht benötigt.
4. Kinder geben erst den Klassencode und dann ihren Login-Namen ein. Mit dem Einladungslink `/?class=…` ist der Kurs schon gewählt. Es gibt keine öffentliche Namensliste. Wer den Klassencode kennt, kann sich mit einem bekannten Namen des Kurses anmelden.
5. Optional pro Kurs „Persönliche Schülercodes zusätzlich verlangen“ aktivieren. Persönliche Codes werden bei Erstellung bzw. „Code erneuern“ nur einmal angezeigt und ausschließlich gehasht gespeichert. Vor Aktivierung allen Kindern einen aktuellen Code mitteilen.
6. Neue Entwürfe werden automatisch an den Server gebunden. Die vorhandene automatische Speicherung und Konflikterkennung bleiben erhalten. Bei Netzfehlern die angezeigte Speicherwarnung beachten und die Seite erst nach erfolgreichem Speichern schließen. Beim Abmelden wartet die Anwendung auf ausstehende Speicherungen. Bei einem Speicherfehler bleibt der Editor geöffnet und der Zugang angemeldet. Lokale Arbeitskopien dienen der Bearbeitung und Wiederherstellung; sie werden pro Zugang getrennt.
7. Lehrkraft: „Entwürfe ansehen“ listet auch Entwürfe in Unterordnern. „Arbeitsbereich öffnen“ öffnet den vollständigen Editor für diesen Schüler. Eine Vorlage lässt sich dort anlegen oder importieren. Im Dialog einen Zielzugang (auch eines anderen Kurses) wählen und „Kopieren“ drücken. Die Kopie wird separat gespeichert; spätere Änderungen verändern das Original nicht. Der neue Dateiname erhält einen zufälligen Kopie-Zusatz und überschreibt keinen vorhandenen Entwurf. Die Vorschau wird beim nächsten Öffnen neu erzeugt.

## Ubuntu mit Docker Compose

Voraussetzungen: Docker Engine mit Compose-Plugin, Git, ausreichend Platz für Entwürfe und Backups. Für den ersten Build sind Node-Abhängigkeiten und CAD-WASM-Dateien größer; etwa 4 GB freier Arbeitsspeicher sind empfehlenswert. Der laufende Einzelserver benötigt keine zusätzliche Datenbank.

Der Stack ist für Dockge unter `/opt/stacks/layerling` vorbereitet. Dockge liest die **`compose.yaml` im Hauptordner** und die dortige **`.env`** automatisch. Der Compose-Projektname bleibt `layerling`, der Host-Port ist `4006`, der interne Container-Port `3000`. Die Befehle benötigen Schreibrechte unter `/opt/stacks` und Zugriff auf Docker (gegebenenfalls mit `sudo` ausführen).

```bash
mkdir -p /opt/stacks
git clone --branch main https://github.com/rrmm94/layerling.git /opt/stacks/layerling
cd /opt/stacks/layerling
python3 scripts/configure-dockge.py --lan
# Eigenes Admin-Passwort mit 12 bis 200 Zeichen eintragen:
nano .env

docker compose up -d --build
docker compose ps
```

Danach in Dockge die Stacks neu einlesen/Ansicht aktualisieren und `http://<Ubuntu-Server-IP>:4006` öffnen. Die `.env` kann anschließend auch über Dockge verwaltet werden. `configure-dockge.py` benötigt Python 3 (auf Ubuntu üblicherweise vorhanden), erzeugt private Dateien mit Modus `600` und gibt keine Passwortwerte aus.

Das Admin-Passwort wird beim ersten Start der Kursverwaltung als scrypt-Hash im Datenvolume initialisiert. Danach gilt der gespeicherte Hash; eine Änderung der Umgebungsvariable ersetzt ihn nicht. Zum kontrollierten Passwortwechsel den Dienst stoppen, das Volume sichern und das unten beschriebene Reset-Skript verwenden. Keine vordefinierten Konten oder Beispieldaten werden angelegt.

### Vorhandene Installation aus `docker/compose.classroom.yml` übernehmen

Die ältere CLI-Anleitung verwendete eine Compose-Datei und `.env.classroom` im Unterordner `docker`. Dockge zeigt diese Datei nicht automatisch als Stack-Konfiguration an. Auch die frühere Bindung an `127.0.0.1` erlaubt keinen direkten Zugriff von einem anderen Rechner oder iPad.

```bash
cd /opt/stacks/layerling
git pull --ff-only
python3 scripts/configure-dockge.py --lan
# Bei Bedarf das Admin-Passwort lokal prüfen; keine Werte in Chats kopieren:
nano .env
docker compose up -d --build
docker compose ps
```

Die Umstellung übernimmt bestehende Werte aus `docker/.env.classroom`, soweit sie in der Root-`.env` noch nicht gesetzt sind. Die alte Datei bleibt unverändert. Vor einer Änderung einer bereits vorhandenen Root-`.env` entsteht eine private `.env.backup.<Zeitstempel>`. Die Sicherungen sind von Git und vom Docker-Build ausgeschlossen.

Das Skript ermittelt das bisherige benannte Datenvolume des vorhandenen `layerling`-Containers und trägt es als `LAYERLING_DATA_VOLUME` ein. Bei mehrdeutigen Containern, einem Bind-Mount oder einer widersprüchlichen expliziten Volume-Einstellung bricht es vor einer Änderung ab. So wird ein vorhandener Datenspeicher nicht durch einen leeren ersetzt. `up -d --build` erstellt den Container mit den neuen Ports und Cookie-Einstellungen neu; ein bloßes `restart` übernimmt diese Änderungen nicht.

Die alte Compose-Datei bleibt für bestehende CLI-Abläufe verfügbar. Für Dockge ab jetzt die Root-`compose.yaml` und Root-`.env` verwenden.

### Wenn der Dienst als „unhealthy“ erscheint

Die Startseite allein kann HTTP 200 liefern, obwohl die Kursverwaltung noch nicht bereit ist. Lokal auf dem Ubuntu-Server prüfen:

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:4006/api/classroom
docker compose ps
docker compose logs --tail=80
```

Bei fehlendem oder zu kurzem Admin-Passwort nennt die API die Voraussetzung. Das Passwort in `.env` lokal auf 12 bis 200 Zeichen setzen und `docker compose up -d` ausführen. Das Beispiel `REPLACE_WITH_A_LONG_RANDOM_PASSWORD` ist ausdrücklich kein gültiges Startpasswort. Bei HTTP 500 den konkreten Serverfehler in den Logs prüfen; Volumes und Kursdaten dafür nicht löschen. Der Healthcheck prüft weiter die Kurs-API und meldet künftig deren HTTP-Status und Fehlermeldung.

### HTTPS

Die Root-Konfiguration startet mit direktem **LAN-Zugriff auf Port 4006** und HTTP-Cookies. Für eine öffentliche Adresse mit HTTPS hinter einem Reverse Proxy stattdessen in `.env` setzen:

```ini
LAYERLING_BIND_ADDRESS=127.0.0.1
LAYERLING_COOKIE_SECURE=true
LAYERLING_ALLOWED_ORIGINS=https://cad.deine-schule.example
```

Ein Caddy auf demselben Ubuntu-Host kann dann weiterleiten:

```caddyfile
cad.deine-schule.example {
    reverse_proxy 127.0.0.1:4006
}
```

Nach einer Änderung `docker compose up -d` ausführen. Host und Forwarding-Header korrekt weiterreichen. Bei einem Reverse Proxy in einem anderen Container dessen Docker-Netzwerk verwenden; dessen `127.0.0.1` ist nicht der Ubuntu-Host. Secure-Cookies werden über gewöhnliches LAN-HTTP nicht gesendet.

### Daten, Backups und Updates

Das benannte Volume `layerling_classroom-data` (bei einer übernommenen Installation das in `.env` festgehaltene `LAYERLING_DATA_VOLUME`) enthält:

- `classroom.json`: Kurse, Login-Namen und Passwort-/Code-Hashes;
- `projects/<zufällige-schüler-id>/`: Entwürfe und Vorschauen, außerhalb des öffentlich ausgelieferten Verzeichnisses;
- `sessions/`: gehashte Sitzungstoken, 12 Stunden Laufzeit.

Den Dienst für ein konsistentes Backup kurz stoppen und das **gesamte Volume** sichern; anschließend wieder starten. Regelmäßig eine Wiederherstellung in ein separates Volume testen. `down -v` löscht die Daten! Ein entferntes Schülerkonto kann sich nicht mehr anmelden, seine Entwurfsdateien bleiben für eine bewusste spätere Bereinigung oder Wiederherstellung erhalten. Das erneute Anlegen desselben Namens erstellt einen neuen, leeren Zugang.

Updates: zuerst Backup erstellen, dann Änderungen aus deinem Fork übernehmen und denselben `up -d --build`-Befehl ausführen. Das Datenvolume bleibt erhalten. Es wird genau eine Serverinstanz mit lokalem Volume unterstützt. Bei einem harten Absturz während einer Verwaltungsänderung kann `.lock` im Volume zurückbleiben: nur bei gestopptem Dienst nach einem Backup entfernen. Entwurfsdateien nutzen zusätzlich die vorhandene atomare Speicherung und Versionsprüfung.

### Admin-Passwort zurücksetzen

Dienst stoppen und Volume sichern. Dann mit dem untenstehenden Skript auf dem Host einen neuen scrypt-Hash erzeugen und atomar in der vorhandenen Datenbank speichern. Das Skript liest das neue Passwort verdeckt über die Terminaleingabe, verlangt mindestens 12 Zeichen und entfernt bestehende Sitzungen. Node.js 22.18+ auf dem Host ist dafür erforderlich; der Dienst muss währenddessen gestoppt bleiben:

```bash
# Den tatsächlichen Mountpoint zeigt docker volume inspect layerling_classroom-data.
# Auf dem Ubuntu-Host mit Zugriff auf dieses Volume:
sudo node scripts/reset-classroom-admin.mjs /var/lib/docker/volumes/layerling_classroom-data/_data
# Anschließend Compose wieder starten; das gespeicherte Passwort gilt sofort.
```

## Entwicklung und Prüfungen

Node.js 22.18+ (24 empfohlen), `npm ci`, `npm run dev`. Kursmodus einschalten mit `LAYERLING_CLASSROOM=true`, `LAYERLING_CLASSROOM_DATA_DIR=<absoluter, nicht öffentlicher Ordner>` und beim ersten Start entweder `LAYERLING_ADMIN_PASSWORD` oder `LAYERLING_ADMIN_PASSWORD_FILE` (Dateipfad). Keine echten Passwörter committen. Für lokale Entwicklung ohne HTTPS `LAYERLING_COOKIE_SECURE=false`.

```bash
npm run typecheck
npm test -- tests/unit/classroom.test.ts tests/unit/classroomClient.test.ts
npm run build
npm start
```

Sitzungen verwenden HttpOnly-/SameSite-Cookies, Schreibzugriffe prüfen die Herkunft, und Anmeldeversuche sind begrenzt. Im Kursmodus werden die bisherige Header-Authentifizierung und der ungetrennte gemeinsame Speicher nicht verwendet. Die globale MCP-Steuerung ist deaktiviert, damit keine fremden Editorinhalte darüber zugänglich werden. Das Login-Modell mit Namen ist bewusst einfach; persönliche Codes sind bei Bedarf zuschaltbar. Anmeldebegrenzungen sind für eine einzelne Instanz ausgelegt und werden bei Serverneustart zurückgesetzt.

## Screenshots

Die Bilder in [screenshots/classroom](screenshots/classroom) zeigen ausschließlich lokale Beispieldaten, keine produktiven Schülerzugänge: [Anmeldung](screenshots/classroom/01-anmeldung.png), [Kursverwaltung](screenshots/classroom/02-kursverwaltung.png), [Einladungslink](screenshots/classroom/03-einladungslink.png), [Editor](screenshots/classroom/04-schueler-editor.png), [Entwurf weitergeben](screenshots/classroom/05-entwurf-weitergeben.png).

## Nutzung auf dem iPad

Die Kursoberfläche unterstützt Hoch- und Querformat sowie die geteilte Ansicht. Bei schmalem Fenster erscheint **Kurs auswählen** oberhalb der Übersicht. Eingabefelder verwenden auf Touch-Geräten mindestens 16 Pixel Schrift, Schaltflächen mindestens 44 Pixel große Trefferflächen. Die Anmeldung und Verwaltungsdialoge berücksichtigen die sichtbare Safari-Fläche, wenn die Bildschirmtastatur geöffnet ist.

Im Editor:

- Eine Form antippen und anschließend auf die Arbeitsebene tippen, um sie abzulegen.
- Einen Finger über die leere Arbeitsebene ziehen, um die Ansicht zu drehen. Zwei Finger zoomen und verschieben die Ansicht.
- Zum Mehrfachauswählen einen Körper antippen und den dann angezeigten Mehrfachauswahl-Knopf verwenden. Ein langer Druck öffnet das Kontextmenü.
- Die linke Ansichtsleiste lässt sich auf niedrigen Bildschirmen mit dem Finger scrollen. Ihr oberer Griff klappt sie ein und verschiebt sie.
- Im Hochformat bleibt der Entwurfsname in einer eigenen Zeile sichtbar. Wenn Werkzeuge umbrechen, beginnt die Arbeitsebene unter der gesamten Werkzeugleiste.
- Den vereinfachten Modus aus der Compose-Konfiguration für jüngere Kinder beibehalten. Bei sehr großen importierten Modellen hängt die Leistung auch vom Arbeitsspeicher des iPads ab.

Safari → Teilen → **Zum Home-Bildschirm** bietet mehr Platz ohne die normale Browserleiste. Der Klassenbetrieb mit Anmeldung und Server-Speicherung benötigt weiterhin eine Verbindung zum eigenen Server. Verwende für den Zugriff von anderen Geräten die HTTPS-Adresse des Servers.

### Wiederholbare Touch-Prüfung

Playwright ist eine reine Entwicklungsabhängigkeit. Gegen eine **lokale Testinstanz** mit aktivem Kursmodus:

```bash
npm ci
npx playwright install chromium
# In einem zweiten Terminal die Testinstanz mit den unter „Entwicklung“ beschriebenen Einstellungen starten.
# Das Test-Admin-Passwort wird aus einer lokalen Datei gelesen, nicht als Argument übergeben:
LAYERLING_TEST_ADMIN_PASSWORD_FILE=/absoluter/pfad/test-admin-password npm run test:ipad
```

Standardadresse ist `http://127.0.0.1:3000`; `LAYERLING_TEST_URL` erlaubt einen anderen lokalen Port. Mit `LAYERLING_TEST_CHROMIUM=/usr/bin/chromium` kann ein bereits installiertes Chromium verwendet werden. Screenshots landen in `test-results/ipad`; `LAYERLING_TEST_SCREENSHOTS` wählt einen anderen Ausgabeordner. Die Prüfung legt eigene Testkurse und Zugänge an und entfernt diese am Ende. Ihre Entwurfsdateien verbleiben gemäß der allgemeinen Löschregel im Test-Datenordner. Nicht gegen produktive Schülerdaten ausführen.

Geprüft werden Touch-Ereignisse in 768×1024, 1024×700 (Querformat mit Browserleisten), 744×1133 und 507×768 (geteilte Ansicht), Anmeldung, Kursauswahl, Dialoge bei verkleinertem sichtbarem Bereich, Finger-Platzierung, Ein-Finger-Drehung, Zwei-Finger-Zoom, serverseitige CAD-Speicherung, Abmelden und das Weitergeben einer Kopie. Der Tastaturfall modelliert `visualViewport`, ohne eine echte iPad-Tastatur zu behaupten.

Diese Prüfung verwendet Chromium mit Touch- und iPad-Abmessungen. Sie ersetzt keinen Test auf einem echten iPad mit Safari oder Apple Pencil. Ein zusätzlicher WebKit-Test konnte in der Cloud-Umgebung wegen gesperrter Browser-Download-Domains nicht ausgeführt werden.

[Beispielbilder der iPad-Oberfläche](screenshots/classroom-ipad) zeigen lokale, bereits entfernte Testzugänge. Das Eigenschaftenfenster rechts kann bei wenig Platz eingeklappt oder an seinem Kopfbereich verschoben werden.
