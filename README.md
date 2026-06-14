# HAOS Market Scan Add-on Paket

Dieses Paket enthält ein lokales Home-Assistant-Add-on für den privaten Aktien-Scanner.

## Inhalt

```text
haos-market-scan-addon/
├─ repository.yaml
├─ market_scan/
│  ├─ config.yaml
│  ├─ Dockerfile
│  ├─ run.sh
│  ├─ package.json
│  ├─ README.md
│  ├─ rootfs/app/server.mjs
│  └─ public/
│     ├─ index.html
│     ├─ app.js
│     └─ styles.css
└─ examples/
   └─ android-api-client.js
```

## Schnellstart

1. Dieses Paket muss für den Add-on Store als Git-Repository erreichbar sein. Die Repository-URL in Home Assistant muss auf ein echtes Git-Remote zeigen, nicht auf `https://homeassistant.local/...`.
2. Wenn du es nur lokal testen willst, kopiere `market_scan` nach `/addons/market_scan` auf HAOS.
3. In Home Assistant: Einstellungen → Add-ons → Add-on Store → Lokale Add-ons neu laden.
4. `Market Scan` installieren.
5. In der Add-on-Konfiguration `api_token` ändern.
6. Starten.
7. UI öffnen oder vom Handy: `http://homeassistant.local:8099`.

Details stehen in `market_scan/README.md`.
