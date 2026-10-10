#!/usr/bin/env bash
#
# Truhenblick – Einrichtung auf einem Debian-/Ubuntu-System
#
# Wird vom Proxmox-Skript (install/proxmox-lxc.sh) im frisch erstellten Container
# aufgerufen und von truhenblick-update bei jedem Update erneut. Läuft auch direkt
# auf einem eigenen Server (als root):
#
#   git clone https://github.com/laserjonas/Truhenblick.git /opt/truhenblick/src
#   TB_SYNC=1 bash /opt/truhenblick/src/install/container-setup.sh
#
# Das Skript darf beliebig oft laufen: Vorhandene Einstellungen (Port, Token)
# und die Datenbank bleiben erhalten.
#
# Einstellungen (Umgebungsvariablen, sonst gespeicherte Werte, sonst Standard):
#   TB_PORT        Port der Web-App                         (80)
#   TB_SYNC        1 = Sync-Backend installieren, 0 = ohne  (0)
#   TB_SYNC_TOKEN  Zugangs-Token; leer = behalten bzw. neu erzeugen
#   TB_REPO        Git-Adresse der Quellen
#   TB_BRANCH      Zweig                                    (main)
#
# Aufruf mit --update: Systempakete werden nur ergänzt, wenn etwas fehlt.

set -Eeuo pipefail

REPO_STANDARD="https://github.com/laserjonas/Truhenblick.git"

QUELLE=/opt/truhenblick/src
APP=/opt/truhenblick/app
WEBROOT=/var/www/truhenblick
DATEN=/var/lib/truhenblick
ETC=/etc/truhenblick
KONF="$ETC/install.conf"
UEBERGABE="$ETC/install.env"
SERVER_ENV="$ETC/server.env"
DIENST=truhenblick-server
CADDYFILE=/etc/caddy/Caddyfile
CADDY_MARKE="# Truhenblick – automatisch erzeugt."
BACKEND_PORT=3000

MODUS=install
[[ "${1:-}" == "--update" ]] && MODUS=update

# ------------------------------------------------------------------ Ausgabe

if [[ -t 1 ]]; then
  FETT=$'\e[1m'; ROT=$'\e[31m'; GRUEN=$'\e[32m'; GELB=$'\e[33m'; AUS=$'\e[0m'
else
  FETT=""; ROT=""; GRUEN=""; GELB=""; AUS=""
fi

schritt() { printf '%s==>%s %s\n' "$FETT" "$AUS" "$*"; }
ok()      { printf '%s  ✓%s %s\n' "$GRUEN" "$AUS" "$*"; }
warnung() { printf '%s  !%s %s\n' "$GELB" "$AUS" "$*" >&2; }
abbruch() { printf '%sFehler:%s %s\n' "$ROT" "$AUS" "$*" >&2; exit 1; }

trap 'printf "%sFehler:%s Die Einrichtung ist in Zeile %s abgebrochen (Befehl: %s).\n" "$ROT" "$AUS" "$LINENO" "$BASH_COMMAND" >&2' ERR

# ------------------------------------------------------------------ Prüfungen

[[ $EUID -eq 0 ]] || abbruch "Bitte als root ausführen."
command -v apt-get >/dev/null || abbruch "Dieses Skript braucht ein Debian- oder Ubuntu-System (apt-get fehlt)."

# ------------------------------------------------------------------ Einstellungen

# Reihenfolge: Umgebung > Übergabedatei des Proxmox-Skripts > gespeicherte Werte > Standard
UMGEBUNG_PORT="${TB_PORT:-}"; UMGEBUNG_SYNC="${TB_SYNC:-}"; UMGEBUNG_TOKEN="${TB_SYNC_TOKEN:-}"
UMGEBUNG_REPO="${TB_REPO:-}"; UMGEBUNG_BRANCH="${TB_BRANCH:-}"

# shellcheck disable=SC1090
[[ -f "$KONF" ]] && . "$KONF"
if [[ -f "$UEBERGABE" ]]; then
  # shellcheck disable=SC1090
  . "$UEBERGABE"
  rm -f "$UEBERGABE"   # enthält das Token – nicht liegen lassen
fi

