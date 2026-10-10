#!/usr/bin/env bash
#
# Prüft install/proxmox-lxc.sh ohne Proxmox: Die Proxmox-Befehle (pct, pveam, pvesm …)
# werden durch Attrappen ersetzt, die ihre Aufrufe protokollieren. So lassen sich
# Optionen, Rückfragen, Prüfungen und das Aufräumen nach Fehlern testen –
# nicht aber, ob Proxmox die Befehle wirklich so annimmt.
#
#   bash install/test/proxmox-lxc.test.sh

set -uo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKRIPT="$HIER/../proxmox-lxc.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

# ------------------------------------------------------------------ Attrappen

ATTRAPPEN="$ARBEIT/bin"
mkdir -p "$ATTRAPPEN"

cat >"$ARBEIT/attrappe" <<'ATTRAPPE'
#!/usr/bin/env bash
# Eine Datei für alle nachgebildeten Befehle – unterschieden nach dem Namen, unter dem sie aufgerufen wird.
name="$(basename "$0")"
printf '%s %s\n' "$name" "$*" >>"$MOCK_LOG"
fehler() { [[ "${MOCK_FEHLER:-}" == "$1" ]]; }

case "$name" in
  id) echo "${MOCK_UID:-0}" ;;
  pveversion) echo "pve-manager/8.3.0/attrappe (running kernel: 6.8.12-4-pve)" ;;
  dpkg) echo amd64 ;;
  qm) exit 2 ;;
  ip) [[ "$*" == "link show dev vmbr0" || "$*" == "link show dev vmbr1" ]] ;;
  pvesh)
    case "$*" in
      "get /cluster/nextid") echo 105 ;;
      *resources*) echo '[{"vmid":100,"type":"lxc"},{"vmid":101,"type":"qemu"}]' ;;
    esac
    ;;
  pvesm)
    echo "Name             Type     Status           Total            Used       Available        %"
    case "$*" in
      *rootdir*)
        echo "local             dir     active        98497780        12345678        81000000   12.53%"
        echo "local-lvm     lvmthin     active       365760512        22345678       343414834    6.11%"
        echo "kaputt            nfs   inactive               0               0               0    0.00%"
        ;;
      *vztmpl*) echo "local             dir     active        98497780        12345678        81000000   12.53%" ;;
    esac
    ;;
  pveam)
    case "$1" in
      update) fehler pveam-update && exit 1; echo "update successful" ;;
      available)
        fehler kein-template && exit 0
        echo "system          debian-11-standard_11.7-1_amd64.tar.zst"
        echo "system          debian-12-standard_12.2-1_amd64.tar.zst"
        echo "system          debian-12-standard_12.12-1_amd64.tar.zst"
        echo "system          ubuntu-24.04-standard_24.04-2_amd64.tar.zst"
        ;;
      list)
        echo "NAME                                                         SIZE"
        [[ "${MOCK_TEMPLATE_DA:-0}" == 1 ]] && echo "local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst       123.45MB"
        ;;
      download) fehler download && exit 1; echo "download ok" ;;
    esac
    ;;
  pct)
    case "$1" in
      status) [[ "$2" == 100 ]] && echo "status: running" || exit 2 ;;
      create) fehler create && { echo "unable to create CT: storage voll" >&2; exit 255; }; echo "created" ;;
      start) fehler start && exit 1; echo "started" ;;
      stop | destroy) echo "ok" ;;
      push) cp "$3" "$MOCK_ABLAGE/install.env" ;;
      exec)
        shift 3   # exec <id> --
        while [[ "${1:-}" == env || "${1:-}" == *=* ]]; do shift; done   # vorangestelltes „env VAR=wert“ überspringen
        case "$*" in
          "ip -4 -o addr show dev eth0 scope global")
            fehler keine-ip && exit 0
            echo "2: eth0    inet 192.168.1.77/24 brd 192.168.1.255 scope global dynamic eth0"
            ;;
          "getent hosts deb.debian.org") fehler kein-internet && exit 2; echo "151.101.2.132 deb.debian.org" ;;
          chpasswd) cat >"$MOCK_ABLAGE/chpasswd" ;;
          "git clone"*) fehler clone && { echo "fatal: repository not found" >&2; exit 128; }; true ;;
          *container-setup.sh) fehler setup && { echo "npm ERR! build failed" >&2; exit 1; }; echo "eingerichtet" ;;
          curl*"/api/health") fehler api && exit 7; true ;;
          curl*) fehler web && exit 7; true ;;
          *) true ;;
        esac
        ;;
    esac
    ;;
