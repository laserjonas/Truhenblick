#!/usr/bin/env bash
#
# Truhenblick – Installation als LXC-Container auf einem Proxmox-VE-Host
#
# Auf dem Proxmox-Host als root ausführen:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/laserjonas/Truhenblick/main/install/proxmox-lxc.sh)"
#
# Ohne Rückfragen (alle Angaben über Optionen oder Umgebungsvariablen):
#
#   bash proxmox-lxc.sh --yes --hostname truhenblick --ip 192.168.1.50/24 --gateway 192.168.1.1
#
# Alle Optionen:  bash proxmox-lxc.sh --help

set -Eeuo pipefail

REPO_STANDARD="https://github.com/laserjonas/Truhenblick.git"
BRANCH_STANDARD="main"
SKRIPT_VERSION="1.0"

# ------------------------------------------------------------------ Einstellungen
# Reihenfolge: Option > Umgebungsvariable (TB_…) > Rückfrage > Standard

CT_HOSTNAME="${TB_HOSTNAME:-truhenblick}"
CTID="${TB_CTID:-}"
STORAGE="${TB_STORAGE:-}"
TEMPLATE_STORAGE="${TB_TEMPLATE_STORAGE:-}"
DISK="${TB_DISK:-4}"
CORES="${TB_CORES:-1}"
MEMORY="${TB_MEMORY:-512}"
SWAP="${TB_SWAP:-1024}"
BRIDGE="${TB_BRIDGE:-vmbr0}"
IP="${TB_IP:-dhcp}"
GATEWAY="${TB_GATEWAY:-}"
VLAN="${TB_VLAN:-}"
DNS="${TB_DNS:-}"
PASSWORT="${TB_PASSWORD:-}"
SSH_KEY="${TB_SSH_KEY:-}"
UNPRIVILEGIERT="${TB_UNPRIVILEGED:-1}"
MIT_SYNC="${TB_SYNC:-1}"
SYNC_TOKEN="${TB_SYNC_TOKEN:-}"
PORT="${TB_PORT:-80}"
REPO="${TB_REPO:-$REPO_STANDARD}"
BRANCH="${TB_BRANCH:-$BRANCH_STANDARD}"
OHNE_RUECKFRAGE="${TB_YES:-0}"

# ------------------------------------------------------------------ Ausgabe

if [[ -t 1 ]]; then
  FETT=$'\e[1m'; ROT=$'\e[31m'; GRUEN=$'\e[32m'; GELB=$'\e[33m'; BLAU=$'\e[36m'; AUS=$'\e[0m'
else
  FETT=""; ROT=""; GRUEN=""; GELB=""; BLAU=""; AUS=""
fi

info()    { printf '%s  •%s %s\n' "$BLAU" "$AUS" "$*"; }
ok()      { printf '%s  ✓%s %s\n' "$GRUEN" "$AUS" "$*"; }
warnung() { printf '%s  !%s %s\n' "$GELB" "$AUS" "$*" >&2; }
schritt() { printf '\n%s[%s/%s]%s %s\n' "$FETT" "$1" "$SCHRITTE" "$AUS" "$2"; }
SCHRITTE=5

hilfe() {
  cat <<EOF
Truhenblick – Installation als LXC-Container auf Proxmox VE (Skript $SKRIPT_VERSION)

Aufruf:  bash proxmox-lxc.sh [Optionen]

Ohne Optionen fragt das Skript alle Angaben ab. Jede Option lässt sich auch als
Umgebungsvariable setzen (in Klammern).

Container
  --hostname NAME          Hostname                          (TB_HOSTNAME, Standard: truhenblick)
  --ctid ID                Container-ID                      (TB_CTID, Standard: nächste freie)
  --storage NAME           Storage für die Root-Disk         (TB_STORAGE)
  --template-storage NAME  Storage für das Template          (TB_TEMPLATE_STORAGE)
  --disk GB                Größe der Root-Disk in GB         (TB_DISK, Standard: 4)
  --cores N                CPU-Kerne                         (TB_CORES, Standard: 1)
  --memory MB              Arbeitsspeicher in MB             (TB_MEMORY, Standard: 512)
  --swap MB                Swap in MB                        (TB_SWAP, Standard: 1024)
  --privileged             privilegierter Container          (TB_UNPRIVILEGED=0)
  --unprivileged           unprivilegierter Container        (TB_UNPRIVILEGED=1, Standard)

Netzwerk
  --bridge NAME            Netzwerk-Bridge                   (TB_BRIDGE, Standard: vmbr0)
  --ip dhcp|ADRESSE/CIDR   IP-Adresse                        (TB_IP, Standard: dhcp)
  --gateway ADRESSE        Gateway, bei statischer IP        (TB_GATEWAY)
  --vlan TAG               VLAN-Tag                          (TB_VLAN)
  --dns ADRESSE            DNS-Server                        (TB_DNS, Standard: wie der Host)

Zugang
  --password PASSWORT      Root-Passwort des Containers      (TB_PASSWORD)
  --ssh-key DATEI|SCHLÜSSEL  SSH-Public-Key für root         (TB_SSH_KEY)
                           Ohne beides: Zugang nur über „pct enter“ auf dem Host.

Truhenblick
  --port PORT              Port der Web-App                  (TB_PORT, Standard: 80)
  --with-sync              mit Sync-Backend                  (TB_SYNC=1, Standard)
  --no-sync                ohne Sync-Backend                 (TB_SYNC=0)
  --sync-token CODE        Zugangscode (min. 16 Zeichen)     (TB_SYNC_TOKEN, Standard: wird erzeugt)
  --repo URL               Git-Adresse der Quellen           (TB_REPO)
  --branch NAME            Zweig                             (TB_BRANCH, Standard: main)

Sonstiges
  -y, --yes                keine Rückfragen, Standardwerte verwenden (TB_YES=1)
  -h, --help               diese Hilfe
EOF
}