TB_PORT="${UMGEBUNG_PORT:-${TB_PORT:-80}}"
TB_SYNC="${UMGEBUNG_SYNC:-${TB_SYNC:-0}}"
TB_SYNC_TOKEN="${UMGEBUNG_TOKEN:-${TB_SYNC_TOKEN:-}}"
TB_REPO="${UMGEBUNG_REPO:-${TB_REPO:-$REPO_STANDARD}}"
TB_BRANCH="${UMGEBUNG_BRANCH:-${TB_BRANCH:-main}}"

[[ "$TB_PORT" =~ ^[0-9]+$ ]] && (( TB_PORT >= 1 && TB_PORT <= 65535 )) || abbruch "TB_PORT ist kein gültiger Port: $TB_PORT"
[[ "$TB_SYNC" == "0" || "$TB_SYNC" == "1" ]] || abbruch "TB_SYNC muss 0 oder 1 sein."
if [[ -n "$TB_SYNC_TOKEN" && ${#TB_SYNC_TOKEN} -lt 16 ]]; then
  abbruch "Das Zugangs-Token muss mindestens 16 Zeichen lang sein."
fi
[[ "$TB_SYNC_TOKEN" =~ ^[A-Za-z0-9._~+/=-]*$ ]] || abbruch "Das Zugangs-Token darf nur Buchstaben, Ziffern und . _ ~ + / = - enthalten."

# ------------------------------------------------------------------ Systempakete

node_passt() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'
}

pakete_installieren() {
  export DEBIAN_FRONTEND=noninteractive
  local pakete=(ca-certificates curl git rsync openssl sqlite3)
  local fehlend=()
  local p
  for p in "${pakete[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || fehlend+=("$p")
  done
  command -v caddy >/dev/null 2>&1 || fehlend+=(caddy)

  if [[ "$MODUS" == "update" && ${#fehlend[@]} -eq 0 ]] && node_passt; then
    ok "Systempakete sind vollständig"
    return
  fi

  schritt "Systempakete installieren"
  apt-get update -qq
  if [[ ${#fehlend[@]} -gt 0 ]]; then
    if ! apt-get install -y -qq --no-install-recommends "${fehlend[@]}"; then
      # Ältere Systeme führen Caddy nicht in den eigenen Paketquellen – dann die offizielle Quelle von Caddy nehmen.
      schritt "Caddy aus der offiziellen Paketquelle einrichten"
      apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq
      apt-get install -y -qq --no-install-recommends "${fehlend[@]}"
    fi
  fi
  ok "Pakete installiert"

  if ! node_passt; then
    schritt "Node.js 24 installieren"
    curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
    bash /tmp/nodesource_setup.sh >/dev/null
    rm -f /tmp/nodesource_setup.sh
    apt-get install -y -qq nodejs
    node_passt || abbruch "Node.js ist zu alt ($(node -v 2>/dev/null || echo 'nicht gefunden')) – benötigt wird 22.18 oder neuer."
  fi
  ok "Node.js $(node -v)"
}

# ------------------------------------------------------------------ Quellen und Build

quellen_holen() {
  if [[ -d "$QUELLE/.git" ]]; then
    return
  fi
  schritt "Quellen holen ($TB_REPO, Zweig $TB_BRANCH)"
  mkdir -p "$(dirname "$QUELLE")"
  git clone --quiet --depth 1 --branch "$TB_BRANCH" "$TB_REPO" "$QUELLE"
}

app_bauen() {
  schritt "Web-App bauen (das dauert ein bis zwei Minuten)"
  cd "$QUELLE"
  npm ci --no-audit --no-fund --loglevel=error
  # Nur bauen – die Typprüfung ist Sache der Entwicklung und spart hier Zeit und Speicher.
  npx vite build --logLevel warn
  [[ -f dist/index.html ]] || abbruch "Der Build hat keine dist/index.html erzeugt."

  mkdir -p "$WEBROOT"
  rsync -a --delete dist/ "$WEBROOT/"
  # npm ci räumt node_modules ohnehin jedes Mal ab – also nicht aufheben.
  rm -rf node_modules dist
  ok "Web-App liegt in $WEBROOT"
}

# ------------------------------------------------------------------ Sync-Backend

token_erzeugen() {
  openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

dienst_antwortet() {
  local i
  for i in $(seq 1 20); do
    curl -fsS -o /dev/null "http://127.0.0.1:${BACKEND_PORT}/api/health" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

backend_einrichten() {
  schritt "Sync-Backend einrichten"

  if ! id truhenblick >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$DATEN" --shell /usr/sbin/nologin truhenblick
  fi
  install -d -m 750 -o truhenblick -g truhenblick "$DATEN"
  install -d -m 750 -o root -g truhenblick "$ETC"

  # Erst vollständig bereitstellen, dann den Dienst neu starten – läuft bis dahin die alte Fassung weiter.
  mkdir -p "$APP/server" "$APP/shared"
  rsync -a --delete --exclude node_modules --exclude test --exclude data "$QUELLE/server/" "$APP/server/"
  rsync -a --delete --exclude '*.test.ts' "$QUELLE/shared/" "$APP/shared/"
  # --ignore-scripts: better-sqlite3 bringt fertige Binärdateien mit; ohne den Schalter
  # würde npm es neu kompilieren wollen, wofür im Container der Compiler fehlt.
  npm --prefix "$APP/server" ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
  if ! (cd "$APP/server" && node -e "new (require('better-sqlite3'))(':memory:').close()") 2>/dev/null; then
    abbruch "Die SQLite-Bibliothek lässt sich auf diesem System nicht laden (Architektur $(uname -m)). Unterstützt werden x86-64 und ARM64 (64 Bit)."
  fi

  # Token: neues übernehmen, sonst vorhandenes behalten, sonst erzeugen
  local token="$TB_SYNC_TOKEN"
  if [[ -z "$token" && -f "$SERVER_ENV" ]]; then
    token="$(sed -n 's/^SYNC_TOKEN=//p' "$SERVER_ENV" | head -n1)"
  fi
  if [[ -z "$token" ]]; then
    token="$(token_erzeugen)"
    TOKEN_NEU=1
  fi
  SYNC_TOKEN_AKTUELL="$token"

  local alt_umask
  alt_umask="$(umask)"
  umask 027
  cat >"$SERVER_ENV" <<EOF
# Einstellungen des Truhenblick-Sync-Backends.
# Nach Änderungen:  systemctl restart $DIENST
SYNC_TOKEN=$token
PORT=$BACKEND_PORT
HOST=127.0.0.1
DATA_DIR=$DATEN
EOF
  umask "$alt_umask"
  chown root:truhenblick "$SERVER_ENV"
  chmod 640 "$SERVER_ENV"

  cat >"/etc/systemd/system/$DIENST.service" <<EOF
[Unit]
Description=Truhenblick Sync-Backend
After=network.target

[Service]
Type=simple
User=truhenblick
Group=truhenblick
EnvironmentFile=$SERVER_ENV
WorkingDirectory=$APP
ExecStart=$(command -v node) server/src/index.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --quiet "$DIENST"
  systemctl restart "$DIENST"

  if ! dienst_antwortet; then
    # In manchen Containern (LXC ohne „nesting“) scheitert die Abschottung durch systemd – dann ohne sie.
    warnung "Der Dienst startet nicht – versuche es ohne die systemd-Abschottung."
    mkdir -p "/etc/systemd/system/$DIENST.service.d"
    cat >"/etc/systemd/system/$DIENST.service.d/ohne-abschottung.conf" <<EOF
[Service]
ProtectSystem=no
ProtectHome=no
PrivateTmp=no
EOF
    systemctl daemon-reload
    systemctl restart "$DIENST"
    if ! dienst_antwortet; then
      journalctl -u "$DIENST" -n 30 --no-pager >&2 || true
      abbruch "Das Sync-Backend startet nicht. Die Meldungen stehen oben (journalctl -u $DIENST)."
    fi
  fi
  ok "Sync-Backend läuft (Dienst $DIENST, Daten in $DATEN)"
}

backend_entfernen() {
  # Wurde ohne Sync installiert, darf kein alter Dienst weiterlaufen. Die Daten bleiben liegen.
  if [[ -f "/etc/systemd/system/$DIENST.service" ]]; then
    systemctl disable --now --quiet "$DIENST" 2>/dev/null || true
    rm -f "/etc/systemd/system/$DIENST.service"
    rm -rf "/etc/systemd/system/$DIENST.service.d"
    systemctl daemon-reload
    warnung "Sync-Backend abgeschaltet. Die Datenbank bleibt in $DATEN erhalten."
  fi
}

# ------------------------------------------------------------------ Webserver

caddy_einrichten() {
  schritt "Webserver (Caddy) einrichten"

  if [[ -f "$CADDYFILE" ]] && ! grep -qF "$CADDY_MARKE" "$CADDYFILE"; then
    if [[ "$MODUS" == "update" ]]; then
      warnung "$CADDYFILE wurde von Hand angepasst und bleibt unverändert."
      systemctl reload caddy 2>/dev/null || systemctl restart caddy
      return
    fi
    cp -a "$CADDYFILE" "$CADDYFILE.vor-truhenblick"
  fi

  local api
  if [[ "$TB_SYNC" == "1" ]]; then
    api="	handle /api/* {
		reverse_proxy 127.0.0.1:${BACKEND_PORT}
	}"
  else
    api="	# Ohne Sync-Backend installiert
	handle /api/* {
		respond \"Sync-Backend ist nicht installiert.\" 404
	}"
  fi

  cat >"$CADDYFILE" <<EOF
$CADDY_MARKE
# Diese Datei wird bei Updates neu geschrieben. Wer sie selbst pflegen möchte,
# entfernt die erste Zeile – dann lässt truhenblick-update sie in Ruhe.
#
# HTTPS: Ersetze ":${TB_PORT}" durch deine Domain (z. B. truhe.example.de), wenn dieser
# Rechner aus dem Internet über die Ports 80 und 443 erreichbar ist – Caddy holt
# sich das Zertifikat dann selbst. Sonst übernimmt das ein vorgeschalteter Reverse Proxy.

:${TB_PORT} {
	encode zstd gzip

	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}

$api

	handle {
		root * $WEBROOT

		# Einstiegsseite, Manifest und Service Worker immer neu prüfen, sonst kommen Updates nicht an.
		@frisch path / /index.html /sw.js /registerSW.js /manifest.webmanifest
		header @frisch Cache-Control "no-cache"

		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"

		try_files {path} /index.html
		file_server
	}
}
EOF

  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 ||
    abbruch "Die erzeugte Caddy-Konfiguration ist ungültig: caddy validate --config $CADDYFILE"
  systemctl enable --quiet caddy
  systemctl restart caddy
  ok "Caddy liefert die App auf Port $TB_PORT aus"
}

# ------------------------------------------------------------------ Abschluss

einstellungen_merken() {
  install -d -m 750 "$ETC"
  getent group truhenblick >/dev/null && chgrp truhenblick "$ETC"
  cat >"$KONF" <<EOF
# Von der Truhenblick-Einrichtung geschrieben; truhenblick-update liest diese Werte.
TB_PORT=$TB_PORT
TB_SYNC=$TB_SYNC
TB_REPO=$TB_REPO
TB_BRANCH=$TB_BRANCH
EOF
  chmod 644 "$KONF"
  git -C "$QUELLE" rev-parse HEAD >"$ETC/version" 2>/dev/null || true
}

werkzeuge_installieren() {
  install -m 755 "$QUELLE/install/truhenblick-update" /usr/local/bin/truhenblick-update
}

adresse() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$ip" ]] || ip="$(hostname)"
  if [[ "$TB_PORT" == "80" ]]; then printf 'http://%s' "$ip"; else printf 'http://%s:%s' "$ip" "$TB_PORT"; fi
}

TOKEN_NEU=0
SYNC_TOKEN_AKTUELL=""

pakete_installieren
quellen_holen
app_bauen
if [[ "$TB_SYNC" == "1" ]]; then backend_einrichten; else backend_entfernen; fi
caddy_einrichten
einstellungen_merken
werkzeuge_installieren

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$QUELLE/package.json" | head -n1)"
printf '\n%sTruhenblick %s ist eingerichtet.%s\n' "$FETT$GRUEN" "$VERSION" "$AUS"
printf '  Adresse:   %s\n' "$(adresse)"
if [[ "$TB_SYNC" == "1" ]]; then
  if [[ "$MODUS" == "install" || "$TOKEN_NEU" == "1" ]]; then
    printf '  Sync:      aktiv – Zugangs-Token: %s%s%s\n' "$FETT" "$SYNC_TOKEN_AKTUELL" "$AUS"
    printf '             (steht auch in %s)\n' "$SERVER_ENV"
  else
    printf '  Sync:      aktiv – Token unverändert (%s)\n' "$SERVER_ENV"
  fi
else
  printf '  Sync:      nicht installiert\n'
fi
printf '  Update:    truhenblick-update\n'
