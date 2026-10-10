import { describe, expect, it } from 'vitest';
import { HA_SECRET, HA_SENSOREN, haKonfiguration } from './homeAssistant.ts';

const k = haKonfiguration({ adresse: 'http://192.168.178.123/', schluessel: 'lese-k7m2-9xqp-4hrt-w3vn-8dzj', zeitzone: 'Europe/Berlin' });

describe('haKonfiguration', () => {
  it('legt den Schlüssel in secrets.yaml ab, nicht in der Konfiguration', () => {
    expect(k.secrets).toBe('truhenblick_zugang: "Bearer lese-k7m2-9xqp-4hrt-w3vn-8dzj"');
    expect(k.konfiguration).toContain(`Authorization: !secret ${HA_SECRET}`);
    expect(k.konfiguration).not.toContain('lese-k7m2');
    expect(k.karte).not.toContain('lese-k7m2');
  });

  it('fragt die Übersicht mit der Zeitzone des Haushalts ab', () => {
    expect(k.konfiguration).toContain('resource: "http://192.168.178.123/api/uebersicht?zeitzone=Europe%2FBerlin"');
  });

  it('legt drei Sensoren mit festen Kennungen an', () => {
    for (const id of ['truhenblick_aufbrauchen', 'truhenblick_abgelaufen', 'truhenblick_artikel']) {
      expect(k.konfiguration).toContain(`unique_id: ${id}`);
    }
    // Die Namen ohne Umlaute ergeben in Home Assistant genau diese Kennungen.
    expect(Object.values(HA_SENSOREN)).toEqual(['sensor.truhenblick_aufbrauchen', 'sensor.truhenblick_abgelaufen', 'sensor.truhenblick_artikel']);
    expect(k.konfiguration).toMatch(/name: "Truhenblick aufbrauchen"/);
  });

  it('gibt die Liste als Attribut weiter und zeigt sie in der Karte', () => {
    expect(k.konfiguration).toMatch(/json_attributes:\n\s+- liste/);
    expect(k.karte).toContain(`state_attr('${HA_SENSOREN.aufbrauchen}', 'liste')`);
    expect(k.karte).toContain('{{ a.name }}');
  });

  it('meldet die Sensoren als nicht verfügbar, wenn die Antwort keine Übersicht ist', () => {
    // Home Assistant wertet den Statuscode nicht aus – ohne die Prüfung blieben alte Werte stehen.
    const pruefungen = k.konfiguration.match(/availability: "\{\{ value_json is defined and value_json\.faellig is defined \}\}"/g);
    expect(pruefungen).toHaveLength(3);
  });

  it('gibt nichts weiter, was sich bei jeder Abfrage ändert', () => {
    // Ein Attribut wie „stand“ würde alle zehn Minuten einen neuen Eintrag im Verlauf erzeugen.
    expect(k.konfiguration).not.toMatch(/- stand/);
  });

  it('erzeugt gültig eingerücktes YAML ohne Tabulatoren', () => {
    for (const text of [k.secrets, k.konfiguration, k.karte]) expect(text).not.toMatch(/\t/);
    expect(k.konfiguration.split('\n')[0]).toBe('rest:');
    expect(k.karte.split('\n')[0]).toBe('type: markdown');
  });
});
