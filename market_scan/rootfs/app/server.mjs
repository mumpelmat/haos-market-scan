import http from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8080);

const DATA_DIR = "/data";
const OPTIONS_FILE = "/data/options.json";
const SETTINGS_FILE = "/data/settings.json";
const STATE_FILE = "/data/state.json";
const PUBLIC_DIR = path.join(__dirname, "public");

const TICKER_LISTS = {
  dax40: {
    label: "DAX 40", flag: "🇩🇪",
    tickers: ["ADS.DE","AIR.DE","ALV.DE","BAS.DE","BAYN.DE","BEI.DE","BMW.DE","BNR.DE","CON.DE","1COV.DE","DTG.DE","DBK.DE","DB1.DE","DHL.DE","DTE.DE","EOAN.DE","FRE.DE","FME.DE","HEI.DE","HEN3.DE","HOT.DE","IFX.DE","SHL.DE","MBG.DE","MRK.DE","MTX.DE","MUV2.DE","P911.DE","QGEN.DE","RWE.DE","SAP.DE","SRT3.DE","SIE.DE","ENR.DE","SY1.DE","VOW3.DE","VNA.DE","ZAL.DE","HFG.DE","CBK.DE"]
  },
  sp500: {
    label: "S&P 500 Top 20", flag: "🇺🇸",
    tickers: ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","BRK.B","LLY","AVGO","TSLA","JPM","UNH","V","XOM","MA","JNJ","PG","HD","COST","MRK"]
  },
  nasdaq: {
    label: "Nasdaq Top 20", flag: "💻",
    tickers: ["NVDA","MSFT","AAPL","AMZN","GOOGL","META","TSLA","AVGO","ASML","AMD","QCOM","INTC","AMAT","MU","LRCX","KLAC","MRVL","CDNS","SNPS","ADI"]
  },
  traderepublic: {
    label: "Trade Republic Top 50", flag: "📱",
    tickers: ["AAPL","TSLA","AMZN","MSFT","NVDA","GOOGL","META","NFLX","BABA","NIO","PLTR","GME","AMC","RIVN","LCID","SOFI","HOOD","COIN","SQ","PYPL","SHOP","SPOT","SNAP","UBER","LYFT","ABNB","RBLX","DKNG","MRNA","BNTX","PFE","JNJ","ABBV","LLY","SAP.DE","SIE.DE","ALV.DE","BMW.DE","VOW3.DE","DTE.DE","BAS.DE","BAYN.DE","AIR.DE","MBG.DE","RWE.DE","ADS.DE","DBK.DE","MUV2.DE","EOAN.DE","ENR.DE"]
  }
};

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: "swing",
  horizon: "5–10",
  selectedLists: ["dax40"],
  customTickers: [],
  scanTime: "08:00",
  timezone: "Europe/Berlin",
  weekdaysOnly: true,
  notifyOnlySignals: true,
  minRcr: 2,
  maxTickers: 20,
  delayMs: 750,
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  telegramBotToken: "",
  telegramChatId: "",
  sendNoSignalMessage: false,
  includeRaw: false
};

let running = false;
let currentRun = null;
let lastProgress = { running: false, done: 0, total: 0, current: null, startedAt: null, finishedAt: null, message: "idle" };
let latestResults = [];

function log(level, ...args) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const configured = order[getOptionsSync().log_level || "info"] || 20;
  if ((order[level] || 20) >= configured) console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

let optionsCache = null;
function getOptionsSync() {
  return optionsCache || { api_token: "change-me", auth_required: true, log_level: "info" };
}

async function loadOptions() {
  try {
    const raw = await readFile(OPTIONS_FILE, "utf8");
    optionsCache = JSON.parse(raw);
  } catch {
    optionsCache = { api_token: "change-me", auth_required: true, log_level: "info" };
  }
  return optionsCache;
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function maskSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "••••";
  return `${str.slice(0, 4)}••••${str.slice(-4)}`;
}

function publicSettings(settings) {
  return {
    ...settings,
    anthropicApiKey: maskSecret(settings.anthropicApiKey),
    telegramBotToken: maskSecret(settings.telegramBotToken)
  };
}