# ------------------------------------------------------------------ Optionen

wert() {
  # Stellt sicher, dass auf eine Option ein Wert folgt.
  [[ $# -ge 2 && -n "${2:-}" ]] || { printf '%sFehler:%s Die Option %s braucht einen Wert.\n' "$ROT" "$AUS" "$1" >&2; exit 2; }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) wert "$@"; CT_HOSTNAME="$2"; shift 2 ;;
    --ctid) wert "$@"; CTID="$2"; shift 2 ;;
    --storage) wert "$@"; STORAGE="$2"; shift 2 ;;
    --template-storage) wert "$@"; TEMPLATE_STORAGE="$2"; shift 2 ;;
    --disk) wert "$@"; DISK="$2"; shift 2 ;;
    --cores) wert "$@"; CORES="$2"; shift 2 ;;
    --memory) wert "$@"; MEMORY="$2"; shift 2 ;;
    --swap) wert "$@"; SWAP="$2"; shift 2 ;;
    --bridge) wert "$@"; BRIDGE="$2"; shift 2 ;;
    --ip) wert "$@"; IP="$2"; shift 2 ;;
    --gateway) wert "$@"; GATEWAY="$2"; shift 2 ;;
    --vlan) wert "$@"; VLAN="$2"; shift 2 ;;
    --dns) wert "$@"; DNS="$2"; shift 2 ;;
    --password) wert "$@"; PASSWORT="$2"; shift 2 ;;
    --ssh-key) wert "$@"; SSH_KEY="$2"; shift 2 ;;
    --privileged) UNPRIVILEGIERT=0; shift ;;
    --unprivileged) UNPRIVILEGIERT=1; shift ;;
    --with-sync) MIT_SYNC=1; shift ;;
    --no-sync) MIT_SYNC=0; shift ;;
    --sync-token) wert "$@"; SYNC_TOKEN="$2"; shift 2 ;;
    --port) wert "$@"; PORT="$2"; shift 2 ;;
    --repo) wert "$@"; REPO="$2"; shift 2 ;;
    --branch) wert "$@"; BRANCH="$2"; shift 2 ;;
    -y | --yes) OHNE_RUECKFRAGE=1; shift ;;
    -h | --help) hilfe; exit 0 ;;
    *) printf '%sFehler:%s Unbekannte Option: %s (siehe --help)\n' "$ROT" "$AUS" "$1" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------ Fehlerbehandlung und Aufräumen

CT_ANGELEGT=0
FERTIG=0
LOG="$(mktemp /tmp/truhenblick-install-XXXXXX.log)"
TEMP_DATEIEN=()

loesche_container() {
  pct stop "$CTID" >/dev/null 2>&1 || true
  if pct destroy "$CTID" --purge >/dev/null 2>&1; then
    ok "Container $CTID wurde entfernt."
  else
    warnung "Container $CTID konnte nicht entfernt werden. Bitte von Hand:  pct destroy $CTID --purge"
  fi
}

aufraeumen() {
  local code=$?
  trap - EXIT ERR INT TERM
  local datei
  for datei in "${TEMP_DATEIEN[@]:-}"; do
    [[ -n "$datei" ]] && rm -f "$datei"
  done

  if [[ "$FERTIG" == "1" ]]; then
    rm -f "$LOG"
    exit 0
  fi

  if [[ "$CT_ANGELEGT" == "1" ]]; then
    printf '\n'
    warnung "Die Installation wurde nicht abgeschlossen. Der Container $CTID ist nur halb eingerichtet."
    if [[ "$OHNE_RUECKFRAGE" == "1" ]]; then
      loesche_container
    else
      local antwort=j
      printf '  Container %s wieder entfernen? [J/n] ' "$CTID" >"${AUSGABE:-/dev/stderr}"
      read -r antwort <"${EINGABE:-/dev/stdin}" || antwort=j
      case "${antwort:-j}" in
        [nN]*) info "Der Container bleibt bestehen. Entfernen mit:  pct destroy $CTID --purge" ;;
        *) loesche_container ;;
      esac
    fi
  fi
  if [[ -s "$LOG" ]]; then
    info "Ausführliches Protokoll: $LOG"
  else
    rm -f "$LOG"
  fi
  [[ $code -eq 0 ]] && code=1
  exit "$code"
}

abbruch() {
  printf '\n%sFehler:%s %s\n' "$ROT" "$AUS" "$*" >&2
  exit 1
}

