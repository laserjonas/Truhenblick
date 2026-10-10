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
#   TB_SYNC_TOKEN  freiwillig: Zugangscode der ersten Truhe (sonst entsteht er in der App)
#   TB_REPO        Git-Adresse der Quellen
#   TB_BRANCH      Zweig                                    (main)
#   TB_APP_UPDATE  1 = Updates lassen sich in der App anstoßen, 0 = nur von Hand (1)
#   TB_HTTPS       1 = Port 443 bereithalten, damit Truhenblick auf Wunsch selbst ein
#                  Zertifikat holt (einzustellen in der App), 0 = nur der Port oben  (1)
#
# Unter welcher Adresse der Server erreichbar ist, ob ein Reverse Proxy davor sitzt und ob man sich
# mit einem Passwort anmelden muss, wird nicht hier eingestellt, sondern in der App:
# Einstellungen → Server.
#
# Aufruf mit --update: Systempakete werden nur ergänzt, wenn etwas fehlt.

set -Eeuo pipefail

# Auch mit knapper Umgebung (pct exec, cron) alle üblichen Verzeichnisse durchsuchen
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"

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
STATUS_VERZEICHNIS=/var/lib/truhenblick-update
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
UMGEBUNG_REPO="${TB_REPO:-}"; UMGEBUNG_BRANCH="${TB_BRANCH:-}"; UMGEBUNG_APP_UPDATE="${TB_APP_UPDATE:-}"
UMGEBUNG_HTTPS="${TB_HTTPS:-}"

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
TB_APP_UPDATE="${UMGEBUNG_APP_UPDATE:-${TB_APP_UPDATE:-1}}"
TB_HTTPS="${UMGEBUNG_HTTPS:-${TB_HTTPS:-1}}"