async function getSettings() {
  const stored = await readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(next) {
  const current = await getSettings();
  const merged = { ...current, ...sanitizeSettings(next) };
  // Preserve secrets if the UI sends masked values back.
  if (typeof next.anthropicApiKey === "string" && next.anthropicApiKey.includes("••••")) merged.anthropicApiKey = current.anthropicApiKey;
  if (typeof next.telegramBotToken === "string" && next.telegramBotToken.includes("••••")) merged.telegramBotToken = current.telegramBotToken;
  await writeJson(SETTINGS_FILE, merged);
  return merged;
}

function sanitizeTicker(t) {
  return String(t || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "")
    .slice(0, 20);
}

function sanitizeSettings(input = {}) {
  const out = {};
  if (typeof input.enabled === "boolean") out.enabled = input.enabled;
  if (["swing", "fundamental"].includes(input.mode)) out.mode = input.mode;
  if (["3–5", "5–10", "10–20", "3-5", "5-10", "10-20"].includes(input.horizon)) out.horizon = input.horizon.replaceAll("-", "–");
  if (Array.isArray(input.selectedLists)) out.selectedLists = input.selectedLists.filter(k => TICKER_LISTS[k]).slice(0, 10);
  if (Array.isArray(input.customTickers)) out.customTickers = [...new Set(input.customTickers.map(sanitizeTicker).filter(Boolean))].slice(0, 200);
  if (typeof input.scanTime === "string" && /^\d{2}:\d{2}$/.test(input.scanTime)) out.scanTime = input.scanTime;
  if (typeof input.timezone === "string" && input.timezone.length < 80) out.timezone = input.timezone;
  if (typeof input.weekdaysOnly === "boolean") out.weekdaysOnly = input.weekdaysOnly;
  if (typeof input.notifyOnlySignals === "boolean") out.notifyOnlySignals = input.notifyOnlySignals;
  if (typeof input.sendNoSignalMessage === "boolean") out.sendNoSignalMessage = input.sendNoSignalMessage;
  if (typeof input.includeRaw === "boolean") out.includeRaw = input.includeRaw;
  if (Number.isFinite(Number(input.minRcr))) out.minRcr = Math.max(0, Math.min(10, Number(input.minRcr)));
  if (Number.isFinite(Number(input.maxTickers))) out.maxTickers = Math.max(1, Math.min(200, Number(input.maxTickers)));
  if (Number.isFinite(Number(input.delayMs))) out.delayMs = Math.max(0, Math.min(10000, Number(input.delayMs)));
  if (typeof input.anthropicApiKey === "string" && !input.anthropicApiKey.includes("••••")) out.anthropicApiKey = input.anthropicApiKey.trim();
  if (typeof input.anthropicModel === "string" && input.anthropicModel.length < 80) out.anthropicModel = input.anthropicModel.trim();
  if (typeof input.telegramBotToken === "string" && !input.telegramBotToken.includes("••••")) out.telegramBotToken = input.telegramBotToken.trim();
  if (typeof input.telegramChatId === "string") out.telegramChatId = input.telegramChatId.trim();
  return out;
}

function allTickers(settings) {
  const set = new Set();
  for (const key of settings.selectedLists || []) {
    for (const t of TICKER_LISTS[key]?.tickers || []) set.add(sanitizeTicker(t));
  }
  for (const t of settings.customTickers || []) set.add(sanitizeTicker(t));
  return [...set].filter(Boolean).slice(0, settings.maxTickers || 20);
}

function parseFundamental(text) {
  const signalMatch = text.match(/SIGNAL:\s*(KAUFEN|HALTEN|VERKAUFEN)/i);
  const scoreMatch  = text.match(/SCORE:\s*(\d+)\/10/i);
  const sectionRegex = /\*\*(.*?)\*\*[:\s]*([\s\S]*?)(?=\*\*|$)/g;
  const sections = {}; let m;
  while ((m = sectionRegex.exec(text)) !== null) sections[m[1].trim()] = m[2].trim();
  return { signal: signalMatch ? signalMatch[1].toUpperCase() : "HALTEN", score: scoreMatch ? parseInt(scoreMatch[1], 10) : null, sections, raw: text };
}

function parseSwing(text) {
  const signalMatch  = text.match(/SETUP:\s*(LONG|SHORT|KEIN)/i);
  const rcrMatch     = text.match(/RCR:\s*([\d.]+)/i);
  const sectionRegex = /\*\*(.*?)\*\*[:\s]*([\s\S]*?)(?=\*\*|$)/g;
  const sections = {}; let m;
  while ((m = sectionRegex.exec(text)) !== null) sections[m[1].trim()] = m[2].trim();
  return {
    signal: signalMatch ? signalMatch[1].toUpperCase() : "KEIN",
    rcr: rcrMatch ? parseFloat(rcrMatch[1]) : null,
    sections, raw: text
  };
}

function buildFundamentalPrompt(ticker) {
  return `Du bist ein erfahrener Finanzanalyst. Analysiere die Aktie "${ticker}" umfassend.

Strukturiere deine Antwort EXAKT so:

**Unternehmen**: [Name, Branche, Land]
**Aktuelle Lage**: [Kursentwicklung letzte Monate, Marktumfeld]
**Stärken**: [3 konkrete Stärken]
**Risiken**: [3 konkrete Risiken]
**Fundamental**: [KGV-Einschätzung, Wachstum, Dividende falls relevant]
**Katalysatoren**: [Was könnte den Kurs bewegen?]
**Fazit**: [2-3 Sätze Gesamteinschätzung]

SCORE: X/10
SIGNAL: KAUFEN oder HALTEN oder VERKAUFEN

Sei präzise und faktenbasiert. Keine Anlageberatung. Wenn Datenlage unsicher ist, konservativ bewerten.`;
}

function buildSwingPrompt(ticker, horizon) {
  return `Du bist ein erfahrener Swing-Trader. Analysiere "${ticker}" für einen Swing Trade mit Zeithorizont ${horizon} Handelstage.

Strukturiere deine Antwort EXAKT so:

**Ticker**: ${ticker}
**Setup-Typ**: [z.B. Breakout, Pullback, Trendfortsetzung, Reversal, Range-Breakout]
**Trend**: [Übergeordneter Trend: bullish / bearish / seitwärts + kurze Begründung]
**Momentum**: [RSI-Einschätzung, MACD-Signal, Volumen-Trend]
**Einstieg**: [Konkreter Einstiegsbereich oder Trigger-Level in USD/EUR]
**Stop-Loss**: [Konkretes Stop-Level mit Begründung]
**Ziel 1**: [Erstes Kursziel, konservativ]
**Ziel 2**: [Zweites Kursziel, ambitioniert]
**RCR**: [Risiko-Chance-Verhältnis als Zahl, z.B. 2.5]
**Haltedauer**: [Erwartete Haltedauer in Tagen]
**Risiken**: [2 konkrete Risiken für diesen Trade]
**Fazit**: [1-2 Sätze: Warum dieses Setup jetzt interessant ist oder nicht]

SETUP: LONG oder SHORT oder KEIN

Sei konkret mit Preislevels. Wenn kein sauberes Setup vorhanden: SETUP: KEIN. Keine Anlageberatung.`;
}

async function callClaude(prompt, settings) {
  if (!settings.anthropicApiKey) throw new Error("Anthropic API-Key fehlt.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel,
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Claude API ${response.status}: ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function filterForNotification(results, settings) {
  return results.filter((r) => {
    if (r.status !== "done") return false;
    if (settings.mode === "swing") {
      if (!["LONG", "SHORT"].includes(r.signal)) return false;
      if (settings.minRcr && r.rcr && r.rcr < settings.minRcr) return false;
      return true;
    }
    return ["KAUFEN", "VERKAUFEN"].includes(r.signal);
  });
}

function formatTelegramMessage(results, settings, reason = "Automatischer Scan") {
  const relevant = settings.notifyOnlySignals ? filterForNotification(results, settings) : results.filter(r => r.status === "done");
  const modeLabel = settings.mode === "swing" ? `Swing ${settings.horizon} Tage` : "Fundamental";
  const header = `📊 <b>Market Scan</b>\n${escapeHtml(reason)} · ${escapeHtml(modeLabel)}\n${new Date().toLocaleString("de-DE", { timeZone: settings.timezone || "Europe/Berlin" })}`;

  if (!relevant.length) {
    if (!settings.sendNoSignalMessage) return "";
    return `${header}\n\nKeine starken Signale gefunden.`;
  }

  const lines = relevant.slice(0, 20).map((r) => {
    const score = Number.isFinite(r.score) ? ` · Score ${r.score}/10` : "";
    const rcr = Number.isFinite(r.rcr) ? ` · RCR ${r.rcr}` : "";
    const setup = r.sections?.["Setup-Typ"] ? `\nSetup: ${escapeHtml(r.sections["Setup-Typ"]).slice(0, 120)}` : "";
    const entry = r.sections?.["Einstieg"] ? `\nEinstieg: ${escapeHtml(r.sections["Einstieg"]).slice(0, 160)}` : "";
    const stop = r.sections?.["Stop-Loss"] ? `\nStop: ${escapeHtml(r.sections["Stop-Loss"]).slice(0, 160)}` : "";
    const target = r.sections?.["Ziel 1"] ? `\nZiel 1: ${escapeHtml(r.sections["Ziel 1"]).slice(0, 160)}` : "";
    const fazit = r.sections?.Fazit ? `\n${escapeHtml(r.sections.Fazit).slice(0, 360)}` : "";
    const icon = ["LONG", "KAUFEN"].includes(r.signal) ? "🟢" : (["SHORT", "VERKAUFEN"].includes(r.signal) ? "🔴" : "⚪");
    return `\n${icon} <b>${escapeHtml(r.ticker)}</b> · ${escapeHtml(r.signal)}${score}${rcr}${setup}${entry}${stop}${target}${fazit}`;
  });

  const more = relevant.length > 20 ? `\n\n… ${relevant.length - 20} weitere Signale nicht angezeigt.` : "";
  return `${header}\n${lines.join("\n")}${more}\n\n⚠️ Keine Anlageberatung. Bitte eigenständig prüfen.`;
}

async function sendTelegram(text, settings) {
  if (!text) return { skipped: true };
  if (!settings.telegramBotToken || !settings.telegramChatId) throw new Error("Telegram Bot Token oder Chat-ID fehlt.");
  const response = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: settings.telegramChatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram API ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runScan(reason = "Manueller Scan") {
  if (running) throw new Error("Scan läuft bereits.");
  const settings = await getSettings();
  const tickers = allTickers(settings);
  if (!tickers.length) throw new Error("Keine Ticker ausgewählt.");

  running = true;
  latestResults = [];
  lastProgress = { running: true, done: 0, total: tickers.length, current: null, startedAt: new Date().toISOString(), finishedAt: null, message: reason };
  currentRun = { id: crypto.randomUUID(), reason, settings: publicSettings(settings) };
  log("info", `Starting scan: ${reason}; tickers=${tickers.length}; mode=${settings.mode}`);

  const results = [];
  try {
    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      lastProgress = { ...lastProgress, current: ticker, done: i, running: true };
      try {
        const prompt = settings.mode === "fundamental"
          ? buildFundamentalPrompt(ticker)
          : buildSwingPrompt(ticker, settings.horizon);
        const text = await callClaude(prompt, settings);
        const parsed = settings.mode === "fundamental" ? parseFundamental(text) : parseSwing(text);
        results.push({ ticker, ...parsed, status: "done", analyzedAt: new Date().toISOString() });
      } catch (err) {
        log("warn", `Ticker failed ${ticker}:`, err.message);
        results.push({ ticker, status: "error", signal: settings.mode === "fundamental" ? "HALTEN" : "KEIN", error: err.message, analyzedAt: new Date().toISOString() });
      }
      latestResults = results;
      lastProgress = { ...lastProgress, done: i + 1, current: ticker, running: true };
      if (settings.delayMs) await sleep(settings.delayMs);
    }

    const message = formatTelegramMessage(results, settings, reason);
    if (message) await sendTelegram(message, settings);
    await writeJson(path.join(DATA_DIR, "latest-results.json"), { reason, createdAt: new Date().toISOString(), settings: publicSettings(settings), results });
    return { ok: true, scanned: results.length, signals: filterForNotification(results, settings).length, results };
  } finally {
    running = false;
    lastProgress = { ...lastProgress, running: false, current: null, finishedAt: new Date().toISOString(), done: tickers.length };
    currentRun = null;
    log("info", `Scan finished: ${reason}`);
  }
}

async function getZonedParts(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday
  };
}

function weekdayToNumber(shortName) {
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[shortName] || 0;
}

async function schedulerTick() {
  try {
    const settings = await getSettings();
    if (!settings.enabled || running) return;
    const { dateKey, hhmm, weekday } = await getZonedParts(settings.timezone);
    const dayNo = weekdayToNumber(weekday);
    if (settings.weekdaysOnly && (dayNo < 1 || dayNo > 5)) return;
    if (hhmm !== settings.scanTime) return;
    const state = await readJson(STATE_FILE, {});
    const runKey = `${dateKey}-${settings.scanTime}-${settings.mode}`;
    if (state.lastScheduledRunKey === runKey) return;
    await writeJson(STATE_FILE, { ...state, lastScheduledRunKey: runKey, lastScheduledRunAt: new Date().toISOString() });
    runScan("Geplanter Scan").catch(err => log("error", "Scheduled scan failed:", err.message));
  } catch (err) {
    log("error", "Scheduler tick failed:", err.message);
  }
}

function isApiPath(urlPath) { return urlPath.startsWith("/api/"); }
function safeCompare(a = "", b = "") {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function isAuthorized(req) {
  const options = getOptionsSync();
  if (!options.auth_required) return true;
  const expected = String(options.api_token || "");
  if (!expected || expected === "change-me") return true; // Local first-run convenience.
  const h = req.headers["authorization"] || req.headers["x-market-scan-token"] || "";
  const token = String(h).startsWith("Bearer ") ? String(h).slice(7) : String(h);
  return safeCompare(token, expected);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw); } catch { return {}; }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-market-scan-token",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const s = await stat(normalized);
    if (s.isDirectory()) filePath = path.join(normalized, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await loadOptions();
    if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (isApiPath(pathname) && !isAuthorized(req)) return sendJson(res, 401, { error: "Unauthorized" });

    if (pathname === "/api/health") return sendJson(res, 200, { ok: true, running, progress: lastProgress });
    if (pathname === "/api/ticker-lists") return sendJson(res, 200, TICKER_LISTS);
    if (pathname === "/api/settings" && req.method === "GET") return sendJson(res, 200, { settings: publicSettings(await getSettings()) });
    if (pathname === "/api/settings" && req.method === "POST") {
      const body = await readBody(req);
      const settings = await saveSettings(body);
      return sendJson(res, 200, { ok: true, settings: publicSettings(settings), tickers: allTickers(settings).length });
    }
    if (pathname === "/api/progress") return sendJson(res, 200, { progress: lastProgress, run: currentRun });
    if (pathname === "/api/results/latest") {
      const disk = await readJson(path.join(DATA_DIR, "latest-results.json"), null);
      return sendJson(res, 200, disk || { results: latestResults, progress: lastProgress });
    }
    if (pathname === "/api/test-telegram" && req.method === "POST") {
      const settings = await getSettings();
      const msg = `✅ Market Scan Test\n${new Date().toLocaleString("de-DE", { timeZone: settings.timezone || "Europe/Berlin" })}`;
      await sendTelegram(escapeHtml(msg), settings);
      return sendJson(res, 200, { ok: true });
    }
    if ((pathname === "/api/run-scan" || pathname === "/api/trigger") && req.method === "POST") {
      const body = await readBody(req);
      const wait = body.wait !== false;
      if (!wait) {
        runScan(body.reason || "Externer Trigger").catch(err => log("error", "Async scan failed:", err.message));
        return sendJson(res, 202, { ok: true, accepted: true });
      }
      const result = await runScan(body.reason || "Manueller Scan");
      return sendJson(res, 200, { ok: true, scanned: result.scanned, signals: result.signals, results: result.results.map(r => ({ ...r, raw: undefined })) });
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    log("error", "Request failed:", err.stack || err.message);
    sendJson(res, 500, { error: err.message || "Internal server error" });
  }
});

await mkdir(DATA_DIR, { recursive: true });
await loadOptions();
server.listen(PORT, "0.0.0.0", () => {
  log("info", `Market Scan add-on listening on 0.0.0.0:${PORT}`);
});
setInterval(() => schedulerTick(), 30_000);
schedulerTick();