esac
ATTRAPPE
chmod +x "$ARBEIT/attrappe"
for befehl in id pveversion pct pvesh pveam pvesm qm dpkg ip; do
  cp "$ARBEIT/attrappe" "$ATTRAPPEN/$befehl"
done

# ------------------------------------------------------------------ Testgerüst

BESTANDEN=0
FEHLGESCHLAGEN=0
AUSGABE=""
CODE=0
export MOCK_LOG="$ARBEIT/aufrufe.log"
export MOCK_ABLAGE="$ARBEIT/ablage"

# starte [VAR=wert …] -- Optionen…   (Eingabe für Rückfragen über $EINGABEN)
starte() {
  local umgebung=()
  while [[ "$1" != "--" ]]; do umgebung+=("$1"); shift; done
  shift
  rm -rf "$MOCK_ABLAGE"; mkdir -p "$MOCK_ABLAGE"; : >"$MOCK_LOG"
  # Rückfragen laufen im Textmodus über die Standardeingabe. Dafür darf kein Terminal
  # erreichbar sein – setsid löst den Lauf davon, wo es das gibt.
  local los=()
  command -v setsid >/dev/null 2>&1 && los=(setsid -w)
  AUSGABE="$(printf '%b' "${EINGABEN:-}" | env -u TB_YES "${umgebung[@]}" PATH="$ATTRAPPEN:$PATH" TB_DIALOG=text \
    "${los[@]}" bash "$SKRIPT" "$@" 2>&1)"
  CODE=$?
  EINGABEN=""
  # ZEIGEN=1 gibt die Ausgabe jedes Laufs aus (zum Nachsehen, was das Skript anzeigt).
  if [[ "${ZEIGEN:-0}" == 1 ]]; then printf '%s\n      → Code %s\n\n' "$AUSGABE" "$CODE"; fi
}

pruefe() {
  # pruefe "Beschreibung" Befehl…
  local text="$1"; shift
  if "$@"; then
    BESTANDEN=$((BESTANDEN + 1))
  else
    FEHLGESCHLAGEN=$((FEHLGESCHLAGEN + 1))
    printf '  ✗ %s\n' "$text"
    printf '      Ausgabe: %s\n' "$(tail -n 4 <<<"$AUSGABE" | tr '\n' '|')"
  fi
}

aufruf()       { grep -qE -- "$1" "$MOCK_LOG"; }
kein_aufruf()  { ! grep -qE -- "$1" "$MOCK_LOG"; }
ausgabe()      { grep -qE -- "$1" <<<"$AUSGABE"; }
keine_ausgabe() { ! grep -qE -- "$1" <<<"$AUSGABE"; }
code_ist()     { [[ "$CODE" -eq "$1" ]]; }
code_nicht_0() { [[ "$CODE" -ne 0 ]]; }
uebergabe()    { grep -qE -- "$1" "$MOCK_ABLAGE/install.env" 2>/dev/null; }
test_titel()   { printf '%s\n' "• $1"; }

# ------------------------------------------------------------------ Tests

test_titel "Hilfe"
starte -- --help
pruefe "--help endet mit 0" code_ist 0
pruefe "--help nennt die Optionen" ausgabe '--hostname NAME'
pruefe "--help ruft kein pct auf" kein_aufruf '^pct'

