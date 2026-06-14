// Beispiel: Anbindung deiner Android/Capacitor-App an das HAOS-Add-on.
// In Capacitor kannst du wahlweise fetch oder CapacitorHttp verwenden.

const HAOS_MARKET_SCAN_URL = "http://homeassistant.local:8099";
const MARKET_SCAN_TOKEN = "DEIN_TOKEN_AUS_DER_ADDON_CONFIG";

async function saveMarketScanSettings(settings) {
  const response = await fetch(`${HAOS_MARKET_SCAN_URL}/api/settings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-market-scan-token": MARKET_SCAN_TOKEN
    },
    body: JSON.stringify(settings)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function triggerMarketScan() {
  const response = await fetch(`${HAOS_MARKET_SCAN_URL}/api/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-market-scan-token": MARKET_SCAN_TOKEN
    },
    body: JSON.stringify({ wait: false, reason: "Android App" })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function getLatestMarketScanResults() {
  const response = await fetch(`${HAOS_MARKET_SCAN_URL}/api/results/latest`, {
    headers: { "x-market-scan-token": MARKET_SCAN_TOKEN }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
