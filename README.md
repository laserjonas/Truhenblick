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
- Optional: eigener Sync-Server – beim Anlegen einer Truhe entsteht ein Code, mit dem weitere Geräte beitreten
- Optional: Anbindung an Home Assistant – das Dashboard zeigt, was bald abläuft
- Optional: Anmeldung mit Passwort, wenn der Server aus dem Internet erreichbar ist

**Inhalt:** [Lokal starten](#lokal-starten) · [Anpassen](#anpassen) · [Installation](#installation) ·
[HTTPS und Reverse Proxy](#https-und-reverse-proxy) · [Anmeldung mit Passwort](#anmeldung-mit-passwort) ·
[Updates](#updates) ·
[Backup und Restore](#backup-und-restore) · [Abgleich zwischen Geräten](#abgleich-zwischen-geräten) ·
[Home Assistant](#home-assistant) · [PWA testen](#pwa-testen) · [Tests](#tests) ·
[Stand der Prüfungen](#stand-der-prüfungen)

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
npm start                                        # lauscht auf Port 3000
npm test
```

Entwicklungsserver und Vorschau reichen `/api` an `http://localhost:3000` weiter – „Truhe anlegen“ erzeugt dann
auch lokal einen Code.

### Aufbau

```
src/
  logic/        reine Datenlogik: Vorschläge, Suche, Truhenstruktur, Home-Assistant-Konfiguration (+ Tests)
  db/           IndexedDB (Dexie): Schema, Schreiboperationen, Backup (+ Tests)
  sync/         Abgleich mit dem Sync-Server (+ Tests)
  components/   Truhengrafik, Chips, Listenzeile, Suche, Filter, Navigation, Hinweise
  pages/        Truhe, Liste, Bald verbrauchen, Einstellungen, Einrichtung, Artikelformular
shared/         von App UND Server verwendet: Typen, Prüfungen, Konfliktregel, Datum und Haltbarkeit,
                Übersicht für Home Assistant (+ Tests)
  config/       Kategorien, Haltbarkeiten, Einheiten, Ampel-Schwelle  ← zum Anpassen gedacht
server/         Sync-Backend (Hono + SQLite)
install/        Proxmox-Skript, Einrichtung im Container, Update-Skript
docker/         Caddy-Konfiguration für das Docker-Image
deploy/         Beispiel für einen Reverse Proxy mit HTTPS
```

## Anpassen

Die fachlichen Stellschrauben stehen in drei kleinen Dateien:

| Datei | Inhalt |
| --- | --- |
| `shared/config/kategorien.ts` | Kategorien mit Symbol und Standardhaltbarkeit in Monaten; Stichwörter für feinere Vorschläge (z. B. *Hackfleisch → 3 Monate*, *Gemüse → 12 Monate*) |
| `shared/config/einheiten.ts` | Einheiten und die Schrittweite der −/+-Knöpfe (z. B. 100 g) |
| `shared/config/ampel.ts` | ab wie vielen Resttagen ein Artikel als „bald verbrauchen“ gilt (Standard: 30) |

Die Dateien gelten für die App und für den Server (der damit die Übersicht für Home Assistant berechnet). Nach
einer Änderung neu bauen. Bei einer Installation per Proxmox-Skript liegen die Quellen im Container unter
`/opt/truhenblick/src`; `truhenblick-update --force` baut neu, startet den Server neu und versucht, eigene
Anpassungen über spätere Updates hinweg zu erhalten.

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
5. prüft, ob App und Backend antworten, und nennt die Adresse.

Einen Zugangscode gibt es dabei nicht: Er entsteht, wenn du in der App die Truhe anlegst
(siehe [Abgleich zwischen Geräten](#abgleich-zwischen-geräten)).

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
| `--sync-token` | `TB_SYNC_TOKEN` | – | freiwillig: Code der ersten Truhe, mindestens 16 Zeichen |
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
  So geht es:     1. Adresse oben öffnen und „Truhe anlegen“ – dabei zeigt die App einen Code.
                  2. Auf jedem weiteren Gerät „Einer Truhe beitreten“ wählen und den Code eingeben.
  Datenbank:      /var/lib/truhenblick/truhenblick.sqlite (im Container)

  Wichtig: Für die Installation als App ist HTTPS nötig.
  …
```

Die IP-Adresse ist ein Beispiel. Auf einem Testsystem dauerte der ganze Lauf knapp zwei Minuten.

</details>

**Arbeitsspeicher:** 512 MB reichen für den Betrieb locker – im Test belegte der Container mit App und Backend
rund 60 MB. Beim Bauen der App wird das Limit aber ausgeschöpft und etwas Swap benutzt (gemessen: bis zu 70 MB) –
den Swap deshalb nicht auf 0 setzen.

**Statische IP:** Das Skript prüft vor dem Anlegen, ob das Gateway im Netz der Adresse liegt. Ein Tippfehler wie
`172.168.178.50/24` mit Gateway `192.168.178.1` fällt so sofort auf und nicht erst, wenn der Container kein Internet
hat.

**Was im Container wo liegt**

| Pfad | Inhalt |
| --- | --- |
| `/var/www/truhenblick` | die gebaute Web-App |
| `/etc/caddy/Caddyfile` | Webserver-Konfiguration – enthält keine Adresse, die wird in der App eingestellt |
| `/opt/truhenblick/src` | Quellen (Git-Checkout) |
| `/opt/truhenblick/app` | laufendes Sync-Backend |
| `/var/lib/truhenblick/truhenblick.sqlite` | **Datenbank des Sync-Backends** |
| `/var/lib/truhenblick/backups/` | automatische Sicherungen vor Updates |
| `/etc/truhenblick/server.env` | Einstellungen des Backends (z. B. `NEUE_TRUHEN`) |
| `/usr/local/bin/truhenblick-update` | Update-Skript |
| `/usr/local/bin/truhenblick-anmeldung-aus` | schaltet die Anmeldung ab, wenn niemand mehr das Passwort kennt |
| `/var/lib/truhenblick-update/` | Stand und Protokoll des letzten Updates aus der App |

Dienste: `systemctl status caddy` und `systemctl status truhenblick-server`, Meldungen mit
`journalctl -u truhenblick-server`.

### B) Docker Compose

```bash
git clone https://github.com/laserjonas/Truhenblick.git
cd Truhenblick
cp .env.example .env          # bei Bedarf anpassen (Port, Adresse)

# nur die App
docker compose up -d --build

# App und Sync-Backend
docker compose --profile sync up -d --build
```

Die App ist danach unter `http://<Rechner>:<HTTP_PORT>` erreichbar (Standard: Port 80).

- **Konfiguration:** Ports und Grenzen über Umgebungsvariablen in `.env` – siehe die Kommentare in
  [`.env.example`](.env.example). Adresse, Reverse Proxy und Passwort werden in der App eingestellt
  (*Einstellungen → Server*).
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

**Unter welcher Adresse der Server erreichbar ist, stellst du in der App ein:** *Einstellungen → Server →
Erreichbarkeit*. Am Server selbst – Caddy-Datei, `.env` – ist dafür nichts zu ändern. Truhenblick antwortet
auf Port 80 unter jedem Namen, über die IP im Heimnetz genauso wie über den Namen aus dem Proxy.

| Einstellung | wann |
| --- | --- |
| **Nur im Heimnetz** (Standard) | `http://<IP>` – zum Ausprobieren; installieren lässt sich die App so nicht |
| **Über einen Reverse Proxy mit HTTPS** | Nginx Proxy Manager, Traefik, Caddy, Cloudflare-Tunnel … kümmern sich um das Zertifikat |
| **Truhenblick holt das Zertifikat selbst** | ohne Proxy: Die Adresse zeigt direkt auf den Server, Ports 80 und 443 sind aus dem Internet erreichbar |

Ändern können das die Geräte der Truhe, die auf dem Server zuerst angelegt wurde. *Adresse prüfen* zeigt danach,
ob unter `https://<Adresse>` wirklich dieser Server antwortet.

> **Hinweis für Installationen bis Version 0.4:** Die frühere Anleitung, in `/etc/caddy/Caddyfile` die Zeile
> `:80 {` durch die eigene Adresse zu ersetzen, ist überholt – hinter einem Reverse Proxy führte sie in eine
> Umleitungsschleife. `truhenblick-update` erkennt so eine Datei, schreibt sie neu (die alte bleibt als
> `Caddyfile.vor-0.5` liegen) und übernimmt die Adresse in die Einstellungen der App. Bei Docker gehört
> `SITE_ADDRESS` nicht mehr in die `.env`.

### Nginx Proxy Manager

1. In NPM einen **Proxy Host** anlegen:

   | Feld | Wert |
   | --- | --- |
   | Domain Names | `truhe.example.de` |
   | Scheme | `http` (nicht https) |
   | Forward Hostname / IP | IP des Truhenblick-Servers, z. B. `192.168.1.50` |
   | Forward Port | `80` (bei Docker der Wert von `HTTP_PORT`) |
   | Websockets Support | nicht nötig |
   | Block Common Exploits, Cache Assets | beides möglich |
   | SSL | Zertifikat anfordern, *Force SSL* und *HTTP/2* einschalten |

2. In Truhenblick – am einfachsten noch über `http://<IP>` –: *Einstellungen → Server → Über einen Reverse
   Proxy mit HTTPS*, die Adresse eintragen, speichern, *Adresse prüfen*.
3. Die App künftig unter `https://truhe.example.de` öffnen und dort installieren.

Dazu drei Dinge, die gern übersehen werden:

- **Jede Adresse ist für den Browser eine eigene App.** Was ein Gerät unter `http://<IP>` angelegt hat, sieht es
  unter `https://truhe.example.de` zunächst nicht. Dort einmal *Einer Truhe beitreten* und den Code eingeben –
  die Daten kommen vom Server.
- **Die Einstellung „Reverse Proxy“ ist mehr als ein Etikett:** Erst damit rechnet der Server Fehlversuche dem
  einzelnen Gerät zu. Ohne sie sieht er alle Geräte unter der Adresse des Proxys, und zehn falsche Codes eines
  Geräts sperren zehn Minuten lang alle.
- **Aus dem Internet erreichbar?** Dann ein [Passwort festlegen](#anmeldung-mit-passwort).

Andere Proxys brauchen dasselbe: Weiterleitung per HTTP an Port 80 des Servers, der ursprüngliche `Host` bleibt
erhalten, `X-Forwarded-For` und `X-Forwarded-Proto` werden gesetzt. Für Caddy auf einem vorgeschalteten
Rechner steht ein Beispiel in [`deploy/Caddyfile.example`](deploy/Caddyfile.example).

Mit Docker Compose auf demselben Rechner wie der Proxy lauscht Truhenblick am besten nur lokal – in der `.env`:

```ini
HTTP_BIND=127.0.0.1
HTTP_PORT=8080
```

### Truhenblick holt das Zertifikat selbst

Voraussetzung: Die Adresse zeigt per DNS auf den Server, die Ports 80 und 443 sind aus dem Internet erreichbar,
und das Sync-Backend läuft (es entscheidet, für welchen Namen ein Zertifikat geholt wird).

- **Proxmox-LXC, ohne Container:** In der App *Truhenblick holt das Zertifikat selbst* wählen und die Adresse
  eintragen – mehr nicht. Port 443 hält die Installation dafür schon bereit.
- **Docker Compose:** zusätzlich Port 443 freigeben, also mit der Zusatzdatei starten:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.https.yml --profile sync up -d --build
  ```

Das Zertifikat (Let's Encrypt) holt der Server, sobald die Adresse zum ersten Mal über `https://` aufgerufen
wird; das dauert beim ersten Mal ein paar Sekunden. Für jeden anderen Namen lehnt er ab. Wer die App danach
über `http://<Adresse>` öffnet, wird auf `https://` umgeleitet; über die IP bleibt sie per `http://`
erreichbar – so kommt man auch dann heran, wenn mit dem Zertifikat etwas nicht stimmt.

Im Heimnetz ohne öffentliche Adresse hilft ein Reverse Proxy mit eigenem Zertifikat (z. B. per DNS-Challenge)
oder ein Dienst wie Tailscale mit HTTPS-Zertifikaten.

**Ohne Sync-Backend** gibt es keine Einstellungen in der App. Dann übernimmt ein vorgeschalteter Proxy das
Zertifikat, oder die Caddy-Datei wird von Hand gepflegt (erste Zeile löschen, damit Updates sie in Ruhe lassen).

## Anmeldung mit Passwort

Ohne Passwort kann jeder, der die Adresse kennt, die App öffnen und eine eigene, leere Truhe anlegen – an eure
Truhe kommt er trotzdem nur mit ihrem Code. Für einen Server, der aus dem Internet erreichbar ist, empfiehlt sich
zusätzlich die Anmeldung:

1. *Einstellungen → Server → Anmeldung*: Passwort eintragen (mindestens acht Zeichen), *Anmeldung einschalten*.
2. Jedes andere Gerät zeigt beim nächsten Öffnen die Loginmaske und bleibt nach der Anmeldung angemeldet.

- **Was geschützt ist:** der Server. Ohne Anmeldung beantwortet er nur noch die Frage, ob eine Anmeldung nötig
  ist – kein Abgleich, keine neue Truhe, keine Einstellungen, auch nicht mit dem richtigen Code.
- **Was nicht:** Die App selbst lädt weiterhin jeder (sie enthält keine Daten), und was schon auf einem Gerät
  gespeichert ist, bleibt dort lesbar – auch offline. Die Anmeldung ist kein Geräteschutz.
- **Wie lange:** Ein Gerät bleibt angemeldet, solange es die App mindestens alle 90 Tage benutzt. *Abmelden*
  meldet das eigene Gerät ab, *Alle anderen Geräte abmelden* den Rest; eine Passwortänderung meldet alle
  anderen ab.
- **Durchprobieren:** Nach zehn falschen Passwörtern ist eine Adresse zehn Minuten gesperrt, nach dreißig von
  beliebigen Adressen die Anmeldung insgesamt. Angemeldete Geräte merken davon nichts.
- **Home Assistant** fragt weiter mit seinem Lese-Schlüssel ab und braucht kein Passwort.
- **Gespeichert** ist auf dem Server nur eine Prüfsumme des Passworts (scrypt).
- **Wer darf das einstellen?** Die Geräte der zuerst angelegten Truhe. Richte den Server deshalb ein und lege
  das Passwort fest, **bevor** du ihn aus dem Internet erreichbar machst.

**Passwort vergessen und kein Gerät mehr angemeldet?** Auf dem Server:

```bash
# Proxmox-LXC / ohne Container (vom Proxmox-Host: pct exec <ID> -- truhenblick-anmeldung-aus)
truhenblick-anmeldung-aus

# Docker Compose
docker compose exec api node server/src/index.ts --anmeldung-aus
```

Danach ist die Anmeldung abgeschaltet; ein neues Passwort legst du wieder in der App fest. Truhen, Daten und
Codes bleiben unberührt.

## Updates

| Installation | Update |
| --- | --- |
| Proxmox-LXC, ohne Container | **in der App:** *Einstellungen → Aktualisierung* – oder auf dem Server `truhenblick-update` (vom Proxmox-Host: `pct exec <ID> -- truhenblick-update`) |
| Docker Compose | `git pull && docker compose --profile sync up -d --build`, danach in der App *Nach Updates suchen* |

### In der App

Unter *Einstellungen → Aktualisierung* gibt es zwei Dinge:

- **Diese App:** *Nach Updates suchen* prüft, ob auf dem Server eine neuere App liegt als die geladene, und lädt
  sie mit *App neu laden*. Das funktioniert überall, auch bei Docker und über `http://`.
- **Server:** Gehört das Gerät zur zuerst angelegten Truhe des Servers, zeigt die App, ob es eine neue Version gibt, und
  aktualisiert den Server mit *Jetzt aktualisieren* – derselbe Ablauf wie `truhenblick-update`, inklusive
  Sicherung der Datenbank. Scheitert das Update, läuft die bisherige Version weiter, und die App zeigt das
  Protokoll.

Wie das abgesichert ist: Das Backend läuft ohne besondere Rechte und führt das Update nicht selbst aus. Es legt
nur eine Anfragedatei ab; ein eigener systemd-Dienst (`truhenblick-update.path` / `.service`) startet daraufhin
als root immer denselben Befehl – aus der Anfrage wird nichts übernommen. Anstoßen können es nur die Geräte
der zuerst angelegten Truhe (der des Betreibers). Geholt wird, was im eingestellten Repository und Zweig liegt
(`TB_REPO`, `TB_BRANCH` in `/etc/truhenblick/install.conf`).

Wer das nicht möchte, schaltet es ab – in `/etc/truhenblick/install.conf` `TB_APP_UPDATE=0` eintragen und einmal
`truhenblick-update --force` ausführen. Bei Docker gibt es die Funktion nicht: Ein Container kann sich nicht
selbst neu bauen.

### Auf dem Server

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

Der Abgleich ist optional; ohne ihn arbeitet die App vollständig lokal. Mit dem Sync-Backend sehen mehrere Geräte
dieselbe Truhe.

### So geht es

1. **Erstes Gerät:** Die App öffnen und im Startassistenten **Truhe anlegen**. Läuft auf dem Server das
   Sync-Backend, entsteht dabei ein Code (Form `k7m2-9xqp-4hrt-w3vn-8dzj`), den die App groß anzeigt.
2. **Jedes weitere Gerät:** Im Startassistenten **Einer Truhe beitreten** wählen und den Code eingeben – die
   Truhe erscheint von selbst.

Mehr ist nicht nötig; auf dem Server muss dafür nichts eingestellt werden.

- **Schon eine Truhe auf dem Gerät?** Unter *Einstellungen → Abgleich zwischen Geräten* gibt *Truhe freigeben*
  sie nachträglich frei (auch dabei entsteht der Code) – oder das Gerät tritt mit einem Code einer vorhandenen
  Truhe bei; was es schon eingetragen hat, kommt dann dazu.
- **Code vergessen?** Jedes verbundene Gerät zeigt ihn unter *Einstellungen → Abgleich zwischen Geräten →
  Code anzeigen*.
- **Code weitergegeben, der nicht mehr gelten soll?** *Neuen Code erzeugen*: Der bisherige gilt sofort nicht
  mehr. Die anderen Geräte fragen beim nächsten Abgleich nach dem neuen und gleichen danach normal weiter ab;
  ihre Daten bleiben erhalten.
- **Trennen:** Das Gerät vergisst den Code (die App zeigt ihn vorher noch einmal an). Die Truhe bleibt auf dem
  Server, die Daten bleiben auf dem Gerät.

### Wie es funktioniert

- **Truhe und Code gehören zusammen:** Ein Server kann mehrere Truhen aufnehmen, jede mit eigenem Code und
  eigenen Daten. Der Code ist zugleich Ausweis und Angabe, um welche Truhe es geht. Auf dem Server liegt nur
  seine Prüfsumme.
- **Offline-first:** Jede Änderung wird sofort lokal gespeichert und übertragen, sobald der Server erreichbar
  ist – beim Start, nach Änderungen, wenn das Gerät wieder online ist und regelmäßig im Vordergrund.
- **Konflikte:** Ändern zwei Geräte denselben Artikel, gewinnt die **spätere Änderung** (Zeitstempel
  `geaendertAm`). Das gilt für den ganzen Artikel, nicht feldweise. Die Uhren der Geräte sollten deshalb
  ungefähr stimmen.
- **Schnittstelle:** `GET /api/health` und `POST /api/truhen` ohne Code; mit dem Code als
  `Authorization: Bearer …`: `POST /api/sync`, `POST /api/code`, `GET`/`POST /api/update`,
  `GET`/`POST`/`DELETE /api/lesezugang`, `GET`/`POST /api/server`, `POST /api/passwort`,
  `DELETE /api/sitzungen`. `GET /api/uebersicht` geht auch mit dem Lese-Schlüssel
  (siehe [Home Assistant](#home-assistant)). Verlangt der Server ein Passwort, braucht alles außer
  `/api/health`, `/api/anmelden` und `/api/uebersicht` zusätzlich die Kennung der Anmeldung
  (`X-Truhenblick-Sitzung`, von `POST /api/anmelden`).

### Wer darf was?

- **Eine neue Truhe anlegen** kann jeder, der den Server erreicht – ohne Anmeldung, denn sonst bräuchte man
  schon vor der ersten Truhe einen Code. An eine *vorhandene* Truhe kommt man nur mit ihrem Code.
  Begrenzt ist das auf zehn Truhen je Server und fünf neue pro Stunde und Adresse.
  **Für Server, die aus dem Internet erreichbar sind:** ein [Passwort festlegen](#anmeldung-mit-passwort) –
  dann geht ohne Anmeldung gar nichts mehr – oder nach dem Anlegen der eigenen Truhe `NEUE_TRUHEN=aus` setzen
  (siehe unten).
- **Einer Truhe beitreten, sie lesen und ändern, ihren Code erneuern:** jedes Gerät mit ihrem Code. Nach zehn
  falschen Codes ist eine Adresse zehn Minuten gesperrt. Der Code gehört nur über HTTPS ins Internet.
- **Den Server aus der App aktualisieren, seine Adresse und das Passwort einstellen:** nur die Geräte der
  **zuerst angelegten** Truhe – sonst könnte jeder mit einer eigenen Truhe Updates auslösen oder alle aussperren.

### Einstellungen des Backends

Umgebungsvariablen – im Proxmox-Container in `/etc/truhenblick/server.env` (danach
`systemctl restart truhenblick-server`), bei Docker in der `.env`:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `NEUE_TRUHEN` | `an` | `aus`: In der App lassen sich keine neuen Truhen mehr anlegen; vorhandene bleiben nutzbar |
| `MAX_TRUHEN` | `10` | Höchstzahl der Truhen auf diesem Server |
| `SYNC_TOKEN` | – | freiwillig: Zugangscode der zuerst angelegten Truhe (mindestens 16 Zeichen) |
| `PORT` | `3000` | Port |
| `HOST` | `0.0.0.0` | Adresse, auf der gelauscht wird |
| `DATA_DIR` | `./data` | Verzeichnis der SQLite-Datenbank |
| `CORS_ORIGIN` | – | nur nötig, wenn die App von einer anderen Adresse geladen wird als das Backend |
| `START_ADRESSE`, `START_ERREICHBARKEIT` | – | Startwerte für *Einstellungen → Server* (`heimnetz`, `proxy` oder `selbst`); sie gelten nur, solange in der App noch nichts eingestellt wurde |

**Kennt kein Gerät mehr den Code der ersten Truhe**, setzt du ihn von der Serverseite zurück: bei `SYNC_TOKEN`
einen **neuen** Wert eintragen und den Dienst neu starten. Ein geänderter `SYNC_TOKEN` hat Vorrang vor einem
in der App erzeugten Code; die Daten der Truhe bleiben erhalten. Für weitere Truhen gibt es diesen Weg nicht.

**Von Version 0.2 kommend:** Der bisherige einzige Datenbestand wird beim ersten Start zur ersten Truhe, mit
demselben Code. Verbundene Geräte gleichen ohne Unterbrechung weiter ab.

## Home Assistant

Home Assistant kann anzeigen, was in der Truhe bald abläuft – als Karte im Dashboard, als Zahl in einer Kachel
oder als Auslöser für eine Erinnerung. Voraussetzung ist das Sync-Backend mit einer freigegebenen Truhe, denn
Home Assistant fragt den Server ab, nicht das Handy. In Home Assistant selbst wird nichts installiert; es genügt
die eingebaute [RESTful-Integration](https://www.home-assistant.io/integrations/rest/).

### Einrichten

1. **In der App:** *Einstellungen → Home Assistant → Für Home Assistant einrichten*. Dabei entsteht ein
   **Lese-Schlüssel**, und die App zeigt drei fertige Textblöcke zum Kopieren. Im Feld darüber steht die
   Adresse, unter der Home Assistant den Truhenblick-Server erreicht – bei Bedarf anpassen (im Heimnetz z. B.
   `http://192.168.1.50`; `localhost` funktioniert nicht, das wäre Home Assistant selbst).
2. **`secrets.yaml`** von Home Assistant: den ersten Block eintragen.

   ```yaml
   truhenblick_zugang: "Bearer lese-k7m2-9xqp-4hrt-w3vn-8dzj"
   ```

3. **`configuration.yaml`:** den zweiten Block einfügen. Gibt es dort schon einen Abschnitt `rest:`, dann nur
   die Zeilen ab `- resource:` anhängen.

   ```yaml
   rest:
     - resource: "http://192.168.1.50/api/uebersicht?zeitzone=Europe%2FBerlin"
       headers:
         Authorization: !secret truhenblick_zugang
       scan_interval: 600
       timeout: 20
       sensor:
         - name: "Truhenblick aufbrauchen"
           unique_id: truhenblick_aufbrauchen
           icon: mdi:fridge-alert-outline
           unit_of_measurement: "Artikel"
           value_template: "{{ value_json.faellig }}"
           availability: "{{ value_json is defined and value_json.faellig is defined }}"
           json_attributes:
             - liste
             - text
             - naechster
             - gekuerzt
         - name: "Truhenblick abgelaufen"
           unique_id: truhenblick_abgelaufen
           icon: mdi:alert-circle-outline
           unit_of_measurement: "Artikel"
           value_template: "{{ value_json.ueberfaellig }}"
           availability: "{{ value_json is defined and value_json.faellig is defined }}"
         - name: "Truhenblick Artikel"
           unique_id: truhenblick_artikel
           icon: mdi:fridge-outline
           unit_of_measurement: "Artikel"
           value_template: "{{ value_json.artikel }}"
           availability: "{{ value_json is defined and value_json.faellig is defined }}"
   ```

   Die Zeilen `availability:` sorgen dafür, dass die Sensoren „nicht verfügbar“ zeigen, wenn der Server nicht
   antwortet oder den Schlüssel ablehnt – ohne sie blieben in Home Assistant die alten Werte stehen.

4. **Home Assistant neu starten.** Danach gibt es drei Sensoren, die alle zehn Minuten aktualisiert werden:

   | Sensor | Wert |
   | --- | --- |
   | `sensor.truhenblick_aufbrauchen` | Anzahl der Artikel, die bald ablaufen oder schon überfällig sind. Attribute: `liste` (die Artikel, Dringendes zuerst), `text` (z. B. „3 bald fällig, 2 überfällig“), `naechster`, `gekuerzt` |
   | `sensor.truhenblick_abgelaufen` | Anzahl der überfälligen Artikel |
   | `sensor.truhenblick_artikel` | Anzahl aller Artikel in der Truhe |

5. **Dashboard:** *Karte hinzufügen → Manuell* und den dritten Block einfügen. Die Karte listet, was zuerst weg
   sollte, mit Menge, Restzeit und Platz in der Truhe:

   ```yaml
   type: markdown
   title: Gefriertruhe
   content: |-
     {% set liste = state_attr('sensor.truhenblick_aufbrauchen', 'liste') %}
     {% if liste is none %}
     Truhenblick ist gerade nicht erreichbar.
     {% elif liste | count == 0 %}
     ✅ Nichts läuft demnächst ab.
     {% else %}
     {% for a in liste %}
     - {{ '⚠️' if a.status == 'ueberfaellig' else '⏳' }} {{ a.emoji }} **{{ a.name }}** · {{ a.menge }} · {{ a.text }} · _{{ a.ort }}_
     {% endfor %}
     {% if state_attr('sensor.truhenblick_aufbrauchen', 'gekuerzt') %}… und weitere{% endif %}
     {% endif %}
   ```

   Das ergibt zum Beispiel:

   > - ⚠️ 🍲 **Lasagne** · 2 Portionen · 5 Tage überfällig · _Mitte › Links_
   > - ⏳ 🌭 **Bratwürste** · 8 Stück · noch 5 Tage · _Korb links_
   > - ⏳ 🐟 **Lachsfilet** · 400 g · noch 15 Tage · _Oben › Links_

Die Sensoren lassen sich wie alle anderen verwenden. Eine tägliche Erinnerung könnte so aussehen
(`notify.notify` durch den eigenen Benachrichtigungsdienst ersetzen):

```yaml
automation:
  - alias: "Gefriertruhe: Erinnerung ans Aufbrauchen"
    triggers:
      - trigger: time
        at: "17:00:00"
    conditions:
      - condition: numeric_state
        entity_id: sensor.truhenblick_aufbrauchen
        above: 0
    actions:
      - action: notify.notify
        data:
          title: "Gefriertruhe"
          message: "{{ state_attr('sensor.truhenblick_aufbrauchen', 'text') }}"
```

### Der Lese-Schlüssel

- Er öffnet **nur die Übersicht dieser einen Truhe** – ändern, den Zugangscode erneuern oder den Server
  aktualisieren kann man damit nicht. Deshalb bekommt Home Assistant ihn und nicht den Zugangscode.
- Je Truhe gibt es einen. *Neuen Schlüssel erzeugen* macht den bisherigen sofort ungültig, *Zugang widerrufen*
  schaltet die Abfrage ab; der Sensor zeigt dann „nicht verfügbar“.
- Anzeigen kann ihn nur das Gerät, das ihn erzeugt hat – auf dem Server liegt nur seine Prüfsumme. Andere
  Geräte sehen, dass es einen gibt, und können ihn ersetzen oder widerrufen.
- Im Heimnetz genügt `http://`. Fragt Home Assistant über das Internet ab, gehört der Schlüssel nur über HTTPS
  auf die Reise.
- Durchprobieren wird gebremst wie beim Zugangscode: Nach zehn falschen Versuchen ist eine Adresse zehn
  Minuten gesperrt.

### Die Abfrage

`GET /api/uebersicht` mit `Authorization: Bearer <Lese-Schlüssel>` (der Zugangscode der Truhe geht ebenfalls):

| Parameter | Standard | Bedeutung |
| --- | --- | --- |
| `zeitzone` | Zeitzone des Servers | bestimmt, welcher Tag „heute“ ist, z. B. `Europe/Berlin` |
| `tage` | `30` | ab so vielen Resttagen gilt ein Artikel als „bald fällig“ |
| `limit` | `20` | Höchstzahl der Einträge in `liste` (höchstens 200) |

```bash
curl -H "Authorization: Bearer lese-…" "http://192.168.1.50/api/uebersicht?zeitzone=Europe/Berlin&tage=14"
```

```json
{
  "stand": "2026-10-10T12:28:41.512Z",
  "heute": "2026-10-10",
  "schwelle_tage": 14,
  "artikel": 16,
  "frisch": 13,
  "bald": 1,
  "ueberfaellig": 2,
  "faellig": 3,
  "text": "1 bald fällig, 2 überfällig",
  "naechster": { "name": "Brötchen", "…": "…" },
  "liste": [
    {
      "name": "Lasagne",
      "emoji": "🍲",
      "kategorie": "fertig",
      "menge": "2 Portionen",
      "ort": "Mitte › Links",
      "haltbar_bis": "2026-10-05",
      "tage": -5,
      "status": "ueberfaellig",
      "text": "5 Tage überfällig"
    }
  ],
  "gekuerzt": false
}
```

Home Assistant speichert Attribute nur bis 16 kB im Verlauf. Mit dem Standard von 20 Einträgen bleibt die Liste
weit darunter; wer `limit` deutlich erhöht, sollte das im Blick behalten.

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
| Datenlogik der App | `npm test` | Datum und Haltbarkeit, Vorschläge, Suche, Truhenstruktur, Konfliktregel, Datenbankoperationen, Backup, Sync-Client, Anmeldung, Übersicht und Konfiguration für Home Assistant |
| Sync-Backend | `cd server && npm test` | Zugangscodes, Eingabeprüfung, Abgleich und Konflikte, Lese-Schlüssel und Übersicht, Anmeldung mit Passwort, Adresse und Erreichbarkeit, Sperren hinter einem Reverse Proxy – gegen eine SQLite-Datenbank im Speicher |
| Proxmox-Skript | `npm run test:install` | Optionen, Rückfragen, Prüfungen und Aufräumen nach Fehlern – mit nachgebildeten Proxmox-Befehlen |

## Stand der Prüfungen

Was bisher wie geprüft wurde (Stand: Version 0.5.0):

- **App:** automatisierte Tests sowie Durchläufe im Browser (Chrome, Handy- und Desktop-Breite, hell und dunkel)
  einschließlich Offline-Betrieb und Update-Hinweis am Produktions-Build.
- **Truhe anlegen, beitreten, abgleichen:** Ende-zu-Ende mit drei getrennten Browsern gegen das lokal gestartete
  Backend und gegen den Docker-Stack: anlegen mit Code, beitreten mit falschem und richtigem Code, Abgleich in
  beide Richtungen, eine zweite Truhe bleibt getrennt, trennen und neu freigeben. Im Proxmox-Container wurden
  dieselben Abläufe über die Schnittstelle geprüft, nicht über die App.
- **Update von 0.2 auf 0.3:** im Proxmox-Container gelaufen – der bisherige Datenbestand wurde zur ersten Truhe,
  mit gleicher Kennung, gleichem Stand und dem bisherigen Code.
- **Proxmox-Skript:** auf einem echten Host getestet (Proxmox VE 9.2, Debian-12-Template, unprivilegierter
  Container): ohne Rückfragen, mit Rückfragen im Terminal und über die whiptail-Dialoge; DHCP und statische IP;
  mit und ohne Sync-Backend; Abbruch durch Fehler und durch Strg+C mit anschließendem Aufräumen.
  `truhenblick-update` wurde dort mit echten neuen Versionen, mit eigenen Anpassungen an den Quellen und über
  `pct exec` geprüft. **Nicht** getestet: privilegierte Container, VLAN-Tags, andere Storage-Typen als LVM-Thin,
  Proxmox VE 8 und ältere.
- **Code erneuern und Aktualisierung in der App:** im Browser mit zwei Geräten durchgespielt (Code anzeigen,
  neu erzeugen, auf dem zweiten Gerät eingeben; Update anstoßen, Fortschritt, Neuladen, Fehlschlag mit
  Protokoll). Das Update über die Schnittstelle lief auch im Proxmox-Container: erfolgreich (rund 20 Sekunden),
  mit einem absichtlich fehlschlagenden Lauf, mit mehreren gleichzeitigen Anfragen und mit der Prüfung, dass
  nur die erste Truhe es anstoßen darf. Die Bedienung in der App wurde dabei gegen ein Backend mit
  nachgestelltem Update-Dienst geprüft, nicht gegen den Container.
- **Home Assistant:** Der Lese-Schlüssel wurde in der App erzeugt, widerrufen und neu erzeugt (der alte wird
  danach abgewiesen). Die erzeugte Konfiguration lief unverändert in einem echten Home Assistant (2026.10, als
  Container neben dem Docker-Stack): Die drei Sensoren zeigten die erwarteten Werte samt Liste, die Vorlage der
  Karte ergab die erwarteten Zeilen, die Konfigurationsprüfung von Home Assistant meldete nichts. Auch die
  Störfälle liefen dort: Schlüssel widerrufen, Server aus, nur das Backend aus – die Sensoren wurden jeweils
  „nicht verfügbar“ und erholten sich danach von selbst (dafür mit 15 Sekunden statt zehn Minuten Abstand
  zwischen den Abfragen). **Nicht** geprüft: die Karte in einem echten Dashboard (nur ihre Vorlage), das
  Beispiel für die Erinnerung und Home Assistant OS mit einem Truhenblick im Proxmox-Container.
- **Hinter Nginx Proxy Manager:** mit dem echten NPM-Image geprüft – der Proxy-Host nach dessen eigener
  Vorlage, alle Schalter an (Cache Assets, Block Common Exploits, Force SSL, HTTP/2, HSTS), dahinter der
  Docker-Stack. Drei Browser: Truhe anlegen, beitreten, Abgleich in beide Richtungen, Service Worker aktiv.
  Nachgestellt wurde auch der frühere Fehler (Adresse in der Caddy-Datei → Umleitungsschleife). Der Proxy-Host
  wurde dabei als Datei angelegt, nicht über die Oberfläche von NPM; das Zertifikat war selbst ausgestellt.
  **Nicht** geprüft: Traefik, Cloudflare-Tunnel und andere Proxys.
- **Adresse, Erreichbarkeit und Anmeldung:** im Browser durchgespielt – ein Gerät direkt am Server, zwei über
  NPM: Adresse einstellen und prüfen, Passwort festlegen, Loginmaske mit falschem und richtigem Passwort,
  beitreten und abgleichen, andere Geräte abmelden, Passwort ändern, abmelden, Anmeldung abschalten, offline
  weiterarbeiten. Dass Sperren hinter NPM nur das einzelne Gerät treffen, wurde über die Schnittstelle geprüft.
- **Zertifikat selbst holen:** mit einer lokalen Test-Zertifizierungsstelle (Pebble, die Testfassung von Let's
  Encrypt) und echten ACME-Prüfungen, jeweils mit Caddy 2.11 (Docker-Image) und Caddy 2.6.2 (Debian 12, wie im
  Proxmox-Container): Ein Zertifikat gibt es nur bei „selbst“ und nur für die eingestellte Adresse; Port 80
  bleibt ohne Umleitung erreichbar. **Nicht** geprüft: das Abholen eines echten Zertifikats von Let's Encrypt
  und die Umleitung der App von `http://` auf `https://` im Browser (nur ihre Entscheidungslogik).
- **Update von 0.4 auf 0.5 im Proxmox-Container:** gelaufen mit einer nach der alten Anleitung von Hand
  geänderten Caddy-Datei – sie wurde erkannt, neu geschrieben und die Adresse übernommen; die Truhe blieb
  erhalten. `truhenblick-anmeldung-aus` lief dort nur ohne gesetztes Passwort (mit Passwort: im Docker-Stack).
- **Docker:** beide Images gebaut und als Compose-Stack gestartet (nur App, mit Sync-Backend, mit der
  Zusatzdatei für Port 443 – auch mit einer alten `.env`, aus der `SITE_ADDRESS` übernommen wird), Daten
  überstehen einen Neustart. `--anmeldung-aus` lief dort mit gesetztem Passwort. ARM64 wurde unter Emulation
  gebaut und gestartet (zuletzt mit Version 0.4), **nicht** auf einem echten Raspberry Pi.
- **Ohne Container** (`container-setup.sh` direkt auf einem Server): nur im Proxmox-Container gelaufen,
  nicht auf Ubuntu.
- **iOS und Android:** noch nicht auf echten Geräten ausprobiert. Eigene iOS-Startbilder (Splash-Images) gibt es
  nicht – beim Start zeigt iOS kurz eine einfarbige Fläche.

Rückmeldungen zu diesen Punkten sind willkommen.
