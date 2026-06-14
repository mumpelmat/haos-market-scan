let tickerLists = {};
let settings = null;
const $ = (id) => document.getElementById(id);

function token() { return localStorage.getItem("market_scan_api_token") || ""; }
function headers() {
  const h = { "content-type": "application/json" };
  if (token()) h["x-market-scan-token"] = token();
  return h;
}
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function setStatus(text, cls = "") { const el = $("connectionStatus"); el.textContent = text; el.className = `status ${cls}`; }
function splitTickers(value) { return [...new Set(String(value || "").split(/[\n,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean))]; }
function escapeHtml(s = "") { return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }

function readForm() {
  return {
    enabled: $("enabled").value === "true",
    mode: $("mode").value,
    horizon: $("horizon").value,
    scanTime: $("scanTime").value,
    timezone: $("timezone").value,
    maxTickers: Number($("maxTickers").value),
    minRcr: Number($("minRcr").value),
    delayMs: Number($("delayMs").value),
    anthropicModel: $("anthropicModel").value,
    weekdaysOnly: $("weekdaysOnly").checked,
    notifyOnlySignals: $("notifyOnlySignals").checked,
    sendNoSignalMessage: $("sendNoSignalMessage").checked,
    selectedLists: [...document.querySelectorAll(".market.active")].map(el => el.dataset.key),
    customTickers: splitTickers($("customTickers").value),
    anthropicApiKey: $("anthropicApiKey").value,
    telegramBotToken: $("telegramBotToken").value,
    telegramChatId: $("telegramChatId").value
  };
}
function fillForm(s) {
  settings = s;
  $("enabled").value = String(Boolean(s.enabled));
  $("mode").value = s.mode || "swing";
  $("horizon").value = s.horizon || "5–10";
  $("scanTime").value = s.scanTime || "08:00";
  $("timezone").value = s.timezone || "Europe/Berlin";
  $("maxTickers").value = s.maxTickers || 20;
  $("minRcr").value = s.minRcr ?? 2;
  $("delayMs").value = s.delayMs ?? 750;
  $("anthropicModel").value = s.anthropicModel || "claude-sonnet-4-6";
  $("weekdaysOnly").checked = Boolean(s.weekdaysOnly);
  $("notifyOnlySignals").checked = Boolean(s.notifyOnlySignals);
  $("sendNoSignalMessage").checked = Boolean(s.sendNoSignalMessage);
  $("customTickers").value = (s.customTickers || []).join("\n");
  $("anthropicApiKey").value = s.anthropicApiKey || "";
  $("telegramBotToken").value = s.telegramBotToken || "";
  $("telegramChatId").value = s.telegramChatId || "";
  renderMarkets(s.selectedLists || []);
  updateTickerCount();
}
function renderMarkets(selected = []) {
  const wrap = $("markets");
  wrap.innerHTML = "";
  Object.entries(tickerLists).forEach(([key, list]) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `market ${selected.includes(key) ? "active" : ""}`;
    el.dataset.key = key;
    el.innerHTML = `<span>${list.flag}</span><span>${escapeHtml(list.label)}</span><span>${list.tickers.length}</span>`;
    el.addEventListener("click", () => { el.classList.toggle("active"); updateTickerCount(); });
    wrap.appendChild(el);
  });
}
function updateTickerCount() {
  const set = new Set();
  [...document.querySelectorAll(".market.active")].forEach(el => {
    (tickerLists[el.dataset.key]?.tickers || []).forEach(t => set.add(t));
  });
  splitTickers($("customTickers").value).forEach(t => set.add(t));
  const max = Number($("maxTickers").value || 20);
  $("tickerCount").textContent = `${set.size} Ticker ausgewählt · ${Math.min(set.size, max)} werden gescannt`;
}
async function load() {
  try {
    setStatus("Lade…");
    tickerLists = await api("api/ticker-lists");
    const data = await api("api/settings");
    fillForm(data.settings);
    await loadLatest();
    await refreshProgress();
    setStatus("Verbunden", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
}
async function save() {
  const next = readForm();
  const data = await api("api/settings", { method: "POST", body: JSON.stringify(next) });
  fillForm(data.settings);
  setStatus("Gespeichert", "ok");
}
async function testTelegram() {
  await save();
  await api("api/test-telegram", { method: "POST", body: JSON.stringify({}) });
  setStatus("Telegram-Test gesendet", "ok");
}
async function runScan() {
  await save();
  $("runBtn").disabled = true;
  setStatus("Scan läuft…");
  try {
    await api("api/run-scan", { method: "POST", body: JSON.stringify({ reason: "Manueller Scan aus Weboberfläche" }) });
    await loadLatest();
    setStatus("Scan abgeschlossen", "ok");
  } finally {
    $("runBtn").disabled = false;
  }
}
async function refreshProgress() {
  try {
    const data = await api("api/progress");
    const p = data.progress || {};
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    $("progress").innerHTML = `Status: <b>${p.running ? "läuft" : "idle"}</b><br>Fortschritt: ${p.done || 0} / ${p.total || 0}${p.current ? `<br>Aktuell: ${escapeHtml(p.current)}` : ""}${p.message ? `<br>Grund: ${escapeHtml(p.message)}` : ""}`;
    $("progressBar").style.width = `${pct}%`;
  } catch {}
}
async function loadLatest() {
  const data = await api("api/results/latest");
  renderResults(data.results || []);
}
function badgeClass(signal) {
  if (["LONG", "KAUFEN"].includes(signal)) return "green";
  if (["SHORT", "VERKAUFEN"].includes(signal)) return "red";
  if (["HALTEN"].includes(signal)) return "yellow";
  return "gray";
}
function renderResults(results) {
  const wrap = $("results");
  if (!results.length) { wrap.className = "results empty"; wrap.textContent = "Noch keine Ergebnisse vorhanden."; return; }
  wrap.className = "results";
  wrap.innerHTML = results.map(r => {
    const score = Number.isFinite(r.score) ? ` · Score ${r.score}/10` : "";
    const rcr = Number.isFinite(r.rcr) ? ` · RCR ${r.rcr}` : "";
    const main = r.sections?.Fazit || r.sections?.["Setup-Typ"] || r.sections?.Unternehmen || r.error || "—";
    const extra = ["Einstieg", "Stop-Loss", "Ziel 1"].map(k => r.sections?.[k] ? `<div><b>${k}:</b> ${escapeHtml(r.sections[k])}</div>` : "").join("");
    return `<article class="result">
      <div class="resultHead"><span class="badge ${badgeClass(r.signal)}">${escapeHtml(r.signal || r.status)}</span><span class="resultTitle">${escapeHtml(r.ticker)}</span><span class="hint">${score}${rcr}</span></div>
      <div class="resultText">${escapeHtml(main)}${extra ? `<hr style="border-color:#1e2a45;border-style:solid;border-width:1px 0 0;margin:10px 0">${extra}` : ""}</div>
    </article>`;
  }).join("");
}

$("saveTokenBtn").addEventListener("click", () => {
  if ($("rememberToken").checked) localStorage.setItem("market_scan_api_token", $("localApiToken").value);
  load();
});
$("reloadBtn").addEventListener("click", load);
$("saveBtn").addEventListener("click", () => save().catch(e => setStatus(e.message, "err")));
$("testTelegramBtn").addEventListener("click", () => testTelegram().catch(e => setStatus(e.message, "err")));
$("runBtn").addEventListener("click", () => runScan().catch(e => setStatus(e.message, "err")));
$("customTickers").addEventListener("input", updateTickerCount);
$("maxTickers").addEventListener("input", updateTickerCount);
$("localApiToken").value = token();
setInterval(refreshProgress, 3000);
load();
