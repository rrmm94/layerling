# layerling für Klassen und Kurse

Die Erweiterung liegt im Branch `codex/classroom` dieses Forks.

Diese Fork-Erweiterung ergänzt den vorhandenen CAD-Editor um eine deutschsprachige Kursverwaltung für eine Lehrkraft. Sie benötigt den Node-Server; ein statischer Export mit PHP unterstützt den Kursmodus nicht.

## Ablauf

1. Lehrkraft: Auf der Startseite „Anmeldung für Lehrkräfte“ öffnen (oder `/?admin=1`) und mit dem Admin-Passwort anmelden.
2. „Neuer Kurs“ erstellt z. B. **3D-Druck**, einen zufälligen Klassencode und einen Einladungslink.
3. „Zugang anlegen“ erstellt die Login-Namen **Ben**, **Tim**, **Marie**. Namen müssen nur innerhalb desselben Kurses eindeutig sein. Pseudonyme sind möglich; E-Mail-Adressen werden nicht benötigt.
4. Kinder geben erst den Klassencode und dann ihren Login-Namen ein. Mit dem Einladungslink `/?class=…` ist der Kurs schon gewählt. Es gibt keine öffentliche Namensliste. Wer den Klassencode kennt, kann sich mit einem bekannten Namen des Kurses anmelden.
5. Optional pro Kurs „Persönliche Schülercodes zusätzlich verlangen“ aktivieren. Persönliche Codes werden bei Erstellung bzw. „Code erneuern“ nur einmal angezeigt und ausschließlich gehasht gespeichert. Vor Aktivierung allen Kindern einen aktuellen Code mitteilen.
6. Neue Entwürfe werden automatisch an den Server gebunden. Die vorhandene automatische Speicherung und Konflikterkennung bleiben erhalten. Bei Netzfehlern die angezeigte Speicherwarnung beachten und die Seite erst nach erfolgreichem Speichern schließen. Lokale Arbeitskopien dienen der Bearbeitung und Wiederherstellung; sie werden pro Zugang getrennt.
7. Lehrkraft: „Entwürfe ansehen“ listet auch Entwürfe in Unterordnern. „Arbeitsbereich öffnen“ öffnet den vollständigen Editor für diesen Schüler. Eine Vorlage lässt sich dort anlegen oder importieren. Im Dialog einen Zielzugang (auch eines anderen Kurses) wählen und „Kopieren“ drücken. Die Kopie wird separat gespeichert; spätere Änderungen verändern das Original nicht. Der neue Dateiname erhält einen zufälligen Kopie-Zusatz und überschreibt keinen vorhandenen Entwurf. Die Vorschau wird beim nächsten Öffnen neu erzeugt.

## Ubuntu mit Docker Compose

Voraussetzungen: Docker Engine mit Compose-Plugin, Git, ausreichend Platz für Entwürfe und Backups. Für den ersten Build sind Node-Abhängigkeiten und CAD-WASM-Dateien größer; etwa 4 GB freier Arbeitsspeicher sind empfehlenswert. Der laufende Einzelserver benötigt keine zusätzliche Datenbank.

```bash
git clone --branch codex/classroom https://github.com/rrmm94/layerling.git
cd layerling
cp docker/.env.classroom.example docker/.env.classroom
chmod 600 docker/.env.classroom
# Datei mit einem Editor öffnen: langes, eigenes Passwort und deine HTTPS-Adresse eintragen.
nano docker/.env.classroom

docker compose --env-file docker/.env.classroom -f docker/compose.classroom.yml up -d --build
docker compose --env-file docker/.env.classroom -f docker/compose.classroom.yml logs --tail=80
```

`docker/.env.classroom` ist von Git ausgeschlossen. Das Admin-Passwort muss mindestens 12 Zeichen enthalten und wird beim allerersten Login bzw. Kurszugriff als scrypt-Hash im Datenvolume initialisiert. Danach gilt der gespeicherte Hash; eine Änderung der Umgebungsvariable ersetzt ihn nicht. Zum kontrollierten Passwortwechsel den Dienst stoppen, das Volume sichern und das unten beschriebene Reset-Skript verwenden. Keine vordefinierten Konten oder Beispieldaten werden angelegt.

