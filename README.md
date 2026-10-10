# Truhenblick

Gefriertruhen-Management als installierbare Web-App (PWA): Die Startseite zeigt die Truhe **von oben** –
Hängekörbe, Ebenen und Fächer als Kacheln, darin die Artikel als farbige Chips. So siehst du auf einen Blick,
**was wo liegt** und was bald weg muss.

- Läuft auf iOS, Android und Desktop, lässt sich auf dem Home-Bildschirm installieren und funktioniert offline
- Alle Daten liegen lokal im Browser (IndexedDB) – kein Konto, kein Server nötig
- Schnellerfassung: Name tippen, Platz in der Truhe antippen, fertig. Kategorie, Symbol, Einheit und Haltbarkeit
  werden vorgeschlagen
- Ampel für die Haltbarkeit (grün / gelb / rot), immer zusätzlich mit Symbol und Text
- Suche mit Hervorhebung des Fundorts, Filter nach Kategorie, sortierbare Liste, „Bald verbrauchen“
- Rückgängig nach Entnehmen und Ändern, JSON-Backup, Dark Mode nach Systemeinstellung
- Optional: eigener Sync-Server, damit alle Geräte im Haushalt denselben Stand sehen

**Inhalt:** [Lokal starten](#lokal-starten) · [Anpassen](#anpassen) · [Installation](#installation) ·
[HTTPS und Reverse Proxy](#https-und-reverse-proxy) · [Updates](#updates) ·
[Backup und Restore](#backup-und-restore) · [Abgleich zwischen Geräten](#abgleich-zwischen-geräten) ·
[PWA testen](#pwa-testen) · [Tests](#tests) · [Stand der Prüfungen](#stand-der-prüfungen)

---

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 22.18 oder neuer (empfohlen: 24).

```bash
npm install
npm run dev
```

Danach läuft die App unter <http://localhost:5173>. Beim ersten Start fragt ein Assistent nach dem Aufbau der Truhe.

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Live-Aktualisierung |
| `npm run build` | Typprüfung und Produktions-Build nach `dist/` |
| `npm run preview` | den Build lokal ausliefern (<http://localhost:4173>) – so lässt sich die PWA testen |
| `npm test` | Unit-Tests (Vitest) |
| `npm run typecheck` | nur die Typprüfung |
| `npm run test:install` | Testlauf des Proxmox-Skripts mit nachgebildeten Proxmox-Befehlen (braucht Bash) |
| `npm run icons` | App-Icons aus `public/logo.svg` neu erzeugen |

Das Sync-Backend liegt in `server/` und ist ein eigenes kleines Paket:

```bash
cd server
npm install
SYNC_TOKEN=$(openssl rand -hex 24) npm start     # lauscht auf Port 3000
npm test
```

Entwicklungsserver und Vorschau reichen `/api` an `http://localhost:3000` weiter. In der App trägst du unter
*Einstellungen → Abgleich zwischen Geräten* nur noch das Token ein.

### Aufbau

```
src/
  config/       Kategorien, Haltbarkeiten, Einheiten, Ampel-Schwelle  ← zum Anpassen gedacht
  logic/        reine Datenlogik: Datum, Haltbarkeit, Vorschläge, Suche, Truhenstruktur (+ Tests)
  db/           IndexedDB (Dexie): Schema, Schreiboperationen, Backup (+ Tests)
  sync/         Abgleich mit dem Sync-Server (+ Tests)
  components/   Truhengrafik, Chips, Listenzeile, Suche, Filter, Navigation, Hinweise
  pages/        Truhe, Liste, Bald verbrauchen, Einstellungen, Einrichtung, Artikelformular
shared/         Typen, Prüfungen und die Konfliktregel – von App UND Server verwendet
server/         Sync-Backend (Hono + SQLite)
install/        Proxmox-Skript, Einrichtung im Container, Update-Skript
docker/         Caddy-Konfiguration für das Docker-Image
deploy/         Beispiel für einen Reverse Proxy mit HTTPS
```

## Anpassen

Die fachlichen Stellschrauben stehen in drei kleinen Dateien:

| Datei | Inhalt |
| --- | --- |
| `src/config/kategorien.ts` | Kategorien mit Symbol und Standardhaltbarkeit in Monaten; Stichwörter für feinere Vorschläge (z. B. *Hackfleisch → 3 Monate*, *Gemüse → 12 Monate*) |
| `src/config/einheiten.ts` | Einheiten und die Schrittweite der −/+-Knöpfe (z. B. 100 g) |
| `src/config/ampel.ts` | ab wie vielen Resttagen ein Artikel als „bald verbrauchen“ gilt (Standard: 30) |

Nach einer Änderung neu bauen. Bei einer Installation per Proxmox-Skript liegen die Quellen im Container unter
`/opt/truhenblick/src`; `truhenblick-update --force` baut neu und versucht, eigene Anpassungen über spätere Updates
hinweg zu erhalten.

---

## Installation

Truhenblick ist eine statische Web-App. Zum Selbsthosten gibt es drei Wege:

| Weg | geeignet für |
| --- | --- |
| [A) Proxmox-LXC](#a-proxmox-lxc-hauptweg) | Proxmox-VE-Hosts – ein Befehl, ein Container |
| [B) Docker Compose](#b-docker-compose) | VPS, NAS, Raspberry Pi (ARM64) |
| [C) Ohne Container](#c-ohne-container) | eigener Debian-/Ubuntu-Server oder ein beliebiger statischer Webspace |

> **Für die Installation als App ist HTTPS nötig.** Über `http://` läuft Truhenblick im Browser, lässt sich aber
> nicht auf dem Home-Bildschirm installieren und nicht offline nutzen (Ausnahme: `localhost`).
> Siehe [HTTPS und Reverse Proxy](#https-und-reverse-proxy).

### A) Proxmox-LXC (Hauptweg)

Auf dem **Proxmox-Host** als root ausführen:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/laserjonas/Truhenblick/main/install/proxmox-lxc.sh)"
```

Das Skript fragt alle Angaben mit sinnvollen Vorgaben ab (mit `whiptail`-Dialogen, sonst im Terminal), zeigt eine
Zusammenfassung und legt erst nach Bestätigung los. Es

1. lädt bei Bedarf das aktuelle Debian-12-Template,
2. erstellt und startet den Container (`pct create`, `pct start`),
3. installiert darin Caddy, Node.js und die App (statischer Build),
4. richtet auf Wunsch das Sync-Backend als systemd-Dienst ein,
5. prüft, ob App und Backend antworten, und nennt Adresse und Zugangs-Token.

Bricht etwas ab, bietet das Skript an, den halb angelegten Container wieder zu entfernen.

**Ohne Rückfragen** – alle Angaben als Optionen oder Umgebungsvariablen:

```bash
curl -fsSL https://raw.githubusercontent.com/laserjonas/Truhenblick/main/install/proxmox-lxc.sh -o proxmox-lxc.sh
bash proxmox-lxc.sh --yes --hostname truhenblick --ip 192.168.1.50/24 --gateway 192.168.1.1

# oder über Umgebungsvariablen
TB_YES=1 TB_HOSTNAME=truhenblick TB_SYNC=0 bash proxmox-lxc.sh
```

| Option | Variable | Standard | Bedeutung |
| --- | --- | --- | --- |
| `--hostname` | `TB_HOSTNAME` | `truhenblick` | Hostname des Containers |
| `--ctid` | `TB_CTID` | nächste freie ID | Container-ID |
| `--storage` | `TB_STORAGE` | `local-lvm`, sonst der erste passende | Storage für die Root-Disk |
| `--template-storage` | `TB_TEMPLATE_STORAGE` | `local`, sonst der erste passende | Storage für das Template |
| `--disk` | `TB_DISK` | `4` | Root-Disk in GB |
| `--cores` | `TB_CORES` | `1` | CPU-Kerne |
| `--memory` | `TB_MEMORY` | `512` | Arbeitsspeicher in MB |
| `--swap` | `TB_SWAP` | `1024` | Swap in MB (hilft beim Bauen der App) |
| `--bridge` | `TB_BRIDGE` | `vmbr0` | Netzwerk-Bridge |
| `--ip` | `TB_IP` | `dhcp` | `dhcp` oder Adresse mit Netzmaske, z. B. `192.168.1.50/24` |
| `--gateway` | `TB_GATEWAY` | – | Gateway (bei statischer IP Pflicht) |
| `--vlan` | `TB_VLAN` | – | VLAN-Tag |
| `--dns` | `TB_DNS` | wie der Host | DNS-Server |
| `--password` | `TB_PASSWORD` | – | Root-Passwort des Containers |
| `--ssh-key` | `TB_SSH_KEY` | – | SSH-Public-Key: Datei oder der Schlüssel selbst |
| `--unprivileged` / `--privileged` | `TB_UNPRIVILEGED` | `1` | unprivilegierter Container |
| `--with-sync` / `--no-sync` | `TB_SYNC` | `1` | Sync-Backend mitinstallieren |
| `--sync-token` | `TB_SYNC_TOKEN` | wird erzeugt | Zugangs-Token, mindestens 16 Zeichen |
| `--port` | `TB_PORT` | `80` | Port der Web-App |
| `--repo`, `--branch` | `TB_REPO`, `TB_BRANCH` | dieses Repository, `main` | Quelle der Installation |
| `--yes` | `TB_YES` | `0` | keine Rückfragen |

Ohne Passwort und SSH-Schlüssel ist der Container nur über `pct enter <ID>` auf dem Host erreichbar.

<details>
<summary><strong>Beispielausgabe</strong></summary>

```text
Truhenblick – Installation als LXC-Container
  • pve-manager/9.2.10/43df2e01f27a1a19 (running kernel: 7.0.14-12-pve)

Zusammenfassung
  Hostname:        truhenblick
  Container-ID:    105
  Typ:             unprivilegiert
  Root-Disk:       4 GB auf local-lvm
  CPU / RAM:       1 Kern(e), 512 MB RAM, 1024 MB Swap
  Netzwerk:        vmbr0, DHCP
  Zugang:          nur über „pct enter 105“ auf dem Host
  Web-App:         Port 80
  Sync-Backend:    ja
  Quelle:          https://github.com/laserjonas/Truhenblick.git (main)

[1/5] Debian-12-Template bereitstellen
  ✓ Template ist vorhanden: debian-12-standard_12.12-1_amd64.tar.zst

[2/5] Container 105 anlegen
  ✓ Container angelegt
  ✓ Container gestartet

[3/5] Auf das Netzwerk warten
  ✓ IP-Adresse: 192.168.1.77
  ✓ Internetzugang vorhanden

[4/5] Truhenblick im Container installieren (einige Minuten)
  ✓ Grundpakete installiert
  ✓ Quellen geholt
  • Baue die App und richte die Dienste ein …
  ✓ Truhenblick ist installiert

[5/5] Installation prüfen
  ✓ Die Web-App antwortet
  ✓ Das Sync-Backend antwortet

Truhenblick ist fertig installiert.

  Adresse:        http://192.168.1.77
  Container:      105 (truhenblick), startet automatisch mit dem Host
  Konsole:        pct enter 105
  Update:         pct exec 105 -- truhenblick-update

  Abgleich zwischen Geräten
  Zugangs-Token:  e5e08964d85871f1f0f95bf3457ab001e3d31633614f0f2f
  In der App unter Einstellungen → „Abgleich zwischen Geräten“ eintragen.
  Das Token steht auch im Container in /etc/truhenblick/server.env.
  Datenbank:      /var/lib/truhenblick/truhenblick.sqlite (im Container)

  Wichtig: Für die Installation als App ist HTTPS nötig.
  …
```

IP-Adresse und Token sind Beispiele. Auf einem Testsystem dauerte der ganze Lauf knapp zwei Minuten.

</details>

**Arbeitsspeicher:** 512 MB reichen für den Betrieb locker (App und Backend brauchen zusammen rund 130 MB).
Beim Bauen der App wird das Limit aber ausgeschöpft und etwas Swap benutzt – den Swap deshalb nicht auf 0 setzen.

**Statische IP:** Das Skript prüft vor dem Anlegen, ob das Gateway im Netz der Adresse liegt. Ein Tippfehler wie
`172.168.178.50/24` mit Gateway `192.168.178.1` fällt so sofort auf und nicht erst, wenn der Container kein Internet
hat.

**Was im Container wo liegt**

| Pfad | Inhalt |
| --- | --- |
| `/var/www/truhenblick` | die gebaute Web-App |
| `/etc/caddy/Caddyfile` | Webserver-Konfiguration |
| `/opt/truhenblick/src` | Quellen (Git-Checkout) |
| `/opt/truhenblick/app` | laufendes Sync-Backend |
| `/var/lib/truhenblick/truhenblick.sqlite` | **Datenbank des Sync-Backends** |
| `/var/lib/truhenblick/backups/` | automatische Sicherungen vor Updates |
| `/etc/truhenblick/server.env` | Zugangs-Token und Einstellungen des Backends |
| `/usr/local/bin/truhenblick-update` | Update-Skript |

Dienste: `systemctl status caddy` und `systemctl status truhenblick-server`, Meldungen mit
`journalctl -u truhenblick-server`.

### B) Docker Compose

```bash
git clone https://github.com/laserjonas/Truhenblick.git
cd Truhenblick
cp .env.example .env          # anpassen – für den Abgleich SYNC_TOKEN setzen

# nur die App
docker compose up -d --build

# App und Sync-Backend
docker compose --profile sync up -d --build
```

Die App ist danach unter `http://<Rechner>:<HTTP_PORT>` erreichbar (Standard: Port 80).

- **Konfiguration** vollständig über Umgebungsvariablen in `.env` – siehe die Kommentare in
  [`.env.example`](.env.example).
- **Daten:** Die SQLite-Datenbank des Backends liegt im Volume `truhenblick_daten`.
- **ARM64 / Raspberry Pi:** Die Images bauen direkt auf dem Gerät (64-Bit-System vorausgesetzt). Die App wird in
  der Build-Stufe erzeugt und von `caddy:2-alpine` ausgeliefert; das Backend nutzt `node:24-alpine` und bringt
  fertige SQLite-Binärdateien für x64 und ARM64 mit – es wird nichts kompiliert.
  Für beide Architekturen auf einmal:
  `docker buildx build --platform linux/amd64,linux/arm64 -t <name>/truhenblick-web .`
- **Einzelne Images** ohne Compose:
  `docker build -t truhenblick-web .` und `docker build -f server/Dockerfile -t truhenblick-api .`

### C) Ohne Container

**Eigener Debian-/Ubuntu-Server:** Das Skript, das auch im LXC läuft, richtet alles ein (Caddy, Node.js, App,
optional das Backend als systemd-Dienst). Als root:

```bash
git clone https://github.com/laserjonas/Truhenblick.git /opt/truhenblick/src
TB_SYNC=1 TB_PORT=8080 bash /opt/truhenblick/src/install/container-setup.sh
```

Achtung: Das Skript schreibt `/etc/caddy/Caddyfile` neu (eine vorhandene Datei wird als
`Caddyfile.vor-truhenblick` gesichert). Auf einem Server, auf dem Caddy schon andere Seiten ausliefert, ist
Docker Compose die bessere Wahl.

**Beliebiger statischer Webspace** (ohne Abgleich): `npm run build` ausführen und den Inhalt von `dist/` hochladen.
Zu beachten:

- Auslieferung über HTTPS, sonst keine Installation und kein Offline-Betrieb
- `index.html`, `sw.js` und `manifest.webmanifest` nicht lange cachen lassen (`Cache-Control: no-cache`),
  sonst kommen Updates verspätet an; Dateien unter `assets/` dürfen dauerhaft gecacht werden
- Die App erwartet, direkt unter `/` zu liegen (nicht in einem Unterverzeichnis)

---

## HTTPS und Reverse Proxy

Browser erlauben Service Worker – und damit Installation und Offline-Betrieb – nur über HTTPS.

**Variante 1: Reverse Proxy davor** (z. B. Caddy auf dem VPS, Nginx Proxy Manager, Traefik). Truhenblick lauscht
nur intern, der Proxy kümmert sich um das Zertifikat. Mit Docker Compose in der `.env`:

```ini
HTTP_BIND=127.0.0.1
HTTP_PORT=8080
```

und in der Caddy-Konfiguration des Hosts (vollständiges Beispiel: [`deploy/Caddyfile.example`](deploy/Caddyfile.example)):

```caddyfile
truhe.example.de {
	reverse_proxy 127.0.0.1:8080
}
```

Für einen Proxmox-Container zeigt der Proxy stattdessen auf dessen Adresse, z. B. `reverse_proxy 192.168.1.50:80`.

**Variante 2: Truhenblick holt das Zertifikat selbst.** Voraussetzung: Die Domain zeigt auf den Rechner, Ports 80
und 443 sind aus dem Internet erreichbar.

- Docker Compose: in der `.env` `SITE_ADDRESS=truhe.example.de` setzen und mit der Zusatzdatei starten:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.https.yml --profile sync up -d --build
  ```

- Proxmox-LXC: im Container in `/etc/caddy/Caddyfile` die Zeile `:80 {` durch `truhe.example.de {` ersetzen,
  die erste Zeile der Datei (die Markierung „automatisch erzeugt“) löschen, damit Updates sie nicht
  überschreiben, und `systemctl reload caddy` ausführen.

Im Heimnetz ohne öffentliche Domain hilft ein Reverse Proxy mit eigenem Zertifikat (z. B. per DNS-Challenge) oder
ein Dienst wie Tailscale mit HTTPS-Zertifikaten.

## Updates

| Installation | Update |
| --- | --- |
| Proxmox-LXC | `pct exec <ID> -- truhenblick-update` (im Container: `truhenblick-update`) |
| Docker Compose | `git pull && docker compose --profile sync up -d --build` |
| ohne Container | `truhenblick-update` |

`truhenblick-update` holt die neue Version, **sichert zuerst die SQLite-Datenbank**, baut und ersetzt die App erst
nach erfolgreichem Build. Schlägt der Build fehl, läuft die bisherige Version weiter. Die Daten in
`/var/lib/truhenblick` bleiben immer erhalten. Mit `--check` wird nur geprüft, mit `--force` in jedem Fall neu
gebaut.

In bereits geöffneten oder installierten Apps erscheint beim nächsten Start der Hinweis
*„Eine neue Version von Truhenblick ist da“* – ein Tipp auf *Aktualisieren* lädt sie.

## Backup und Restore

**Auf jedem Gerät:** *Einstellungen → Datensicherung → Backup speichern* schreibt alle Daten in eine JSON-Datei.
*Backup einspielen* bietet zwei Wege: **Zusammenführen** (je Artikel gilt die jüngste Änderung) oder
**Alles ersetzen** (genau der Stand des Backups). Damit lässt sich die Truhe auch ohne Server auf ein anderes
Gerät übertragen.

**Sync-Server:** Zu sichern ist eine einzige Datei, die SQLite-Datenbank.

```bash
# Proxmox-LXC / ohne Container – Sicherung im laufenden Betrieb
sqlite3 /var/lib/truhenblick/truhenblick.sqlite ".backup '/root/truhenblick-sicherung.sqlite'"

# Docker Compose – Sicherung
docker compose stop api
docker run --rm -v truhenblick_truhenblick_daten:/data -v "$PWD":/ziel alpine \
  cp /data/truhenblick.sqlite /ziel/truhenblick-sicherung.sqlite
docker compose start api
```

Vor jedem Update legt `truhenblick-update` selbst eine Sicherung unter `/var/lib/truhenblick/backups/` an und
behält die letzten zehn. Bei Proxmox lässt sich zusätzlich der ganze Container sichern (`vzdump`).

**Wiederherstellen:**

```bash
# Proxmox-LXC / ohne Container
systemctl stop truhenblick-server
cp /root/truhenblick-sicherung.sqlite /var/lib/truhenblick/truhenblick.sqlite
rm -f /var/lib/truhenblick/truhenblick.sqlite-wal /var/lib/truhenblick/truhenblick.sqlite-shm
chown truhenblick:truhenblick /var/lib/truhenblick/truhenblick.sqlite
systemctl start truhenblick-server
```

Die Geräte bemerken beim nächsten Abgleich, dass der Server einen älteren Stand hat, und laden ihre Daten erneut
hoch – es geht nichts verloren, was noch auf einem Gerät liegt. Dasselbe gilt für einen ganz neu aufgesetzten
Server.

## Abgleich zwischen Geräten

Der Abgleich ist optional; ohne ihn arbeitet die App vollständig lokal.

- **Einrichten:** Auf dem ersten Gerät unter *Einstellungen → Abgleich zwischen Geräten* Adresse und Token
  eintragen. Auf jedem weiteren Gerät im Einrichtungsassistenten *„Schon eine Truhe auf einem anderen Gerät?“*
  aufklappen – die vorhandene Truhe erscheint dann von selbst.
- **Offline-first:** Jede Änderung wird sofort lokal gespeichert und übertragen, sobald der Server erreichbar
  ist – beim Start, nach Änderungen, wenn das Gerät wieder online ist und regelmäßig im Vordergrund.
- **Konflikte:** Ändern zwei Geräte denselben Artikel, gewinnt die **spätere Änderung** (Zeitstempel
  `geaendertAm`). Das gilt für den ganzen Artikel, nicht feldweise. Die Uhren der Geräte sollten deshalb
  ungefähr stimmen.
- **Zugang:** ein gemeinsames Token für den Haushalt (`SYNC_TOKEN`, mindestens 16 Zeichen), übertragen als
  `Authorization: Bearer …`. Nach zehn Fehlversuchen ist eine Adresse zehn Minuten gesperrt. Das Token gehört
  nur über HTTPS ins Internet.
- **Schnittstelle:** `GET /api/health` (ohne Anmeldung) und `POST /api/sync`.

Einstellungen des Backends (Umgebungsvariablen):

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `SYNC_TOKEN` | – (Pflicht) | Zugangs-Token |
| `PORT` | `3000` | Port |
| `HOST` | `0.0.0.0` | Adresse, auf der gelauscht wird |
| `DATA_DIR` | `./data` | Verzeichnis der SQLite-Datenbank |
| `CORS_ORIGIN` | – | nur nötig, wenn die App von einer anderen Adresse geladen wird als das Backend |

## PWA testen

Service Worker gibt es nur im Produktions-Build:

```bash
npm run build
npm run preview        # http://localhost:4173 – localhost gilt als sichere Herkunft
```

- **Chrome/Edge:** DevTools → *Application* → *Manifest* und *Service Workers*. Unter *Network* auf „Offline“
  stellen und neu laden – die App muss weiter funktionieren. In der Adressleiste erscheint das Installieren-Symbol.
- **Update-Hinweis:** bei laufender Vorschau etwas ändern, erneut `npm run build`, die Seite in den Vordergrund
  holen – der Hinweis „Eine neue Version …“ erscheint.
- **Android:** über HTTPS öffnen → Menü → *App installieren*.
- **iOS:** in Safari öffnen → *Teilen* → *Zum Home-Bildschirm*. iOS kennt keinen Installationsdialog, die App
  zeigt deshalb selbst einen Hinweis.
- **Lighthouse:** Die PWA-Kategorie wurde mit Lighthouse 12 entfernt. Mit Version 11 lässt sie sich noch prüfen:

  ```bash
  npx lighthouse@11 http://localhost:4173 --only-categories=pwa --view
  npx lighthouse http://localhost:4173 --view      # Performance, Barrierefreiheit, Best Practices
  ```

## Tests

| Was | Befehl | Umfang |
| --- | --- | --- |
| Datenlogik der App | `npm test` | Datum und Haltbarkeit, Vorschläge, Suche, Truhenstruktur, Konfliktregel, Datenbankoperationen, Backup, Sync-Client |
| Sync-Backend | `cd server && npm test` | Anmeldung, Eingabeprüfung, Abgleich und Konflikte gegen eine SQLite-Datenbank im Speicher |
| Proxmox-Skript | `npm run test:install` | Optionen, Rückfragen, Prüfungen und Aufräumen nach Fehlern – mit nachgebildeten Proxmox-Befehlen |

## Stand der Prüfungen

Was bisher wie geprüft wurde (Stand: Version 0.1.0):

- **App:** automatisierte Tests sowie Durchläufe im Browser (Chrome, Handy- und Desktop-Breite, hell und dunkel)
  einschließlich Offline-Betrieb und Update-Hinweis am Produktions-Build.
- **Abgleich:** Ende-zu-Ende mit zwei getrennten Browsern – gegen das lokal gestartete Backend, gegen den
  Docker-Stack und gegen einen Proxmox-Container.
- **Proxmox-Skript:** auf einem echten Host getestet (Proxmox VE 9.2, Debian-12-Template, unprivilegierter
  Container): ohne Rückfragen, mit Rückfragen im Terminal und über die whiptail-Dialoge; DHCP und statische IP;
  mit und ohne Sync-Backend; Abbruch durch Fehler und durch Strg+C mit anschließendem Aufräumen.
  `truhenblick-update` wurde dort mit echten neuen Versionen, mit eigenen Anpassungen an den Quellen und über
  `pct exec` geprüft. **Nicht** getestet: privilegierte Container, VLAN-Tags, andere Storage-Typen als LVM-Thin,
  Proxmox VE 8 und ältere.
- **Docker:** beide Images gebaut und als Compose-Stack gestartet (nur App, mit Sync-Backend, mit eigenem HTTPS
  über `SITE_ADDRESS`), Daten überstehen einen Neustart. ARM64 wurde unter Emulation gebaut und gestartet,
  **nicht** auf einem echten Raspberry Pi. Das Abholen eines echten Zertifikats (Let's Encrypt) ist ungetestet.
- **Ohne Container** (`container-setup.sh` direkt auf einem Server): nur im Proxmox-Container gelaufen,
  nicht auf Ubuntu.
- **iOS und Android:** noch nicht auf echten Geräten ausprobiert. Eigene iOS-Startbilder (Splash-Images) gibt es
  nicht – beim Start zeigt iOS kurz eine einfarbige Fläche.

Rückmeldungen zu diesen Punkten sind willkommen.
