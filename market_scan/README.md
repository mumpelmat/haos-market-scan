# Market Scan Home Assistant Add-on

Privates HAOS-Add-on für KI-gestützte Aktien-Scans mit Claude und Telegram-Benachrichtigung.

## Funktionen

- Eigene Weboberfläche im Home Assistant
- Lokale API für Handy/Android-App unter Port `8099`
- Swing- und Fundamental-Scan
- DAX 40, S&P 500 Top 20, Nasdaq Top 20, Trade Republic Top 50
- Eigene Watchlist
- Täglicher Scan nach Uhrzeit und Zeitzone
- Optional nur werktags
- Telegram-Testnachricht
- Telegram-Benachrichtigung nur bei Signalen
- Persistente Speicherung unter `/data/settings.json`

## Installation auf HAOS

1. HAOS: Advanced SSH & Web Terminal oder Samba installieren.
2. Für den Add-on Store muss das Repository über eine echte Git-URL erreichbar sein. Ein lokaler Pfad wie `https://homeassistant.local/config/addons/...` funktioniert dafür nicht.
3. Wenn du nur lokal testen willst, den Ordner `market_scan` nach `/addons/market_scan` kopieren.
4. Home Assistant öffnen.
5. Einstellungen → Add-ons → Add-on Store.
6. Rechts oben `…` → Nach Updates suchen / Add-on Store neu laden.
7. Bereich „Lokale Add-ons“ öffnen.
8. `Market Scan` installieren.
9. In der Add-on-Konfiguration den `api_token` ändern, z. B. auf einen langen Zufallswert.
10. Add-on starten.
11. Web UI öffnen oder lokal aufrufen: `http://homeassistant.local:8099`.

## Android-App / Handy-Zugriff

Wenn du vom Handy aus direkt zugreifen willst:

- URL: `http://homeassistant.local:8099`
- API-Token: der Wert aus der Add-on-Konfiguration `api_token`

Die API akzeptiert den Token über Header:

```http
x-market-scan-token: DEIN_TOKEN
```

oder:

```http
Authorization: Bearer DEIN_TOKEN
```

## API-Endpunkte

```text
GET  /api/health
GET  /api/ticker-lists
GET  /api/settings
POST /api/settings
POST /api/test-telegram
POST /api/run-scan
POST /api/trigger
GET  /api/progress
GET  /api/results/latest
```

`POST /api/trigger` kann von Home-Assistant-Automationen oder deiner Android-App ausgelöst werden.

Beispiel:

```bash
curl -X POST http://homeassistant.local:8099/api/trigger \
  -H "x-market-scan-token: DEIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"wait":false,"reason":"HA Automation"}'
```

## Home Assistant REST Command optional

In `configuration.yaml`:

```yaml
rest_command:
  market_scan_trigger:
    url: "http://a0d7b954-market_scan:8080/api/trigger"
    method: POST
    headers:
      x-market-scan-token: "DEIN_TOKEN"
      content-type: "application/json"
    payload: '{"wait":false,"reason":"Home Assistant Automation"}'
```

Die interne Add-on-Adresse kann je nach Installation abweichen. Einfacher ist der externe Port:

```yaml
rest_command:
  market_scan_trigger:
    url: "http://homeassistant.local:8099/api/trigger"
    method: POST
    headers:
      x-market-scan-token: "DEIN_TOKEN"
      content-type: "application/json"
    payload: '{"wait":false,"reason":"Home Assistant Automation"}'
```

## Hinweise

- Die App ist für private Nutzung gedacht.
- API-Keys liegen lokal auf deinem HAOS-Gerät in `/data/settings.json`.
- Keine Anlageberatung.
- Ein Scan mit vielen Tickern erzeugt viele Claude-API-Aufrufe und Kosten.