bei_fehler() {
  local code=$? zeile=$1
  printf '\n%sFehler:%s Ein Befehl ist fehlgeschlagen (Zeile %s, Code %s).\n' "$ROT" "$AUS" "$zeile" "$code" >&2
  if [[ -s "$LOG" ]]; then
    printf '%sLetzte Meldungen:%s\n' "$FETT" "$AUS" >&2
    tail -n 15 "$LOG" | sed 's/^/    /' >&2
  fi
  exit "$code"
}

trap aufraeumen EXIT
trap 'bei_fehler $LINENO' ERR
trap 'printf "\n%sAbgebrochen.%s\n" "$GELB" "$AUS" >&2; exit 130' INT TERM

# Führt einen Befehl aus und schreibt seine Ausgabe ins Protokoll.
still() {
  printf '\n$ %s\n' "$*" >>"$LOG"
  "$@" >>"$LOG" 2>&1
}

# Führt einen Befehl im Container aus (Ausgabe ins Protokoll).
# Mit fester Sprachumgebung: Die des Hosts gibt es im frischen Container meist nicht,
# was sonst jede Paketinstallation mit Locale-Warnungen quittiert.
im_ct() {
  still pct exec "$CTID" -- env LC_ALL=C.UTF-8 LANG=C.UTF-8 "$@"
}

# ------------------------------------------------------------------ Voraussetzungen

[[ "$(id -u)" -eq 0 ]] || abbruch "Bitte als root auf dem Proxmox-Host ausführen."
for befehl in pveversion pct pvesh pveam pvesm; do
  command -v "$befehl" >/dev/null 2>&1 ||
    abbruch "Dieses Skript muss auf einem Proxmox-VE-Host laufen (Befehl „$befehl“ fehlt). Für andere Systeme gibt es Docker Compose – siehe README."
done

ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

printf '%sTruhenblick%s – Installation als LXC-Container\n' "$FETT" "$AUS"
info "$(pveversion | head -n1)"

# ------------------------------------------------------------------ Hilfen für Prüfungen

