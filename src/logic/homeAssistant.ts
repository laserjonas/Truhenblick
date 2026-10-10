/**
 * Erzeugt die Konfiguration, mit der Home Assistant die Übersicht einer Truhe abruft.
 * Genutzt wird die eingebaute RESTful-Integration – in Home Assistant muss nichts installiert werden.
 */

export interface HaAngaben {
  /** Adresse des Truhenblick-Servers, wie Home Assistant ihn erreicht (ohne Schrägstrich am Ende) */
  adresse: string;
  /** Lese-Schlüssel der Truhe */
  schluessel: string;
  /** Zeitzone des Haushalts, z. B. „Europe/Berlin“ – bestimmt, welcher Tag „heute“ ist */
  zeitzone: string;
}

export interface HaKonfiguration {
  /** Zeile für secrets.yaml */
  secrets: string;
  /** Block für configuration.yaml */
  konfiguration: string;
  /** Karte fürs Dashboard (Karte hinzufügen → Manuell) */
  karte: string;
}

/** Name des Eintrags in secrets.yaml */
export const HA_SECRET = 'truhenblick_zugang';

/** Die Sensoren, die die Konfiguration anlegt (für Karten und Automationen). */
export const HA_SENSOREN = {
  aufbrauchen: 'sensor.truhenblick_aufbrauchen',
  abgelaufen: 'sensor.truhenblick_abgelaufen',
  artikel: 'sensor.truhenblick_artikel',
} as const;

export function haKonfiguration({ adresse, schluessel, zeitzone }: HaAngaben): HaKonfiguration {
  const quelle = `${adresse.replace(/\/+$/, '')}/api/uebersicht?zeitzone=${encodeURIComponent(zeitzone)}`;

  const secrets = `${HA_SECRET}: "Bearer ${schluessel}"`;

  // Home Assistant wertet den Statuscode der Antwort nicht aus. Ohne diese Prüfung blieben nach einem
  // widerrufenen Schlüssel (401) die alten Werte stehen – so werden die Sensoren „nicht verfügbar“.
  const verfuegbar = '{{ value_json is defined and value_json.faellig is defined }}';

  // Die Namen kommen ohne Umlaute aus, damit Home Assistant daraus vorhersehbare Kennungen bildet
  // (sensor.truhenblick_aufbrauchen usw.).
  const konfiguration = `rest:
  - resource: "${quelle}"
    headers:
      Authorization: !secret ${HA_SECRET}
    scan_interval: 600
    timeout: 20
    sensor:
      - name: "Truhenblick aufbrauchen"
        unique_id: truhenblick_aufbrauchen
        icon: mdi:fridge-alert-outline
        unit_of_measurement: "Artikel"
        value_template: "{{ value_json.faellig }}"
        availability: "${verfuegbar}"
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
        availability: "${verfuegbar}"
      - name: "Truhenblick Artikel"
        unique_id: truhenblick_artikel
        icon: mdi:fridge-outline
        unit_of_measurement: "Artikel"
        value_template: "{{ value_json.artikel }}"
        availability: "${verfuegbar}"`;

  const karte = `type: markdown
title: Gefriertruhe
content: |-
  {% set liste = state_attr('${HA_SENSOREN.aufbrauchen}', 'liste') %}
  {% if liste is none %}
  Truhenblick ist gerade nicht erreichbar.
  {% elif liste | count == 0 %}
  ✅ Nichts läuft demnächst ab.
  {% else %}
  {% for a in liste %}
  - {{ '⚠️' if a.status == 'ueberfaellig' else '⏳' }} {{ a.emoji }} **{{ a.name }}** · {{ a.menge }} · {{ a.text }} · _{{ a.ort }}_
  {% endfor %}
  {% if state_attr('${HA_SENSOREN.aufbrauchen}', 'gekuerzt') %}… und weitere{% endif %}
  {% endif %}`;

  return { secrets, konfiguration, karte };
}
