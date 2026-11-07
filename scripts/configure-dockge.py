#!/usr/bin/env python3
"""Prepare Dockge's root .env, keeping existing credentials and the running data volume."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

class ConfigurationError(ValueError):
    pass


ENTRY = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


def entries(text):
    return {match.group(1): match.group(2) for line in text.splitlines()
            if (match := ENTRY.match(line))}


def put(text, key, value):
    result, found = [], False
    for line in text.splitlines():
        match = ENTRY.match(line)
        if match and match.group(1) == key:
            if not found:
                result.append(key + "=" + value)
                found = True
        else:
            result.append(line)
    if not found:
        result.append(key + "=" + value)
    return "\n".join(result) + "\n"


def docker(*args):
    result = subprocess.run(["docker", *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def existing_volume():
    filters = ["--filter", "label=com.docker.compose.project=layerling",
               "--filter", "label=com.docker.compose.service=layerling"]
    ids = docker("ps", "-q", *filters).split()
    if not ids:
        ids = docker("ps", "-aq", *filters).split()
    if not ids:
        return None
    if len(ids) != 1:
        raise ConfigurationError("Mehrere layerling-Container gefunden. Bitte die Datenspeicher vor der Umstellung prüfen.")
    # Inspect only mounts, never Config.Env (which contains credentials).
    mounts = json.loads(docker("inspect", "--format", "{{json .Mounts}}", ids[0]))
    stores = [m for m in mounts if m.get("Destination") == "/var/lib/layerling"]
    if len(stores) != 1 or stores[0].get("Type") != "volume" or not stores[0].get("Name"):
        raise ConfigurationError("Der laufende Container nutzt kein eindeutiges benanntes Datenvolume. Keine Konfiguration geändert; den bisherigen Datenspeicher zuerst zuordnen.")
    return stores[0]["Name"]


def configure(root, lan, volume):
    env = root / ".env"
    if env.is_symlink():
        raise ConfigurationError(".env ist ein symbolischer Link; bitte die bestehende Konfiguration manuell prüfen.")
    old = env.read_text() if env.exists() else ""
    result = old
    # Existing root values win; otherwise inherit the former CLI settings before applying defaults.
    for source in (root / "docker" / ".env.classroom", root / ".env.example"):
        if not source.exists():
            continue
        known = entries(result)
        for key, value in entries(source.read_text()).items():
            if key not in known:
                result = put(result, key, value)
                known[key] = value
    values = entries(result)
    configured = values.get("LAYERLING_DATA_VOLUME", "").strip().strip("\"'")
    if volume:
        # A pre-existing root setting is intentional. Never silently choose a different store.
        explicit = entries(old).get("LAYERLING_DATA_VOLUME", "").strip().strip("\"'")
        if explicit and explicit != volume:
            raise ConfigurationError("Das Datenvolume in .env unterscheidet sich vom laufenden Container. Keine Konfiguration geändert.")
        result = put(result, "LAYERLING_DATA_VOLUME", volume)
    elif not configured:
        result = put(result, "LAYERLING_DATA_VOLUME", "layerling_classroom-data")
    if lan:
        result = put(result, "LAYERLING_BIND_ADDRESS", "0.0.0.0")
        result = put(result, "LAYERLING_COOKIE_SECURE", "false")
        result = put(result, "LAYERLING_PORT", "4006")
    if result == old:
        os.chmod(env, 0o600)
        return
    if env.exists():
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = root / (".env.backup." + stamp)
        shutil.copy2(env, backup)
        os.chmod(backup, 0o600)
    filename = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=root, prefix=".env.backup.pending-", delete=False) as pending:
            filename = pending.name
            pending.write(result)
        os.chmod(filename, 0o600)
        os.replace(filename, env)
    finally:
        if filename and os.path.exists(filename):
            os.unlink(filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan", action="store_true", help="Enable direct LAN access on port 4006 (HTTP cookies).")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        volume = existing_volume()
        configure(root, args.lan, volume)
    except ConfigurationError as error:
        print("Dockge-Konfiguration nicht geändert: " + str(error))
        return 1
    except (OSError, ValueError, subprocess.CalledProcessError):
        # Do not print dotenv values, arbitrary file contents or captured subprocess output.
        print("Dockge-Konfiguration nicht geändert: Docker-Zugriff und eindeutiges Datenvolume prüfen; .env darf kein symbolischer Link sein und kein anderes Volume auswählen.")
        return 1
    print("Dockge-.env vorbereitet; vorhandene Werte und das bisherige Datenvolume wurden übernommen.")
    print("Das alte docker/.env.classroom bleibt erhalten. Vor dem Start das Admin-Passwort bei Bedarf lokal in .env prüfen (mindestens 12 Zeichen).")
    if args.lan:
        print("LAN-Zugriff: 0.0.0.0:4006; HTTP-Cookies aktiviert. Für Zugriff über das Internet HTTPS konfigurieren.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