ist_zahl()   { [[ "$1" =~ ^[0-9]+$ ]]; }
# Wandelt eine IPv4-Adresse in eine Zahl um; schlägt fehl, wenn es keine gültige Adresse ist.
ip_zahl() {
  [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local a=$((10#${BASH_REMATCH[1]})) b=$((10#${BASH_REMATCH[2]})) c=$((10#${BASH_REMATCH[3]})) d=$((10#${BASH_REMATCH[4]}))
  (( a <= 255 && b <= 255 && c <= 255 && d <= 255 )) || return 1
  printf '%s' $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

zahl_ip() { printf '%s.%s.%s.%s' $(( ($1 >> 24) & 255 )) $(( ($1 >> 16) & 255 )) $(( ($1 >> 8) & 255 )) $(( $1 & 255 )); }

ist_ipv4() { ip_zahl "$1" >/dev/null; }
ist_cidr() { [[ "$1" =~ ^[0-9.]+/([0-9]|[12][0-9]|3[0-2])$ ]] && ip_zahl "${1%/*}" >/dev/null; }

netzmaske() { printf '%s' $(( $1 == 0 ? 0 : (0xFFFFFFFF << (32 - $1)) & 0xFFFFFFFF )); }

# netz_von ADRESSE/CIDR → Netz in der Schreibweise 192.168.1.0/24
netz_von() {
  local bits="${1#*/}" a
  a="$(ip_zahl "${1%/*}")" || return 1
  printf '%s/%s' "$(zahl_ip $(( a & $(netzmaske "$bits") )))" "$bits"
}

# gateway_passt ADRESSE/CIDR GATEWAY – liegt das Gateway im selben Netz wie die Adresse?
# Ein häufiger Tippfehler (172.… statt 192.…) fällt so vor dem Anlegen auf und nicht erst,
# wenn der Container kein Internet hat. Bei /31 und /32 liegt das Gateway üblicherweise
# außerhalb (geroutete Adressen bei Hostern) – dort wird nicht geprüft.
gateway_passt() {
  local bits="${1#*/}" a g maske
  a="$(ip_zahl "${1%/*}")" || return 1
  g="$(ip_zahl "$2")" || return 1
  (( a != g )) || return 1
  (( bits >= 31 )) && return 0
  maske="$(netzmaske "$bits")"
  (( (a & maske) == (g & maske) ))
}
ist_ssh_key() { [[ "$1" =~ ^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+)[[:space:]]+[A-Za-z0-9+/=]+ ]]; }

storages_fuer() {
  # Namen aller aktiven Storages, die den Inhaltstyp aufnehmen
  pvesm status -content "$1" 2>/dev/null | awk 'NR > 1 && $3 == "active" { print $1 }'
}

id_belegt() {
  pct status "$1" >/dev/null 2>&1 || qm status "$1" >/dev/null 2>&1 ||
    pvesh get /cluster/resources --type vm --output-format json 2>/dev/null | grep -q "\"vmid\":$1[,}]"
}

bevorzuge() {
  # Gibt aus der Liste (stdin) den bevorzugten Namen aus, falls vorhanden – sonst den ersten.
  local wunsch="$1" liste
  liste="$(cat)"
  if grep -qx "$wunsch" <<<"$liste"; then printf '%s' "$wunsch"; else head -n1 <<<"$liste"; fi
}

# ------------------------------------------------------------------ Standardwerte ermitteln

ROOT_STORAGES="$(storages_fuer rootdir)"
VORLAGEN_STORAGES="$(storages_fuer vztmpl)"
[[ -n "$ROOT_STORAGES" ]] || abbruch "Kein Storage gefunden, der Container-Disks aufnehmen kann (Inhaltstyp „rootdir“). Bitte in Proxmox unter Rechenzentrum → Storage prüfen."
[[ -n "$VORLAGEN_STORAGES" ]] || abbruch "Kein Storage gefunden, der Container-Templates aufnehmen kann (Inhaltstyp „vztmpl“). Bitte in Proxmox unter Rechenzentrum → Storage prüfen."

[[ -n "$CTID" ]] || CTID="$(pvesh get /cluster/nextid 2>/dev/null || echo 100)"
[[ -n "$STORAGE" ]] || STORAGE="$(bevorzuge local-lvm <<<"$ROOT_STORAGES")"
[[ -n "$TEMPLATE_STORAGE" ]] || TEMPLATE_STORAGE="$(bevorzuge local <<<"$VORLAGEN_STORAGES")"

# ------------------------------------------------------------------ Rückfragen

# Dialoge mit whiptail, wenn vorhanden – sonst einfache Fragen im Terminal
# (erzwingen mit TB_DIALOG=text). Die Antworten kommen vom Terminal (/dev/tty),
# auch wenn das Skript selbst über eine Pipe hereinkommt (curl … | bash).
# Gibt es kein Terminal, wird die Standardeingabe gelesen.
DIALOG=text
EINGABE=/dev/stdin
AUSGABE=/dev/stderr
if [[ "$OHNE_RUECKFRAGE" != "1" ]]; then
  if { : </dev/tty; } 2>/dev/null; then
    EINGABE=/dev/tty
    AUSGABE=/dev/tty
  fi
  if [[ "${TB_DIALOG:-}" != text && -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1; then
    DIALOG=whiptail
  fi
fi

TITEL="Truhenblick installieren"

abgebrochen() {
  printf '\n%sAbgebrochen – es wurde nichts angelegt.%s\n' "$GELB" "$AUS" >&2
  exit 130
}

keine_eingabe() {
  abbruch "Keine Eingabe möglich (kein Terminal). Bitte mit --yes und den gewünschten Optionen aufrufen – siehe --help."
}

# frage_text "Frage" "Vorgabe" → Antwort auf stdout
frage_text() {
  local antwort
  if [[ "$DIALOG" == whiptail ]]; then
    antwort="$(whiptail --title "$TITEL" --inputbox "$1" 10 72 "$2" 3>&1 1>&2 2>&3)" || abgebrochen
  else
    if [[ -n "$2" ]]; then printf '  %s [%s]: ' "$1" "$2" >"$AUSGABE"; else printf '  %s: ' "$1" >"$AUSGABE"; fi
    read -r antwort <"$EINGABE" || keine_eingabe
    antwort="${antwort:-$2}"
  fi
  printf '%s' "$antwort"
}

# frage_geheim "Frage" → Antwort auf stdout (Eingabe unsichtbar)
frage_geheim() {
  local antwort
  if [[ "$DIALOG" == whiptail ]]; then
    antwort="$(whiptail --title "$TITEL" --passwordbox "$1" 10 72 3>&1 1>&2 2>&3)" || abgebrochen
  else
    printf '  %s: ' "$1" >"$AUSGABE"
    read -r -s antwort <"$EINGABE" || keine_eingabe
    printf '\n' >"$AUSGABE"
  fi
  printf '%s' "$antwort"
}

# frage_janein "Frage" j|n → Rückgabewert 0 = ja
frage_janein() {
  local antwort
  if [[ "$DIALOG" == whiptail ]]; then
    local vorgabe=()
    [[ "$2" == n ]] && vorgabe=(--defaultno)
    whiptail --title "$TITEL" "${vorgabe[@]}" --yes-button "Ja" --no-button "Nein" --yesno "$1" 10 72
    return $?
  fi
  local hinweis="J/n"
  [[ "$2" == n ]] && hinweis="j/N"
  printf '  %s [%s]: ' "$1" "$hinweis" >"$AUSGABE"
  read -r antwort <"$EINGABE" || keine_eingabe
  antwort="${antwort:-$2}"
  [[ "$antwort" =~ ^[jJyY] ]]
}

# frage_auswahl "Frage" "Vorgabe" Eintrag… → gewählter Eintrag auf stdout
frage_auswahl() {
  local frage="$1" vorgabe="$2" antwort
  shift 2
  if [[ "$DIALOG" == whiptail ]]; then
    local eintraege=() e
    for e in "$@"; do eintraege+=("$e" ""); done
    antwort="$(whiptail --title "$TITEL" --default-item "$vorgabe" --menu "$frage" 16 72 8 "${eintraege[@]}" 3>&1 1>&2 2>&3)" || abgebrochen
  else
    printf '  %s\n' "$frage" >"$AUSGABE"
    local e
    for e in "$@"; do printf '      - %s\n' "$e" >"$AUSGABE"; done
    printf '  Auswahl [%s]: ' "$vorgabe" >"$AUSGABE"
    read -r antwort <"$EINGABE" || keine_eingabe
    antwort="${antwort:-$vorgabe}"
  fi
  printf '%s' "$antwort"
}

hinweis() {
  if [[ "$DIALOG" == whiptail ]]; then
    whiptail --title "$TITEL" --msgbox "$1" 10 72
  else
    warnung "$1"
  fi
}

# Fragt so lange nach, bis die Prüfung den Wert annimmt.
# frage_bis VARIABLE "Frage" "Fehlermeldung" prüfbefehl…
frage_bis() {
  local -n ziel="$1"
  local frage="$2" fehler="$3" antwort
  shift 3
  while true; do
    # Die Fragen laufen in einer Subshell – ein Abbruch dort muss hier weitergereicht werden.
    antwort="$(frage_text "$frage" "$ziel")" || exit $?
    if "$@" "$antwort"; then
      ziel="$antwort"
      return 0
    fi
    hinweis "$fehler"
  done
}

pruefe_hostname() { [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]]; }
pruefe_ctid()     { ist_zahl "$1" && (( $1 >= 100 && $1 <= 999999999 )) && ! id_belegt "$1"; }
pruefe_positiv()  { ist_zahl "$1" && (( $1 >= 1 )); }
pruefe_speicher() { ist_zahl "$1" && (( $1 >= 256 )); }
pruefe_disk()     { ist_zahl "$1" && (( $1 >= 2 )); }
pruefe_bridge()   { [[ -n "$1" ]] && ip link show dev "$1" >/dev/null 2>&1; }
pruefe_port()     { ist_zahl "$1" && (( $1 >= 1 && $1 <= 65535 )); }
pruefe_vlan()     { [[ -z "$1" ]] || { ist_zahl "$1" && (( $1 >= 1 && $1 <= 4094 )); }; }
pruefe_ip()       { [[ "$1" == dhcp ]] || ist_cidr "$1"; }
pruefe_token()    { [[ -z "$1" ]] || [[ ${#1} -ge 16 && "$1" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; }
in_liste()        { grep -qx -- "$2" <<<"$1"; }

if [[ "$OHNE_RUECKFRAGE" != "1" ]]; then
  [[ "$DIALOG" == text ]] && printf '\n%sAngaben zum Container%s (Eingabetaste übernimmt den Wert in Klammern)\n' "$FETT" "$AUS"

  frage_bis CT_HOSTNAME "Hostname des Containers" "Der Hostname darf nur Buchstaben, Ziffern und Bindestriche enthalten." pruefe_hostname
  frage_bis CTID "Container-ID" "Die ID muss eine freie Zahl ab 100 sein." pruefe_ctid

  # shellcheck disable=SC2086
  STORAGE="$(frage_auswahl "Storage für die Root-Disk" "$STORAGE" $ROOT_STORAGES)" || exit $?
  frage_bis DISK "Größe der Root-Disk in GB" "Bitte eine ganze Zahl ab 2 eingeben." pruefe_disk
  frage_bis CORES "CPU-Kerne" "Bitte eine ganze Zahl ab 1 eingeben." pruefe_positiv
  frage_bis MEMORY "Arbeitsspeicher in MB" "Bitte eine ganze Zahl ab 256 eingeben." pruefe_speicher

  frage_bis BRIDGE "Netzwerk-Bridge" "Diese Bridge gibt es auf dem Host nicht." pruefe_bridge
  if frage_janein "IP-Adresse automatisch per DHCP beziehen?" "$([[ "$IP" == dhcp ]] && echo j || echo n)"; then
    IP=dhcp
    GATEWAY=""
  else
    [[ "$IP" == dhcp ]] && IP=""
    while true; do
      frage_bis IP "Statische IP-Adresse mit Netzmaske (z. B. 192.168.1.50/24)" "Bitte im Format 192.168.1.50/24 eingeben." ist_cidr
      frage_bis GATEWAY "Gateway (z. B. 192.168.1.1)" "Bitte eine IPv4-Adresse eingeben." ist_ipv4
      gateway_passt "$IP" "$GATEWAY" && break
      hinweis "Das Gateway $GATEWAY liegt nicht im Netz der IP-Adresse $IP ($(netz_von "$IP")). Bitte beide Angaben prüfen."
    done
  fi
  frage_bis VLAN "VLAN-Tag (leer = keines)" "Bitte eine Zahl von 1 bis 4094 eingeben oder leer lassen." pruefe_vlan

  # Ein per Option oder Variable übergebenes Passwort gilt – dann wird nicht noch einmal gefragt.
  if [[ -z "$PASSWORT" ]]; then
    while true; do
      PASSWORT="$(frage_geheim "Root-Passwort für den Container (leer = keines)")" || exit $?
      [[ -z "$PASSWORT" ]] && break
      if [[ ${#PASSWORT} -lt 5 ]]; then
        hinweis "Das Passwort muss mindestens 5 Zeichen lang sein."
        continue
      fi
      WIEDERHOLUNG="$(frage_geheim "Passwort wiederholen")" || exit $?
      [[ "$WIEDERHOLUNG" == "$PASSWORT" ]] && break
      hinweis "Die Passwörter stimmen nicht überein."
    done
    unset WIEDERHOLUNG
  fi
  SSH_KEY="$(frage_text "SSH-Public-Key für root: Datei oder Schlüssel (leer = keiner)" "$SSH_KEY")" || exit $?

  if frage_janein "Unprivilegierten Container anlegen? (empfohlen)" "$([[ "$UNPRIVILEGIERT" == 1 ]] && echo j || echo n)"; then
    UNPRIVILEGIERT=1
  else
    UNPRIVILEGIERT=0
  fi

  if frage_janein "Sync-Backend mitinstallieren? Damit sehen mehrere Geräte denselben Stand." "$([[ "$MIT_SYNC" == 1 ]] && echo j || echo n)"; then
    MIT_SYNC=1
  else
    MIT_SYNC=0
  fi
  frage_bis PORT "Port der Web-App" "Bitte einen Port von 1 bis 65535 eingeben." pruefe_port
fi

# ------------------------------------------------------------------ Eingaben prüfen

pruefe_hostname "$CT_HOSTNAME" || abbruch "Ungültiger Hostname: $CT_HOSTNAME"
ist_zahl "$CTID" && (( CTID >= 100 )) || abbruch "Ungültige Container-ID: $CTID (erlaubt sind Zahlen ab 100)"
id_belegt "$CTID" && abbruch "Die ID $CTID ist bereits vergeben. Mit --ctid eine andere wählen."
in_liste "$ROOT_STORAGES" "$STORAGE" || abbruch "Der Storage „$STORAGE“ kann keine Container-Disks aufnehmen. Möglich: $(tr '\n' ' ' <<<"$ROOT_STORAGES")"
in_liste "$VORLAGEN_STORAGES" "$TEMPLATE_STORAGE" || abbruch "Der Storage „$TEMPLATE_STORAGE“ kann keine Templates aufnehmen. Möglich: $(tr '\n' ' ' <<<"$VORLAGEN_STORAGES")"
pruefe_disk "$DISK" || abbruch "Ungültige Disk-Größe: $DISK (ganze Zahl ab 2, in GB)"
pruefe_positiv "$CORES" || abbruch "Ungültige Anzahl CPU-Kerne: $CORES"
pruefe_speicher "$MEMORY" || abbruch "Ungültiger Arbeitsspeicher: $MEMORY (ganze Zahl ab 256, in MB)"
ist_zahl "$SWAP" || abbruch "Ungültiger Swap: $SWAP (ganze Zahl, in MB)"
pruefe_bridge "$BRIDGE" || abbruch "Die Bridge „$BRIDGE“ gibt es auf diesem Host nicht."
pruefe_ip "$IP" || abbruch "Ungültige IP-Angabe: $IP (erwartet: dhcp oder z. B. 192.168.1.50/24)"
if [[ "$IP" != dhcp ]]; then
  ist_ipv4 "$GATEWAY" || abbruch "Bei statischer IP wird ein Gateway benötigt (--gateway 192.168.1.1)."
  gateway_passt "$IP" "$GATEWAY" ||
    abbruch "Das Gateway $GATEWAY liegt nicht im Netz der IP-Adresse $IP ($(netz_von "$IP")). Bitte beide Angaben prüfen – ein Tippfehler?"
fi
pruefe_vlan "$VLAN" || abbruch "Ungültiger VLAN-Tag: $VLAN (1 bis 4094)"
[[ -z "$DNS" ]] || ist_ipv4 "$DNS" || abbruch "Ungültiger DNS-Server: $DNS"
pruefe_port "$PORT" || abbruch "Ungültiger Port: $PORT"
[[ "$UNPRIVILEGIERT" == 0 || "$UNPRIVILEGIERT" == 1 ]] || abbruch "TB_UNPRIVILEGED muss 0 oder 1 sein."
[[ "$MIT_SYNC" == 0 || "$MIT_SYNC" == 1 ]] || abbruch "TB_SYNC muss 0 oder 1 sein."
pruefe_token "$SYNC_TOKEN" || abbruch "Der Zugangscode muss mindestens 16 Zeichen lang sein und darf nur Buchstaben, Ziffern und . _ ~ + / = - enthalten."
[[ -z "$PASSWORT" || ${#PASSWORT} -ge 5 ]] || abbruch "Das Root-Passwort muss mindestens 5 Zeichen lang sein."

# SSH-Schlüssel: Datei oder direkt der Schlüssel
SSH_KEY_DATEI=""
if [[ -n "$SSH_KEY" ]]; then
  SSH_KEY="${SSH_KEY/#\~/$HOME}"
  if [[ -f "$SSH_KEY" ]]; then
    ist_ssh_key "$(head -n1 "$SSH_KEY")" || abbruch "Die Datei $SSH_KEY enthält keinen SSH-Public-Key."
    SSH_KEY_DATEI="$SSH_KEY"
  elif ist_ssh_key "$SSH_KEY"; then
    SSH_KEY_DATEI="$(mktemp /tmp/truhenblick-key-XXXXXX.pub)"
    TEMP_DATEIEN+=("$SSH_KEY_DATEI")
    printf '%s\n' "$SSH_KEY" >"$SSH_KEY_DATEI"
  else
    abbruch "Der SSH-Schlüssel ist weder eine vorhandene Datei noch ein gültiger Public Key (ssh-ed25519 …, ssh-rsa …)."
  fi
fi

if [[ "$MIT_SYNC" == 1 && -z "$SYNC_TOKEN" ]]; then
  SYNC_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

# ------------------------------------------------------------------ Zusammenfassung

zugang="nur über „pct enter $CTID“ auf dem Host"
[[ -n "$PASSWORT" && -n "$SSH_KEY_DATEI" ]] && zugang="Root-Passwort und SSH-Schlüssel"
[[ -n "$PASSWORT" && -z "$SSH_KEY_DATEI" ]] && zugang="Root-Passwort"
[[ -z "$PASSWORT" && -n "$SSH_KEY_DATEI" ]] && zugang="SSH-Schlüssel"

netz="DHCP"
[[ "$IP" != dhcp ]] && netz="$IP, Gateway $GATEWAY"
[[ -n "$VLAN" ]] && netz="$netz, VLAN $VLAN"

ZUSAMMENFASSUNG="$(cat <<EOF
Hostname:        $CT_HOSTNAME
Container-ID:    $CTID
Typ:             $([[ "$UNPRIVILEGIERT" == 1 ]] && echo unprivilegiert || echo privilegiert)
Root-Disk:       $DISK GB auf $STORAGE
CPU / RAM:       $CORES Kern(e), $MEMORY MB RAM, $SWAP MB Swap
Netzwerk:        $BRIDGE, $netz
Zugang:          $zugang
Web-App:         Port $PORT
Sync-Backend:    $([[ "$MIT_SYNC" == 1 ]] && echo ja || echo nein)
Quelle:          $REPO ($BRANCH)
EOF
)"

if [[ "$OHNE_RUECKFRAGE" == "1" ]]; then
  printf '\n%sZusammenfassung%s\n%s\n' "$FETT" "$AUS" "$(sed 's/^/  /' <<<"$ZUSAMMENFASSUNG")"
elif [[ "$DIALOG" == whiptail ]]; then
  whiptail --title "$TITEL" --yes-button "Anlegen" --no-button "Abbrechen" \
    --yesno "Bitte prüfen:\n\n$ZUSAMMENFASSUNG\n\nContainer jetzt anlegen?" 22 76 || abgebrochen
else
  printf '\n%sZusammenfassung%s\n%s\n\n' "$FETT" "$AUS" "$(sed 's/^/  /' <<<"$ZUSAMMENFASSUNG")"
  frage_janein "Container jetzt anlegen?" j || abgebrochen
fi

# ------------------------------------------------------------------ 1. Template

schritt 1 "Debian-12-Template bereitstellen"

still pveam update || warnung "Die Template-Liste konnte nicht aktualisiert werden – verwende den vorhandenen Stand."

MUSTER="^debian-12-standard_.*_${ARCH}\\.tar\\.(zst|gz|xz)$"
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E "$MUSTER" | sort -V | tail -n1 || true)"
VORHANDEN="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk 'NR > 1 {print $1}' | sed 's|.*vztmpl/||' | grep -E "$MUSTER" | sort -V | tail -n1 || true)"

if [[ -n "$TEMPLATE" && "$TEMPLATE" == "$VORHANDEN" ]]; then
  ok "Template ist vorhanden: $TEMPLATE"
elif [[ -n "$TEMPLATE" ]]; then
  info "Lade $TEMPLATE nach $TEMPLATE_STORAGE …"
  still pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
  ok "Template heruntergeladen"
elif [[ -n "$VORHANDEN" ]]; then
  TEMPLATE="$VORHANDEN"
  warnung "Kein aktuelles Template abrufbar – verwende das vorhandene: $TEMPLATE"
else
  abbruch "Es wurde kein Debian-12-Template gefunden (Architektur $ARCH). Hat der Host Internetzugang? Test:  pveam update"
fi

# ------------------------------------------------------------------ 2. Container anlegen

schritt 2 "Container $CTID anlegen"

NET0="name=eth0,bridge=$BRIDGE"
if [[ "$IP" == dhcp ]]; then NET0+=",ip=dhcp"; else NET0+=",ip=$IP,gw=$GATEWAY"; fi
[[ -n "$VLAN" ]] && NET0+=",tag=$VLAN"

ARGUMENTE=(
  "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
  --hostname "$CT_HOSTNAME"
  --ostype debian
  --cores "$CORES"
  --memory "$MEMORY"
  --swap "$SWAP"
  --rootfs "${STORAGE}:${DISK}"
  --net0 "$NET0"
  --unprivileged "$UNPRIVILEGIERT"
  --features nesting=1
  --onboot 1
  --tags truhenblick
  --description "Truhenblick – Gefriertruhen-Management. Update im Container: truhenblick-update"
)
[[ -n "$DNS" ]] && ARGUMENTE+=(--nameserver "$DNS")
[[ -n "$SSH_KEY_DATEI" ]] && ARGUMENTE+=(--ssh-public-keys "$SSH_KEY_DATEI")

# Ab hier existiert (möglicherweise unvollständig) ein Container – bei Abbruch wird das Aufräumen angeboten.
CT_ANGELEGT=1
still pct create "${ARGUMENTE[@]}"
ok "Container angelegt"

still pct start "$CTID"
ok "Container gestartet"

# ------------------------------------------------------------------ 3. Netzwerk

schritt 3 "Auf das Netzwerk warten"

CT_IP=""
for _ in $(seq 1 45); do
  CT_IP="$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)"
  [[ -n "$CT_IP" ]] && break
  sleep 2
done
[[ -n "$CT_IP" ]] || abbruch "Der Container hat keine IP-Adresse erhalten. Bitte Bridge, VLAN und DHCP-Server prüfen."
ok "IP-Adresse: $CT_IP"

INTERNET=0
for _ in $(seq 1 15); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then
    INTERNET=1
    break
  fi
  sleep 2
done
if [[ "$INTERNET" != 1 ]]; then
  if [[ "$IP" == dhcp ]]; then
    abbruch "Der Container erreicht das Internet nicht (Namensauflösung schlägt fehl). Bitte Bridge, VLAN und DNS prüfen."
  fi
  abbruch "Der Container erreicht das Internet nicht (Namensauflösung schlägt fehl). Eingestellt sind IP $IP und Gateway $GATEWAY${DNS:+, DNS $DNS} – stimmen diese Angaben?"
fi
ok "Internetzugang vorhanden"

if [[ -n "$PASSWORT" ]]; then
  # Über die Standardeingabe, damit das Passwort in keiner Prozessliste auftaucht.
  printf 'root:%s\n' "$PASSWORT" | pct exec "$CTID" -- chpasswd
  ok "Root-Passwort gesetzt"
fi

# ------------------------------------------------------------------ 4. Truhenblick installieren

schritt 4 "Truhenblick im Container installieren (einige Minuten)"

im_ct bash -c "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl git"
ok "Grundpakete installiert"

im_ct git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" /opt/truhenblick/src
ok "Quellen geholt"

# Einstellungen als Datei übergeben – so steht das Token in keiner Befehlszeile.
UEBERGABE="$(mktemp /tmp/truhenblick-env-XXXXXX)"
TEMP_DATEIEN+=("$UEBERGABE")
chmod 600 "$UEBERGABE"
cat >"$UEBERGABE" <<EOF
TB_PORT=$PORT
TB_SYNC=$MIT_SYNC
TB_SYNC_TOKEN=$SYNC_TOKEN
TB_REPO=$REPO
TB_BRANCH=$BRANCH
EOF
im_ct mkdir -p /etc/truhenblick
still pct push "$CTID" "$UEBERGABE" /etc/truhenblick/install.env --perms 600
rm -f "$UEBERGABE"

info "Baue die App und richte die Dienste ein …"
im_ct bash /opt/truhenblick/src/install/container-setup.sh
ok "Truhenblick ist installiert"

# ------------------------------------------------------------------ 5. Prüfen

schritt 5 "Installation prüfen"

if pct exec "$CTID" -- curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" 2>>"$LOG"; then
  ok "Die Web-App antwortet"
else
  abbruch "Die Web-App antwortet nicht auf Port $PORT. Im Container nachsehen:  pct enter $CTID  →  systemctl status caddy"
fi
if [[ "$MIT_SYNC" == 1 ]]; then
  if pct exec "$CTID" -- curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/health" 2>>"$LOG"; then
    ok "Das Sync-Backend antwortet"
  else
    abbruch "Das Sync-Backend antwortet nicht. Im Container nachsehen:  pct enter $CTID  →  journalctl -u truhenblick-server"
  fi
fi

FERTIG=1

URL="http://$CT_IP"
[[ "$PORT" != 80 ]] && URL+=":$PORT"

cat <<EOF

${FETT}${GRUEN}Truhenblick ist fertig installiert.${AUS}

  Adresse:        ${FETT}${URL}${AUS}
  Container:      $CTID ($CT_HOSTNAME), startet automatisch mit dem Host
  Konsole:        pct enter $CTID
  Update:         pct exec $CTID -- truhenblick-update
EOF

if [[ "$MIT_SYNC" == 1 ]]; then
  cat <<EOF

  ${FETT}Abgleich zwischen Geräten${AUS}
  Zugangscode:    ${FETT}${SYNC_TOKEN}${AUS}
  In der App unter Einstellungen → „Abgleich zwischen Geräten“ eintragen.
  Dort lässt er sich später auch anzeigen und neu erzeugen. Dieser Anfangscode
  steht außerdem im Container in /etc/truhenblick/server.env.
  Datenbank:      /var/lib/truhenblick/truhenblick.sqlite (im Container)
EOF
fi

cat <<EOF

  ${FETT}${GELB}Wichtig: Für die Installation als App ist HTTPS nötig.${AUS}
  Über http:// läuft Truhenblick im Browser, lässt sich aber nicht auf dem
  Home-Bildschirm installieren und nicht offline nutzen. Zwei Wege:
    • Reverse Proxy mit Zertifikat davor (Caddy, Nginx Proxy Manager, Traefik …),
      der auf ${URL} weiterleitet
    • Im Container in /etc/caddy/Caddyfile die Zeile „:${PORT}“ durch die eigene
      Domain ersetzen – Caddy holt sich das Zertifikat dann selbst
      (Ports 80 und 443 müssen aus dem Internet erreichbar sein)
  Beispiele: https://github.com/laserjonas/Truhenblick#https-und-reverse-proxy

EOF