test_titel "Ohne Rückfragen mit Standardwerten"
starte -- --yes
pruefe "endet erfolgreich" code_ist 0
pruefe "nächste freie ID wird verwendet" aufruf '^pct create 105 local:vztmpl/debian-12-standard_12\.12-1_amd64\.tar\.zst'
pruefe "neuestes Template wird geladen" aufruf '^pveam download local debian-12-standard_12\.12-1_amd64\.tar\.zst'
pruefe "Hostname truhenblick" aufruf '^pct create .*--hostname truhenblick'
pruefe "Disk 4 GB auf local-lvm" aufruf '^pct create .*--rootfs local-lvm:4 '
pruefe "1 Kern, 512 MB" aufruf '^pct create .*--cores 1 --memory 512 --swap 1024'
pruefe "DHCP auf vmbr0" aufruf '^pct create .*--net0 name=eth0,bridge=vmbr0,ip=dhcp '
pruefe "unprivilegiert mit nesting" aufruf '^pct create .*--unprivileged 1 --features nesting=1'
pruefe "Container wird gestartet" aufruf '^pct start 105'
pruefe "Quellen werden geholt" aufruf '^pct exec 105 -- env LC_ALL=C.UTF-8 LANG=C.UTF-8 git clone .*--branch main https://github.com/laserjonas/Truhenblick.git /opt/truhenblick/src'
pruefe "Einrichtung läuft im Container" aufruf '^pct exec 105 -- env LC_ALL=C.UTF-8 LANG=C.UTF-8 bash /opt/truhenblick/src/install/container-setup.sh'
pruefe "Übergabe: Port 80" uebergabe '^TB_PORT=80$'
pruefe "Übergabe: Sync aktiv" uebergabe '^TB_SYNC=1$'
pruefe "Übergabe: Token wird erzeugt (48 Hex-Zeichen)" uebergabe '^TB_SYNC_TOKEN=[0-9a-f]{48}$'
pruefe "Token steht in keiner Befehlszeile" kein_aufruf 'TB_SYNC_TOKEN|[0-9a-f]{48}'
pruefe "kein Passwort gesetzt" kein_aufruf 'chpasswd'
pruefe "nichts wird gelöscht" kein_aufruf '^pct destroy'
pruefe "Adresse wird genannt" ausgabe 'http://192\.168\.1\.77'
pruefe "Token wird am Ende gezeigt" ausgabe 'Zugangs-Token: +.*[0-9a-f]{48}'
pruefe "Hinweis auf HTTPS" ausgabe 'HTTPS nötig'
pruefe "Zusammenfassung wird gezeigt" ausgabe 'Container-ID: +105'

test_titel "Vorhandenes Template wird nicht erneut geladen"
starte MOCK_TEMPLATE_DA=1 -- --yes
pruefe "endet erfolgreich" code_ist 0
pruefe "kein Download" kein_aufruf '^pveam download'

test_titel "Alle Optionen"
starte -- --yes --hostname kueche --ctid 222 --storage local --disk 8 --cores 2 --memory 1024 --swap 0 \
  --bridge vmbr1 --ip 10.0.0.5/24 --gateway 10.0.0.1 --vlan 30 --dns 10.0.0.2 \
  --password geheim123 --ssh-key "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGtest jonas@laptop" \
  --privileged --no-sync --port 8080 --repo https://git.example/t.git --branch test
pruefe "endet erfolgreich" code_ist 0
pruefe "ID und Hostname" aufruf '^pct create 222 .*--hostname kueche'
pruefe "Ressourcen" aufruf '^pct create .*--cores 2 --memory 1024 --swap 0 --rootfs local:8 '
pruefe "statische IP, Gateway, VLAN" aufruf '^pct create .*--net0 name=eth0,bridge=vmbr1,ip=10\.0\.0\.5/24,gw=10\.0\.0\.1,tag=30 '
pruefe "privilegiert" aufruf '^pct create .*--unprivileged 0 '
pruefe "DNS" aufruf '^pct create .*--nameserver 10\.0\.0\.2'
pruefe "SSH-Schlüssel als Datei" aufruf '^pct create .*--ssh-public-keys /tmp/truhenblick-key-'
pruefe "Passwort über die Standardeingabe" grep -qx 'root:geheim123' "$MOCK_ABLAGE/chpasswd"
pruefe "Passwort in keiner Befehlszeile" kein_aufruf 'geheim123'
pruefe "eigenes Repo und Zweig" aufruf '^pct exec 222 -- env LC_ALL=C.UTF-8 LANG=C.UTF-8 git clone .*--branch test https://git.example/t.git'
pruefe "Übergabe: ohne Sync" uebergabe '^TB_SYNC=0$'
pruefe "Übergabe: kein Token" uebergabe '^TB_SYNC_TOKEN=$'
pruefe "Übergabe: Port" uebergabe '^TB_PORT=8080$'
pruefe "Adresse mit Port" ausgabe 'http://192\.168\.1\.77:8080'
pruefe "kein Token-Abschnitt" keine_ausgabe 'Zugangs-Token'
pruefe "Backend wird nicht geprüft" kein_aufruf 'api/health'