Der Compose-Aufbau baut diesen Fork lokal. Ein `ghcr.io/henmedia/layerling`-Image enthält die Erweiterung nicht. Der Source-Link muss auf den tatsächlich bereitgestellten Quellcode deiner angepassten Version verweisen.

### HTTPS

Standardmäßig ist Port 3000 nur am Ubuntu-Host erreichbar. Ein Reverse Proxy wie Caddy auf demselben Host kann ihn unter deiner Domain veröffentlichen:

```caddyfile
cad.deine-schule.example {
    reverse_proxy 127.0.0.1:3000
}
```

DNS, Caddy und dessen HTTPS-Zertifikat auf deinem Server einrichten. In `docker/.env.classroom` `LAYERLING_ALLOWED_ORIGINS=https://cad.deine-schule.example` setzen. Host und Forwarding-Header korrekt weiterreichen. Bei einem Reverse Proxy in einem anderen Container dessen Docker-Netzwerk verwenden; dessen `127.0.0.1` ist nicht der Ubuntu-Host.

Für einen reinen HTTP-Test im vertrauenswürdigen LAN `LAYERLING_BIND_ADDRESS=0.0.0.0` und `LAYERLING_COOKIE_SECURE=false` setzen und erneut `up -d` ausführen. Für Zugriff über das Internet HTTPS und `LAYERLING_COOKIE_SECURE=true` verwenden. Secure-Cookies werden über gewöhnliches LAN-HTTP nicht gesendet.

### Daten, Backups und Updates

Das benannte Volume `<compose-projekt>_classroom-data` enthält:

- `classroom.json`: Kurse, Login-Namen und Passwort-/Code-Hashes;
- `projects/<zufällige-schüler-id>/`: Entwürfe und Vorschauen, außerhalb des öffentlich ausgelieferten Verzeichnisses;
- `sessions/`: gehashte Sitzungstoken, 12 Stunden Laufzeit.

Den Dienst für ein konsistentes Backup kurz stoppen und das **gesamte Volume** sichern; anschließend wieder starten. Regelmäßig eine Wiederherstellung in ein separates Volume testen. `down -v` löscht die Daten! Ein entferntes Schülerkonto kann sich nicht mehr anmelden, seine Entwurfsdateien bleiben für eine bewusste spätere Bereinigung oder Wiederherstellung erhalten. Das erneute Anlegen desselben Namens erstellt einen neuen, leeren Zugang.

Updates: zuerst Backup erstellen, dann Änderungen aus deinem Fork übernehmen und denselben `up -d --build`-Befehl ausführen. Das Datenvolume bleibt erhalten. Es wird genau eine Serverinstanz mit lokalem Volume unterstützt. Bei einem harten Absturz während einer Verwaltungsänderung kann `.lock` im Volume zurückbleiben: nur bei gestopptem Dienst nach einem Backup entfernen. Entwurfsdateien nutzen zusätzlich die vorhandene atomare Speicherung und Versionsprüfung.

### Admin-Passwort zurücksetzen

Dienst stoppen und Volume sichern. Dann mit dem untenstehenden Skript auf dem Host einen neuen scrypt-Hash erzeugen und atomar in der vorhandenen Datenbank speichern. Das Skript liest das neue Passwort verdeckt über die Terminaleingabe, verlangt mindestens 12 Zeichen und entfernt bestehende Sitzungen. Node.js 22.18+ auf dem Host ist dafür erforderlich; der Dienst muss währenddessen gestoppt bleiben:

```bash
# Den tatsächlichen Mountpoint zeigt docker volume inspect <projekt>_classroom-data.
# Auf dem Ubuntu-Host mit Zugriff auf dieses Volume:
sudo node scripts/reset-classroom-admin.mjs /var/lib/docker/volumes/<projekt>_classroom-data/_data
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