[[ "$TB_PORT" =~ ^[0-9]+$ ]] && (( TB_PORT >= 1 && TB_PORT <= 65535 )) || abbruch "TB_PORT ist kein gültiger Port: $TB_PORT"
[[ "$TB_SYNC" == "0" || "$TB_SYNC" == "1" ]] || abbruch "TB_SYNC muss 0 oder 1 sein."
[[ "$TB_APP_UPDATE" == "0" || "$TB_APP_UPDATE" == "1" ]] || abbruch "TB_APP_UPDATE muss 0 oder 1 sein."
[[ "$TB_HTTPS" == "0" || "$TB_HTTPS" == "1" ]] || abbruch "TB_HTTPS muss 0 oder 1 sein."
if [[ -n "$TB_SYNC_TOKEN" && ${#TB_SYNC_TOKEN} -lt 16 ]]; then
  abbruch "Der Zugangscode muss mindestens 16 Zeichen lang sein."
fi
[[ "$TB_SYNC_TOKEN" =~ ^[A-Za-z0-9._~+/=-]*$ ]] || abbruch "Der Zugangscode darf nur Buchstaben, Ziffern und . _ ~ + / = - enthalten."

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
  schritt "Web-App bauen (das kann ein, zwei Minuten dauern)"
  cd "$QUELLE"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
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

# Liest einen Wert aus der vorhandenen server.env (leer, wenn es Datei oder Eintrag nicht gibt).
aus_server_env() {
  [[ -f "$SERVER_ENV" ]] || return 0
  sed -n "s/^$1=//p" "$SERVER_ENV" | head -n1
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
  npm --prefix "$APP/server" ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null
  if ! (cd "$APP/server" && node -e "new (require('better-sqlite3'))(':memory:').close()") 2>/dev/null; then
    abbruch "Die SQLite-Bibliothek lässt sich auf diesem System nicht laden (Architektur $(uname -m)). Unterstützt werden x86-64 und ARM64 (64 Bit)."
  fi

  # Zugangscodes entstehen beim Anlegen einer Truhe in der App – hier wird keiner erzeugt.
  # SYNC_TOKEN ist freiwillig (Code der ersten Truhe): ein übergebener gilt, ein vorhandener bleibt.
  local token="$TB_SYNC_TOKEN"
  [[ -n "$token" ]] && TOKEN_NEU=1
  [[ -z "$token" ]] && token="$(aus_server_env SYNC_TOKEN)"
  SYNC_TOKEN_AKTUELL="$token"
  # Eigene Einstellungen in der Datei über Updates hinweg erhalten
  local neue_truhen max_truhen start_adresse start_art
  neue_truhen="$(aus_server_env NEUE_TRUHEN)"
  max_truhen="$(aus_server_env MAX_TRUHEN)"
  # Aus einer früheren Caddy-Datei übernommen (siehe caddy_altlast_pruefen) – sonst, was schon dasteht
  start_adresse="${ALT_ADRESSE:-$(aus_server_env START_ADRESSE)}"
  start_art="${ALT_ERREICHBARKEIT:-$(aus_server_env START_ERREICHBARKEIT)}"

  local alt_umask
  alt_umask="$(umask)"
  umask 027
  cat >"$SERVER_ENV" <<EOF
# Einstellungen des Truhenblick-Sync-Backends.
# Nach Änderungen:  systemctl restart $DIENST

# Dürfen in der App neue Truhen angelegt werden? (an/aus) Vorhandene bleiben in jedem Fall nutzbar.
NEUE_TRUHEN=${neue_truhen:-an}
# Höchstzahl der Truhen auf diesem Server
MAX_TRUHEN=${max_truhen:-10}

# Freiwillig: Zugangscode der zuerst angelegten Truhe (mindestens 16 Zeichen). Einen neuen Wert
# eintragen, um ihn zurückzusetzen, wenn kein Gerät den Code mehr kennt.
SYNC_TOKEN=$token

# Adresse (z. B. truhe.example.de), Reverse Proxy und Passwort werden in der App eingestellt:
# Einstellungen → Server. Die beiden Werte hier gelten nur, solange dort noch nichts eingestellt wurde.
START_ADRESSE=$start_adresse
START_ERREICHBARKEIT=$start_art

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

# Updates aus der App: Das Backend (ohne besondere Rechte) legt nur eine Anfragedatei in
# sein Datenverzeichnis. Die .path-Unit bemerkt sie und startet als root den Dienst unten –
# immer denselben Befehl. Die Anfrage selbst wird nie gelesen, nur gelöscht.
update_aus_app_einrichten() {
  # Fortschritt und Protokoll: gehören root, das Backend liest nur mit (über seine Gruppe).
  install -d -m 750 -o root -g truhenblick "$STATUS_VERZEICHNIS"

  cat >/etc/systemd/system/truhenblick-update.service <<EOF
[Unit]
Description=Truhenblick aktualisieren (aus der App angestoßen)
After=network-online.target

[Service]
Type=oneshot
Environment=HOME=/root
# Erst die Markierung „läuft“ setzen, dann die Anfrage entfernen: So ist für das Backend lückenlos
# sichtbar, dass ein Update unterwegs ist, und ein zweites Anstoßen wird nicht angenommen. Ohne das
# Entfernen würde die .path-Unit den Dienst immer wieder starten.
ExecStartPre=/bin/sh -c 'touch $STATUS_VERZEICHNIS/laeuft; rm -f $DATEN/update-anfrage'
ExecStart=/usr/local/bin/truhenblick-update --aus-app
# Läuft auch, wenn das Skript abbricht.
ExecStopPost=/bin/rm -f $STATUS_VERZEICHNIS/laeuft
TimeoutStartSec=30min
EOF

  cat >/etc/systemd/system/truhenblick-update.path <<EOF
[Unit]
Description=Truhenblick: Update-Anfragen aus der App

[Path]
PathExists=$DATEN/update-anfrage
Unit=truhenblick-update.service

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --quiet --now truhenblick-update.path
  ok "Updates lassen sich in der App anstoßen (abschalten: TB_APP_UPDATE=0 in $KONF)"
}

update_aus_app_entfernen() {
  if [[ -f /etc/systemd/system/truhenblick-update.path ]]; then
    systemctl disable --now --quiet truhenblick-update.path 2>/dev/null || true
    rm -f /etc/systemd/system/truhenblick-update.path /etc/systemd/system/truhenblick-update.service
    systemctl daemon-reload
  fi
  # Ohne das Verzeichnis meldet das Backend der App, dass hier nur von Hand aktualisiert wird.
  rm -rf "$STATUS_VERZEICHNIS"
  rm -f "$DATEN/update-anfrage"
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

# Die Datei ohne Kommentare, Leerzeilen und Einrückung – zum Vergleichen.
caddy_kern() {
  sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^#/d' -e '/^$/d' "$1"
}

# So sah die Datei bis Version 0.4 aus (ohne die erste Zeile mit der Adresse). $1: mit Sync-Backend?
caddy_kern_alt() {
  printf '%s\n' 'encode zstd gzip' 'header {' 'X-Content-Type-Options nosniff' 'Referrer-Policy no-referrer' '-Server' '}' 'handle /api/* {'
  if [[ "$1" == "1" ]]; then
    printf '%s\n' "reverse_proxy 127.0.0.1:${BACKEND_PORT}"
  else
    printf '%s\n' 'respond "Sync-Backend ist nicht installiert." 404'
  fi
  printf '%s\n' '}' 'handle {' "root * $WEBROOT" \
    '@frisch path / /index.html /sw.js /registerSW.js /manifest.webmanifest' 'header @frisch Cache-Control "no-cache"' \
    '@assets path /assets/*' 'header @assets Cache-Control "public, max-age=31536000, immutable"' \
    'try_files {path} /index.html' 'file_server' '}' '}'
}

# Bis Version 0.4 riet die Anleitung, für eigenes HTTPS in der Caddy-Datei „:80“ durch die Adresse
# zu ersetzen und die erste Zeile zu löschen. Hinter einem Reverse Proxy führt genau das in eine
# Umleitungsschleife – und nötig ist es nicht mehr: Die Adresse wird in der App eingestellt.
# Entspricht die Datei bis auf die Adresse der früheren Fassung, wird sie deshalb umgestellt und
# die Adresse als Startwert an das Backend übergeben. Eine wirklich eigene Datei bleibt, wie sie ist.
ALT_ADRESSE=""
ALT_ERREICHBARKEIT=""
CADDY_UMSTELLEN=0

caddy_altlast_pruefen() {
  [[ "$TB_SYNC" == "1" && -f "$CADDYFILE" ]] || return 0

  local kern erste rest eintrag name
  kern="$(caddy_kern "$CADDYFILE")"
  erste="$(printf '%s\n' "$kern" | head -n1)"
  rest="$(printf '%s\n' "$kern" | tail -n +2)"
  # Erste Zeile: „<Adresse> {“
  [[ "$erste" == *' {' ]] || return 0
  eintrag="${erste% \{}"
  [[ -n "$eintrag" && "$eintrag" != *[[:space:]]* ]] || return 0
  [[ "$rest" == "$(caddy_kern_alt 1)" || "$rest" == "$(caddy_kern_alt 0)" ]] || return 0

  # Zählt nur, wenn die Markierung fehlt – mit ihr wird die Datei ohnehin neu geschrieben.
  CADDY_UMSTELLEN=1
  name="${eintrag#http://}"; name="${name#https://}"; name="${name%%:*}"
  # Nur ein richtiger Name (mit Punkt, keine IP) ist eine Adresse – „:8080“ ist bloß ein Port.
  if [[ "$name" == *.* && ! "$name" =~ ^[0-9.]+$ ]]; then
    ALT_ADRESSE="$name"
    # Hat Caddy für den Namen wirklich ein Zertifikat geholt, lief er ohne Proxy. Sonst saß einer davor.
    if [[ "$eintrag" != http://* && "$eintrag" != *:80 ]] &&
      compgen -G "/var/lib/caddy/.local/share/caddy/certificates/*/$name/$name.crt" >/dev/null; then
      ALT_ERREICHBARKEIT=selbst
    else
      ALT_ERREICHBARKEIT=proxy
    fi
  fi
}

# Ist Port 443 frei – oder gehört er schon Caddy?
port_443_frei() {
  command -v ss >/dev/null 2>&1 || return 0
  local belegt
  belegt="$(ss -H -ltnp 'sport = :443' 2>/dev/null || true)"
  [[ -z "$belegt" || "$belegt" == *caddy* ]]
}

caddy_einrichten() {
  schritt "Webserver (Caddy) einrichten"

  if [[ -f "$CADDYFILE" ]] && ! grep -qF "$CADDY_MARKE" "$CADDYFILE"; then
    if [[ "$CADDY_UMSTELLEN" == "1" ]]; then
      cp -a "$CADDYFILE" "$CADDYFILE.vor-0.5"
      warnung "$CADDYFILE enthielt eine von Hand eingetragene Adresse. Das ist nicht mehr nötig und"
      warnung "stört hinter einem Reverse Proxy – die Datei wird neu geschrieben (alte Fassung: $CADDYFILE.vor-0.5)."
      if [[ -n "$ALT_ADRESSE" ]]; then
        warnung "Übernommen: $ALT_ADRESSE ($ALT_ERREICHBARKEIT). Ändern: in der App unter Einstellungen → Server."
      fi
    elif [[ "$MODUS" == "update" ]]; then
      warnung "$CADDYFILE wurde von Hand angepasst und bleibt unverändert."
      warnung "Seit 0.5 gehört die Adresse nicht mehr in diese Datei, sondern in die App (Einstellungen → Server) –"
      warnung "siehe README, Abschnitt „HTTPS und Reverse Proxy“. Zurück zur Standardfassung: Datei löschen, dann truhenblick-update --force"
      systemctl reload caddy 2>/dev/null || systemctl restart caddy
      return
    else
      cp -a "$CADDYFILE" "$CADDYFILE.vor-truhenblick"
    fi
  fi

  # Port 443 nur, wenn es einen Sinn hat: Das Backend entscheidet, für welchen Namen ein Zertifikat
  # geholt wird, und Zertifikate gibt es nur über die Ports 80 und 443.
  local mit_https=0
  if [[ "$TB_SYNC" == "1" && "$TB_HTTPS" == "1" && "$TB_PORT" == "80" ]]; then
    if port_443_frei; then
      mit_https=1
    else
      warnung "Port 443 ist auf diesem Rechner schon belegt – Truhenblick hält ihn nicht bereit."
      warnung "Für HTTPS dann einen Reverse Proxy davor setzen (in der App: Einstellungen → Server)."
    fi
  fi

  local api
  if [[ "$TB_SYNC" == "1" ]]; then
    api="	handle /api/* {
		# Die Rückfrage vor einem Zertifikat ist nur für Caddy selbst gedacht.
		@intern path /api/zertifikat
		respond @intern 404

		reverse_proxy 127.0.0.1:${BACKEND_PORT} {
			# Einem Reverse Proxy im privaten Netz glauben, von welchem Gerät eine Anfrage stammt.
			trusted_proxies private_ranges
		}
	}"
  else
    api="	# Ohne Sync-Backend installiert
	handle /api/* {
		respond \"Sync-Backend ist nicht installiert.\" 404
	}"
  fi

  {
    cat <<EOF
$CADDY_MARKE
# Diese Datei wird bei Updates neu geschrieben. Wer sie selbst pflegen möchte,
# entfernt die erste Zeile – dann lässt truhenblick-update sie in Ruhe.
#
# Hier steht bewusst keine Adresse: Port ${TB_PORT} antwortet unter jedem Namen – der IP im
# Heimnetz genauso wie dem Namen, unter dem ein vorgeschalteter Reverse Proxy (z. B. Nginx
# Proxy Manager) die App erreichbar macht. Welche Adresse gilt und wer sich um HTTPS kümmert,
# wird in der App eingestellt: Einstellungen → Server.
EOF
    if [[ "$mit_https" == "1" ]]; then
      cat <<EOF
#
# Port 443 ist für „Truhenblick holt das Zertifikat selbst“ da: Caddy fragt beim Backend nach,
# ob er für den angefragten Namen eines holen darf, und tut es nur für die eingestellte Adresse.
{
	on_demand_tls {
		ask http://127.0.0.1:${BACKEND_PORT}/api/zertifikat
	}
}
EOF
    fi
    cat <<EOF

(truhenblick) {
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

		# Manche Proxys speichern .js-Dateien zwischen, was auch immer oben steht (in Nginx Proxy
		# Manager: „Cache Assets“). „Vary: *“ verbietet ihnen das für den Service Worker.
		header /sw.js {
			Vary "*"
			defer
		}

		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"

		try_files {path} /index.html
		file_server
	}
}

:${TB_PORT} {
	import truhenblick
}
EOF
    if [[ "$mit_https" == "1" ]]; then
      cat <<EOF

https:// {
	tls {
		on_demand
	}

	import truhenblick
}
EOF
    fi
  } >"$CADDYFILE"

  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 ||
    abbruch "Die erzeugte Caddy-Konfiguration ist ungültig: caddy validate --config $CADDYFILE"
  systemctl enable --quiet caddy
  systemctl restart caddy
  if [[ "$mit_https" == "1" ]]; then
    ok "Caddy liefert die App auf Port $TB_PORT aus (Port 443 steht für ein eigenes Zertifikat bereit)"
  else
    ok "Caddy liefert die App auf Port $TB_PORT aus"
  fi
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
TB_APP_UPDATE=$TB_APP_UPDATE
TB_HTTPS=$TB_HTTPS
EOF
  chmod 644 "$KONF"
  git -C "$QUELLE" rev-parse HEAD >"$ETC/version" 2>/dev/null || true
}

werkzeuge_installieren() {
  install -m 755 "$QUELLE/install/truhenblick-update" /usr/local/bin/truhenblick-update
  # „pct exec“ auf dem Proxmox-Host sucht nicht in /usr/local/bin. Mit dem Verweis
  # funktioniert dort auch der kurze Aufruf:  pct exec <ID> -- truhenblick-update
  ln -sf /usr/local/bin/truhenblick-update /usr/bin/truhenblick-update
  # Notausgang, wenn niemand mehr das Passwort für die Anmeldung kennt
  install -m 755 "$QUELLE/install/truhenblick-anmeldung-aus" /usr/local/bin/truhenblick-anmeldung-aus
  ln -sf /usr/local/bin/truhenblick-anmeldung-aus /usr/bin/truhenblick-anmeldung-aus
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
# Vor dem Backend: Eine Adresse aus einer früheren Caddy-Datei soll es beim Start schon kennen.
caddy_altlast_pruefen
if [[ "$TB_SYNC" == "1" ]]; then backend_einrichten; else backend_entfernen; fi
caddy_einrichten
einstellungen_merken
werkzeuge_installieren
# Zuletzt: Das Update-Skript muss liegen und die Einstellungen müssen gespeichert sein,
# bevor die App ein Update anstoßen kann.
if [[ "$TB_SYNC" == "1" && "$TB_APP_UPDATE" == "1" ]]; then update_aus_app_einrichten; else update_aus_app_entfernen; fi

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$QUELLE/package.json" | head -n1)"
printf '\n%sTruhenblick %s ist eingerichtet.%s\n' "$FETT$GRUEN" "$VERSION" "$AUS"
printf '  Adresse:   %s\n' "$(adresse)"
if [[ "$TB_SYNC" == "1" ]]; then
  if [[ "$TOKEN_NEU" == "1" ]]; then
    printf '  Abgleich:  aktiv – Code der ersten Truhe: %s%s%s\n' "$FETT" "$SYNC_TOKEN_AKTUELL" "$AUS"
    printf '             (steht in %s)\n' "$SERVER_ENV"
  elif [[ "$MODUS" == "install" ]]; then
    printf '  Abgleich:  aktiv – beim Anlegen einer Truhe in der App entsteht der Code,\n'
    printf '             mit dem weitere Geräte beitreten\n'
  else
    printf '  Abgleich:  aktiv – Truhen und Zugangscodes unverändert\n'
  fi
else
  printf '  Abgleich:  nicht installiert\n'
fi
if [[ "$TB_SYNC" == "1" ]]; then
  printf '  Server:    Adresse, Reverse Proxy und Passwort stellst du in der App ein\n'
  printf '             (Einstellungen → Server)\n'
fi
printf '  Update:    truhenblick-update\n'