test_titel "Umgebungsvariablen statt Optionen"
starte TB_YES=1 TB_HOSTNAME=keller TB_CTID=333 TB_SYNC_TOKEN=mein-eigenes-token-123 --
pruefe "endet erfolgreich" code_ist 0
pruefe "Werte aus der Umgebung" aufruf '^pct create 333 .*--hostname keller'
pruefe "eigenes Token wird übergeben" uebergabe '^TB_SYNC_TOKEN=mein-eigenes-token-123$'

test_titel "Ungültige Angaben werden vor dem Anlegen abgewiesen"
abgewiesen() {
  local grund="$1" muster="$2"; shift 2
  starte -- --yes "$@"
  pruefe "$grund: Abbruch" code_nicht_0
  pruefe "$grund: verständliche Meldung" ausgabe "$muster"
  pruefe "$grund: kein Container" kein_aufruf '^pct create'
}
abgewiesen "belegte ID" 'bereits vergeben' --ctid 100
abgewiesen "ID einer VM" 'bereits vergeben' --ctid 101
abgewiesen "zu kleine ID" 'Ungültige Container-ID' --ctid 42
abgewiesen "falsche IP" 'Ungültige IP-Angabe' --ip 192.168.1.50
abgewiesen "statisch ohne Gateway" 'Gateway benötigt' --ip 192.168.1.50/24
abgewiesen "Oktett über 255" 'Ungültige IP-Angabe' --ip 192.168.1.300/24
abgewiesen "Gateway außerhalb des Netzes (Tippfehler 172 statt 192)" \
  'Gateway 192\.168\.178\.1 liegt nicht im Netz der IP-Adresse 172\.168\.178\.220/24 \(172\.168\.178\.0/24\)' \
  --ip 172.168.178.220/24 --gateway 192.168.178.1
abgewiesen "Gateway gleich der eigenen Adresse" 'liegt nicht im Netz' --ip 192.168.1.5/24 --gateway 192.168.1.5
abgewiesen "Gateway knapp außerhalb (/25)" 'liegt nicht im Netz der IP-Adresse 192\.168\.1\.10/25 \(192\.168\.1\.0/25\)' \
  --ip 192.168.1.10/25 --gateway 192.168.1.129
abgewiesen "unbekannter Storage" 'kann keine Container-Disks aufnehmen' --storage gibtsnicht
abgewiesen "inaktiver Storage" 'kann keine Container-Disks aufnehmen' --storage kaputt
abgewiesen "unbekannte Bridge" 'Bridge „vmbr9“ gibt es' --bridge vmbr9
abgewiesen "falscher Port" 'Ungültiger Port' --port 99999
abgewiesen "falsches VLAN" 'Ungültiger VLAN-Tag' --vlan 5000
abgewiesen "zu kurzes Token" 'mindestens 16 Zeichen' --sync-token kurz
abgewiesen "falscher Hostname" 'Ungültiger Hostname' --hostname 'mein host'
abgewiesen "kaputter SSH-Schlüssel" 'weder eine vorhandene Datei noch ein gültiger Public Key' --ssh-key 'kein schluessel'
abgewiesen "zu wenig RAM" 'Ungültiger Arbeitsspeicher' --memory 64
abgewiesen "unbekannte Option" 'Unbekannte Option: --quatsch' --quatsch
abgewiesen "Option ohne Wert" 'braucht einen Wert' --hostname

test_titel "Geroutete Einzeladresse (/32): Gateway darf außerhalb liegen"
starte -- --yes --ip 203.0.113.7/32 --gateway 198.51.100.1
pruefe "endet erfolgreich" code_ist 0
pruefe "Adresse und Gateway werden übernommen" aufruf '^pct create .*ip=203\.0\.113\.7/32,gw=198\.51\.100\.1 '

test_titel "Falsche Umgebung"
starte MOCK_UID=1000 -- --yes
pruefe "ohne root: Abbruch mit Hinweis" ausgabe 'als root'
pruefe "ohne root: kein Container" kein_aufruf '^pct create'
rm "$ATTRAPPEN/pveam"
starte -- --yes
pruefe "ohne Proxmox: Abbruch mit Hinweis" ausgabe 'muss auf einem Proxmox-VE-Host laufen'
pruefe "ohne Proxmox: kein Container" kein_aufruf '^pct create'
cp "$ARBEIT/attrappe" "$ATTRAPPEN/pveam"

test_titel "Fehler vor dem Anlegen hinterlassen nichts"
starte MOCK_FEHLER=kein-template -- --yes
pruefe "kein Template: Abbruch" code_nicht_0
pruefe "kein Template: Meldung" ausgabe 'kein Debian-12-Template gefunden'
pruefe "kein Template: nichts angelegt, nichts gelöscht" kein_aufruf '^pct (create|destroy)'
starte MOCK_FEHLER=download -- --yes
pruefe "Download scheitert: Abbruch" code_nicht_0
pruefe "Download scheitert: nichts gelöscht" kein_aufruf '^pct destroy'
starte MOCK_FEHLER=kein-template MOCK_TEMPLATE_DA=1 -- --yes
pruefe "offline, aber Template liegt vor: weiter" code_ist 0

test_titel "Fehler nach dem Anlegen: Container wird wieder entfernt (--yes)"
for stelle in create start keine-ip kein-internet clone setup web api; do
  starte MOCK_FEHLER=$stelle -- --yes
  pruefe "$stelle: Abbruch" code_nicht_0
  pruefe "$stelle: Container wird gestoppt und entfernt" aufruf '^pct destroy 105 --purge'
  pruefe "$stelle: keine Erfolgsmeldung" keine_ausgabe 'fertig installiert'
done
starte MOCK_FEHLER=setup -- --yes
pruefe "Protokoll wird genannt" ausgabe 'Ausführliches Protokoll: /tmp/truhenblick-install-'
pruefe "letzte Meldungen werden gezeigt" ausgabe 'npm ERR! build failed'
starte MOCK_FEHLER=keine-ip -- --yes
pruefe "ohne IP: Hinweis auf Bridge/DHCP" ausgabe 'keine IP-Adresse erhalten'
starte MOCK_FEHLER=kein-internet -- --yes --ip 192.168.1.50/24 --gateway 192.168.1.1
pruefe "kein Internet bei statischer IP: Meldung nennt die Angaben" ausgabe 'Eingestellt sind IP 192\.168\.1\.50/24 und Gateway 192\.168\.1\.1'

test_titel "Rückfragen im Textmodus"
# Hostname (erst ungültig), ID (erst belegt), Storage, Disk, Kerne, RAM, Bridge, DHCP? nein → IP, Gateway,
# VLAN, Passwort + Wiederholung, SSH-Schlüssel, unprivilegiert?, Sync?, Port, Bestätigung
EINGABEN='mein host\nspeisekammer\n100\n140\nlocal\n6\n\n768\n\nn\n192.168.5.9/24\n192.168.5.1\n\ngeheim123\ngeheim123\n\n\nn\n8443\nj\n'
starte --
pruefe "endet erfolgreich" code_ist 0
pruefe "ungültiger Hostname wird erneut erfragt" ausgabe 'nur Buchstaben, Ziffern und Bindestriche'
pruefe "belegte ID wird erneut erfragt" ausgabe 'freie Zahl ab 100'
pruefe "nach einer Fehleingabe bleibt die Vorgabe stehen" keine_ausgabe 'Hostname des Containers \[mein host\]'
pruefe "leere Vorgaben werden nicht als [] gezeigt" keine_ausgabe '\[\]'
pruefe "eingegebene Werte" aufruf '^pct create 140 .*--hostname speisekammer .*--cores 1 --memory 768 .*--rootfs local:6 '
pruefe "statische IP aus der Rückfrage" aufruf '^pct create .*ip=192\.168\.5\.9/24,gw=192\.168\.5\.1 '
pruefe "Passwort aus der Rückfrage" grep -qx 'root:geheim123' "$MOCK_ABLAGE/chpasswd"
pruefe "ohne Sync, Port 8443" uebergabe '^TB_PORT=8443$'
pruefe "ohne Sync" uebergabe '^TB_SYNC=0$'
pruefe "Zusammenfassung vor dem Anlegen" ausgabe 'Container jetzt anlegen'

# Passwort: zu kurz, dann Wiederholung falsch, dann richtig (7 Vorgaben, DHCP ja, VLAN leer davor)
EINGABEN='\n\n\n\n\n\n\n\n\nkurz\ngeheim123\nanders999\ngeheim123\ngeheim123\n\n\n\n\nj\n'
starte --
pruefe "Passwort-Rückfrage: endet erfolgreich" code_ist 0
pruefe "Passwort-Rückfrage: zu kurzes Passwort wird abgelehnt" ausgabe 'mindestens 5 Zeichen'
pruefe "Passwort-Rückfrage: abweichende Wiederholung wird abgelehnt" ausgabe 'stimmen nicht überein'
pruefe "Passwort-Rückfrage: das bestätigte Passwort wird gesetzt" grep -qx 'root:geheim123' "$MOCK_ABLAGE/chpasswd"

# Mit --password wird nicht noch einmal nach dem Passwort gefragt
EINGABEN='\n\n\n\n\n\n\n\n\n\n\n\n\nj\n'
starte -- --password vorab-gesetzt
pruefe "übergebenes Passwort: endet erfolgreich" code_ist 0
pruefe "übergebenes Passwort: keine Rückfrage" keine_ausgabe 'Root-Passwort für den Container'
pruefe "übergebenes Passwort: wird gesetzt" grep -qx 'root:vorab-gesetzt' "$MOCK_ABLAGE/chpasswd"

# Tippfehler in der IP: Gateway passt nicht → beide Angaben werden erneut erfragt
EINGABEN='\n\n\n\n\n\n\nn\n172.168.178.220/24\n192.168.178.1\n192.168.178.220/24\n\n\n\n\n\n\n\nj\n'
starte --
pruefe "Gateway außerhalb: endet nach der Korrektur erfolgreich" code_ist 0
pruefe "Gateway außerhalb: Hinweis nennt das Netz" ausgabe 'liegt nicht im Netz der IP-Adresse 172\.168\.178\.220/24 \(172\.168\.178\.0/24\)'
pruefe "Gateway außerhalb: korrigierte Adresse wird verwendet" aufruf '^pct create .*ip=192\.168\.178\.220/24,gw=192\.168\.178\.1 '
pruefe "Gateway außerhalb: falsche Adresse wird nie verwendet" kein_aufruf '172\.168\.178\.220'

EINGABEN='\n\n\n\n\n\n\n\n\n\n\n\n\n\nn\n'
starte --
pruefe "Nein bei der Bestätigung: Abbruch" code_ist 130
pruefe "Nein bei der Bestätigung: nichts angelegt" kein_aufruf '^pct create'
pruefe "Nein bei der Bestätigung: Meldung" ausgabe 'es wurde nichts angelegt'

EINGABEN='\n\n\n\n\n\n\n\n\n\n\n\n\n\nj\nn\n'
starte MOCK_FEHLER=setup --
pruefe "Fehler + „nein“ beim Aufräumen: Container bleibt" kein_aufruf '^pct destroy'
pruefe "Fehler + „nein“ beim Aufräumen: Hinweis zum Entfernen" ausgabe 'pct destroy 105 --purge'

EINGABEN='\n\n\n\n\n\n\n\n\n\n\n\n\n\nj\n\n'
starte MOCK_FEHLER=setup --
pruefe "Fehler + Eingabetaste beim Aufräumen: Container wird entfernt" aufruf '^pct destroy 105 --purge'

EINGABEN='\n\n'
starte --
pruefe "Eingabe endet vorzeitig: Abbruch mit Hinweis auf --yes" ausgabe 'Keine Eingabe möglich'
pruefe "Eingabe endet vorzeitig: nichts angelegt" kein_aufruf '^pct create'

# ------------------------------------------------------------------ Ergebnis

printf '\n%s bestanden, %s fehlgeschlagen\n' "$BESTANDEN" "$FEHLGESCHLAGEN"
[[ "$FEHLGESCHLAGEN" -eq 0 ]]
