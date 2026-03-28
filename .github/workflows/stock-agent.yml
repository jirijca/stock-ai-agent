import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];

// Evropské tickery – měna EUR
const EUR_TICKERS = new Set(["3CP.DE", "RHM", "ASML"]);

const EMAIL_RECIPIENT = "jirijca@gmail.com";

// Benchmarky
const BENCHMARKS = [
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "^IXIC", label: "NASDAQ" },
  { ticker: "^GDAXI", label: "DAX" },
];

// ── POMOCNÉ FUNKCE ────────────────────────────────────────────────────────────

function isTradingDay(date = new Date()) {
  if (process.env.TEST_MODE === "true") return true;
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

// Načte live kurz měny vůči USD z Yahoo Finance
async function fetchFxRate(fromCurrency) {
  try {
    const pair = `${fromCurrency}USD=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

// Načte historická data (OHLCV) z Yahoo Finance – vrátí pole close cen
async function fetchHistoricalData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const timestamps = result.timestamp ?? [];
    const volumes = result.indicators?.quote?.[0]?.volume ?? [];

    // Odfiltrujeme null hodnoty
    const data = closes
      .map((c, i) => ({ close: c, time: timestamps[i], volume: volumes[i] }))
      .filter(d => d.close !== null && d.close !== undefined);

    return data;
  } catch {
    return null;
  }
}

// Výpočet RSI (14)
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(1));
}

// Výpočet SMA
function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
}

// Procentuální změna za N dní
function calcChange(closes, days) {
  if (closes.length < days + 1) return null;
  const from = closes[closes.length - 1 - days];
  const to = closes[closes.length - 1];
  if (!from || from === 0) return null;
  return parseFloat(((to - from) / from * 100).toFixed(2));
}

// Načte aktuální cenu + meta z Yahoo Finance
async function fetchLivePrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    return {
      price: meta?.regularMarketPrice ?? null,
      currency: meta?.currency ?? "USD",
    };
  } catch {
    return null;
  }
}

// AI analýza – systémový prompt
function buildSystemPrompt() {
  return (
    "Jsi stručný burzovní analytik. Piš ČESKY. " +
    "Zaměř se VÝHRADNĚ na události posledních 48 hodin. " +
    "Pokud žádné relevantní nedávné zprávy neexistují, napiš: 'Žádné významné zprávy za posledních 48 h.' " +
    "Na konci přidej SENTIMENT SKÓRE ve formátu: Sentiment: X/10 (kde 1=velmi negativní, 10=velmi pozitivní). " +
    "Struktura (každý bod 1 věta): SEKTOR | HLAVNÍ TREND | KATALYZÁTOR (posledních 48 h) | VERDIKT | Sentiment: X/10"
  );
}

async function analyzeWithGroq(ticker) {
  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: `Ticker: ${ticker}. Jaké jsou nejnovější zprávy a vývoj za posledních 48 hodin?` },
    ],
    model: "llama-3.3-70b-versatile",
  });
  return completion.choices[0].message.content;
}

// Parsuje sentiment skóre z textu analýzy
function parseSentiment(text) {
  const match = text.match(/Sentiment:\s*(\d+(?:\.\d+)?)\/10/i);
  return match ? parseFloat(match[1]) : null;
}

// Sektory pro diverzifikaci (zjednodušená klasifikace)
const SECTOR_MAP = {
  GOOG: "Tech", MDB: "Tech", NVDA: "Tech", META: "Tech", MSFT: "Tech",
  AVGO: "Tech", CRDO: "Tech", ASML: "Tech", TTWO: "Tech",
  VKTX: "Healthcare", CPRX: "Healthcare", ANGO: "Healthcare", ANNX: "Healthcare",
  SANA: "Healthcare", BTAI: "Healthcare", HRMY: "Healthcare", NUVB: "Healthcare",
  MRKR: "Healthcare", ASBP: "Healthcare",
  ONDS: "Telecom", VUZI: "Hardware", IPWR: "Energy", AREC: "Energy",
  OKLO: "Energy", ENVX: "Energy", RIOT: "Crypto", IREN: "Crypto",
  CBAT: "EV/Battery", NIO: "EV/Battery", MVST: "EV/Battery", NVVE: "EV/Battery",
  SOFI: "Fintech", NU: "Fintech", V: "Fintech", CPNG: "E-commerce",
  GRAB: "E-commerce", SOL: "Crypto", ATOS: "Tech", ARQ: "Energy",
  IRON: "Materials", GRYP: "Materials", CAN: "Crypto", QTBS: "Tech",
  RZLV: "Tech", TISC: "Industrial", INDI: "Tech", TAOP: "Tech",
  MDWD: "Healthcare", ASST: "Tech", NRDY: "EdTech", ALAR: "Tech",
  JTAI: "AI/Tech", MVIS: "Tech", "3CP.DE": "Tech", RHM: "Defense", O: "REIT",
};

// ── HLAVNÍ FUNKCE ─────────────────────────────────────────────────────────────

async function runAgent() {

  // 1. KONTROLA OBCHODNÍHO DNE
  const today = new Date();
  if (!isTradingDay(today)) {
    const dayNames = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
    console.log(`📅 Dnes je ${dayNames[today.getDay()]} – trhy zavřené. Agent se ukončuje.`);
    return;
  }
  console.log("🚀 Obchodní den potvrzen. Startuji agenta...");

  // 2. LIVE FX KURZY
  const usdCzk = (await fetchFxRate("USD")) ?? null;  // fallback níže
  const eurUsd = await fetchFxRate("EUR");
  const eurCzk = eurUsd && usdCzk ? eurUsd * usdCzk : null;
  const usdCzkDisplay = usdCzk ? usdCzk.toFixed(2) : "N/A";
  const eurCzkDisplay = eurCzk ? eurCzk.toFixed(2) : "N/A";
  // Pro výpočty fallback na pevné kurzy pokud Yahoo selže
  const USD_CZK = usdCzk ?? 24.1;
  const EUR_CZK = eurCzk ?? (24.1 * 1.08);
  console.log(`💱 Kurzy: 1 USD = ${usdCzkDisplay} CZK | 1 EUR = ${eurCzkDisplay} CZK`);

  // 3. NAČTENÍ PORTFOLIA
  let portfolio = {};
  try {
    const data = await fs.readFile("./portfolio.json", "utf-8");
    portfolio = JSON.parse(data);
  } catch {
    console.error("⚠️  portfolio.json nenalezen.");
  }

  // 4. BENCHMARKY
  console.log("📊 Načítám benchmarky...");
  const benchmarkResults = [];
  for (const b of BENCHMARKS) {
    const hist = await fetchHistoricalData(b.ticker);
    if (hist && hist.length > 0) {
      const closes = hist.map(d => d.close);
      benchmarkResults.push({
        label: b.label,
        price: closes[closes.length - 1],
        change1d: calcChange(closes, 1),
        change7d: calcChange(closes, 7),
        change30d: calcChange(closes, 30),
      });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 5. ZPRACOVÁNÍ AKCIÍ
  const results = [];
  let totalValCzk = 0;
  let totalInvCzk = 0;
  const sectorMap = {};

  for (const ticker of STOCKS) {
    const p = portfolio[ticker] ?? { shares: 0, avgPrice: 0 };
    const isEur = EUR_TICKERS.has(ticker);
    const convRate = isEur ? EUR_CZK : USD_CZK;
    const currency = isEur ? "EUR" : "USD";

    // Živá cena
    const liveData = await fetchLivePrice(ticker);
    const currentPrice = liveData?.price ?? p.avgPrice ?? 0;
    const priceSource = liveData?.price ? "live" : "offline";

    // Historická data + indikátory
    let rsi = null, sma50 = null, sma200 = null;
    let change1d = null, change7d = null, change30d = null;

    const hist = await fetchHistoricalData(ticker);
    if (hist && hist.length > 0) {
      const closes = hist.map(d => d.close);
      rsi = calcRSI(closes);
      sma50 = calcSMA(closes, 50);
      sma200 = calcSMA(closes, 200);
      change1d = calcChange(closes, 1);
      change7d = calcChange(closes, 7);
      change30d = calcChange(closes, 30);
    }

    // P&L v CZK
    const posValCzk = currentPrice * p.shares * convRate;
    const posInvCzk = p.avgPrice * p.shares * convRate;
    totalValCzk += posValCzk;
    totalInvCzk += posInvCzk;

    // Diverzifikace
    const sector = SECTOR_MAP[ticker] ?? "Ostatní";
    sectorMap[sector] = (sectorMap[sector] ?? 0) + posValCzk;

    // AI analýza (Groq)
    let groqAnalysis = "Analýza nedostupná.";

    try {
      groqAnalysis = await analyzeWithGroq(ticker);
      console.log(`✅ ${ticker} – Groq OK`);
    } catch {
      console.log(`⚠️  ${ticker}: Groq limit/chyba.`);
    }

    const sentiment = parseSentiment(groqAnalysis);

    results.push({
      ticker, currentPrice, avgPrice: p.avgPrice, shares: p.shares,
      currency, priceSource, convRate,
      rsi, sma50, sma200, change1d, change7d, change30d,
      groqAnalysis, sentiment,
      posValCzk, posInvCzk,
    });

    await new Promise(r => setTimeout(r, 200));
  }

  // 6. SOUHRNNÁ AI ANALÝZA PORTFOLIA (Groq)
  console.log("🧠 Generuji souhrnnou analýzu portfolia...");
  let portfolioSummary = "";
  try {
    const top5 = [...results]
      .sort((a, b) => Math.abs(b.posValCzk - b.posInvCzk) - Math.abs(a.posValCzk - a.posInvCzk))
      .slice(0, 5)
      .map(r => `${r.ticker}: ${r.change1d !== null ? r.change1d + "% (1d)" : "N/A"}`)
      .join(", ");

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Jsi burzovní analytik portfolia. Piš ČESKY. Napiš stručný odstavec (max 5 vět) shrnující dnešní dění v portfoliu.",
        },
        {
          role: "user",
          content: `Největší pohyby dnes: ${top5}. Co dnes nejvíce hýbe portfoliem a jaký je celkový sentiment trhu?`,
        },
      ],
      model: "llama-3.3-70b-versatile",
    });
    portfolioSummary = completion.choices[0].message.content;
  } catch {
    portfolioSummary = "Souhrnná analýza nedostupná.";
  }

  // 7. VÝPOČET P&L A DIVERZIFIKACE
  const pnlCzk = totalValCzk - totalInvCzk;
  const pnlPct = totalInvCzk > 0 ? ((pnlCzk / totalInvCzk) * 100).toFixed(2) : "0.00";
  const pnlColor = pnlCzk >= 0 ? "#27ae60" : "#c0392b";
  const dateStr = today.toLocaleDateString("cs-CZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const sectorRows = Object.entries(sectorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, val]) => {
      const pct = totalValCzk > 0 ? ((val / totalValCzk) * 100).toFixed(1) : "0.0";
      return `<tr>
        <td style="padding:6px 12px;">${sector}</td>
        <td style="padding:6px 12px; text-align:right;">${Math.round(val).toLocaleString("cs-CZ")} CZK</td>
        <td style="padding:6px 12px; text-align:right;">${pct}%</td>
        <td style="padding:6px 12px;">
          <div style="background:#e0e0e0; border-radius:4px; height:10px; width:100%;">
            <div style="background:#2980b9; border-radius:4px; height:10px; width:${pct}%;"></div>
          </div>
        </td>
      </tr>`;
    }).join("");

  // 8. SESTAVENÍ HTML
  const changeCell = (val) => {
    if (val === null) return `<td style="padding:6px 10px; text-align:right; color:#bbb;">–</td>`;
    const c = val >= 0 ? "#27ae60" : "#c0392b";
    return `<td style="padding:6px 10px; text-align:right; color:${c}; font-weight:bold;">${val >= 0 ? "+" : ""}${val}%</td>`;
  };

  const rsiCell = (rsi) => {
    if (rsi === null) return `<td style="padding:6px 10px; text-align:right; color:#bbb;">–</td>`;
    const c = rsi >= 70 ? "#c0392b" : rsi <= 30 ? "#27ae60" : "#2c3e50";
    const label = rsi >= 70 ? "↑ OB" : rsi <= 30 ? "↓ OS" : "";
    return `<td style="padding:6px 10px; text-align:right; color:${c};">${rsi} <small>${label}</small></td>`;
  };

  const smaCell = (price, sma, label) => {
    if (sma === null) return `<td style="padding:6px 10px; text-align:right; color:#bbb;">–</td>`;
    const above = price > sma;
    const c = above ? "#27ae60" : "#c0392b";
    return `<td style="padding:6px 10px; text-align:right; color:${c};">${sma} <small>${above ? "▲" : "▼"}</small></td>`;
  };

  let htmlBody = `
  <div style="font-family: Arial, sans-serif; max-width: 900px; margin: auto; background: #f4f6f8; padding: 20px; border-radius: 12px;">

    <!-- HLAVIČKA -->
    <div style="text-align:center; margin-bottom:20px;">
      <h1 style="margin:0; color:#2c3e50; font-size:1.5em;">📈 Stock Insight Report</h1>
      <p style="color:#7f8c8d; margin:4px 0;">${dateStr}</p>
      <p style="color:#e67e22; font-size:0.8em; margin:0;">⏱ AI analýzy zahrnují pouze události posledních 48 hodin</p>
    </div>

    <!-- PORTFOLIO SUMMARY -->
    <div style="background:white; padding:20px; border-radius:12px; border-top:6px solid ${pnlColor}; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.08); margin-bottom:20px;">
      <p style="margin:0; color:#7f8c8d; font-size:0.85em; text-transform:uppercase; letter-spacing:1px;">Hodnota portfolia</p>
      <b style="font-size:2.2em; color:#2c3e50;">${Math.round(totalValCzk).toLocaleString("cs-CZ")} CZK</b><br><br>
      <b style="color:${pnlColor}; font-size:1.4em;">
        ${pnlCzk >= 0 ? "▲" : "▼"} ${pnlPct}% &nbsp;|&nbsp; ${pnlCzk >= 0 ? "+" : ""}${Math.round(pnlCzk).toLocaleString("cs-CZ")} CZK
      </b>
      <p style="font-size:0.75em; color:#bdc3c7; margin-top:10px;">
        Kurz: 1 USD = ${usdCzkDisplay} CZK &nbsp;·&nbsp; 1 EUR = ${eurCzkDisplay} CZK &nbsp;·&nbsp; Ceny: live Yahoo Finance
      </p>
    </div>

    <!-- BENCHMARKY -->
    <h3 style="color:#2c3e50; margin-bottom:10px;">🌍 Trhy dnes</h3>
    <table style="width:100%; border-collapse:collapse; background:white; border-radius:12px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.08); margin-bottom:20px;">
      <thead>
        <tr style="background:#34495e; color:white; font-size:0.82em;">
          <th style="padding:10px 14px; text-align:left;">Index</th>
          <th style="padding:10px 14px; text-align:right;">Cena</th>
          <th style="padding:10px 14px; text-align:right;">1D</th>
          <th style="padding:10px 14px; text-align:right;">7D</th>
          <th style="padding:10px 14px; text-align:right;">30D</th>
        </tr>
      </thead>
      <tbody>
        ${benchmarkResults.map((b, i) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}; font-size:0.85em;">
          <td style="padding:8px 14px; font-weight:bold;">${b.label}</td>
          <td style="padding:8px 14px; text-align:right;">${b.price?.toFixed(2) ?? "–"}</td>
          ${changeCell(b.change1d)}
          ${changeCell(b.change7d)}
          ${changeCell(b.change30d)}
        </tr>`).join("")}
      </tbody>
    </table>

    <!-- TABULKA POZIC -->
    <h3 style="color:#2c3e50; margin-bottom:10px;">💼 Pozice</h3>
    <table style="width:100%; border-collapse:collapse; background:white; border-radius:12px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.08); margin-bottom:20px; font-size:0.8em;">
      <thead>
        <tr style="background:#2c3e50; color:white;">
          <th style="padding:9px 10px; text-align:left;">Ticker</th>
          <th style="padding:9px 10px; text-align:right;">Cena</th>
          <th style="padding:9px 10px; text-align:right;">Nák.</th>
          <th style="padding:9px 10px; text-align:right;">Ks</th>
          <th style="padding:9px 10px; text-align:right;">1D</th>
          <th style="padding:9px 10px; text-align:right;">7D</th>
          <th style="padding:9px 10px; text-align:right;">30D</th>
          <th style="padding:9px 10px; text-align:right;">RSI</th>
          <th style="padding:9px 10px; text-align:right;">SMA50</th>
          <th style="padding:9px 10px; text-align:right;">SMA200</th>
          <th style="padding:9px 10px; text-align:right;">P&L (CZK)</th>
          <th style="padding:9px 10px; text-align:right;">Sent.</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach((r, i) => {
    const posPnl = r.posValCzk - r.posInvCzk;
    const posPnlColor = posPnl >= 0 ? "#27ae60" : "#c0392b";
    const rowBg = i % 2 === 0 ? "#fff" : "#f9fafb";
    const sentColor = r.sentiment >= 6 ? "#27ae60" : r.sentiment <= 4 ? "#c0392b" : "#e67e22";

    htmlBody += `
      <tr style="background:${rowBg};">
        <td style="padding:6px 10px; font-weight:bold; color:#2980b9;">${r.ticker} <small style="color:#999;">${r.currency}</small></td>
        <td style="padding:6px 10px; text-align:right;">${r.currentPrice > 0 ? r.currentPrice.toFixed(2) : "–"}</td>
        <td style="padding:6px 10px; text-align:right; color:#7f8c8d;">${r.avgPrice > 0 ? r.avgPrice.toFixed(2) : "–"}</td>
        <td style="padding:6px 10px; text-align:right;">${r.shares}</td>
        ${changeCell(r.change1d)}
        ${changeCell(r.change7d)}
        ${changeCell(r.change30d)}
        ${rsiCell(r.rsi)}
        ${smaCell(r.currentPrice, r.sma50, "50")}
        ${smaCell(r.currentPrice, r.sma200, "200")}
        <td style="padding:6px 10px; text-align:right; color:${posPnlColor}; font-weight:bold;">
          ${posPnl >= 0 ? "+" : ""}${Math.round(posPnl).toLocaleString("cs-CZ")}
        </td>
        <td style="padding:6px 10px; text-align:right; color:${sentColor}; font-weight:bold;">
          ${r.sentiment ?? "–"}
        </td>
      </tr>`;
  });

  htmlBody += `</tbody></table>

    <!-- DIVERZIFIKACE -->
    <h3 style="color:#2c3e50; margin-bottom:10px;">🥧 Diverzifikace podle sektoru</h3>
    <table style="width:100%; border-collapse:collapse; background:white; border-radius:12px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.08); margin-bottom:20px; font-size:0.85em;">
      <thead>
        <tr style="background:#2c3e50; color:white;">
          <th style="padding:9px 12px; text-align:left;">Sektor</th>
          <th style="padding:9px 12px; text-align:right;">Hodnota</th>
          <th style="padding:9px 12px; text-align:right;">%</th>
          <th style="padding:9px 12px; width:200px;"></th>
        </tr>
      </thead>
      <tbody>${sectorRows}</tbody>
    </table>

    <!-- SOUHRNNÁ ANALÝZA -->
    <div style="background:white; border-left:5px solid #2980b9; padding:16px 20px; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.08); margin-bottom:20px;">
      <h3 style="margin:0 0 10px 0; color:#2c3e50;">🧠 Souhrnná analýza portfolia</h3>
      <p style="font-size:0.9em; color:#333; line-height:1.7; margin:0;">${portfolioSummary.replace(/\n/g, "<br>")}</p>
    </div>

    <!-- DETAILNÍ ANALÝZY -->
    <h3 style="color:#2c3e50; margin-bottom:12px;">🔍 Detailní analýzy (posledních 48 h)</h3>
  `;

  results.forEach((r) => {
    const sentColor = r.sentiment >= 6 ? "#27ae60" : r.sentiment <= 4 ? "#c0392b" : "#e67e22";
    htmlBody += `
      <div style="background:white; border:1px solid #e0e0e0; padding:16px; margin-bottom:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h4 style="margin:0; color:#2980b9; font-size:1em;">${r.ticker} <span style="color:#999; font-weight:normal; font-size:0.85em;">${r.currency}</span></h4>
          ${r.sentiment ? `<span style="color:${sentColor}; font-weight:bold; font-size:0.9em;">Sentiment: ${r.sentiment}/10</span>` : ""}
        </div>
        <div style="font-size:0.85em; color:#333; line-height:1.6; background:#f8f9fa; padding:10px; border-radius:6px;">
          ${r.groqAnalysis.replace(/\n/g, "<br>")}
        </div>
      </div>`;
  });

  htmlBody += `</div>`; // hlavní wrapper

  // 9. ODESLÁNÍ E-MAILU
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
      to: EMAIL_RECIPIENT,
      subject: `📈 Stock Insight | ${Math.round(totalValCzk).toLocaleString("cs-CZ")} CZK | ${pnlCzk >= 0 ? "▲" : "▼"}${pnlPct}%`,
      html: htmlBody,
    });

    console.log("✉️  Report odeslán na", EMAIL_RECIPIENT);
  } catch (err) {
    console.error("❌ Chyba při odesílání:", err.message);
    await fs.writeFile("./report_backup.html", htmlBody, "utf-8");
    console.log("💾 Report uložen jako report_backup.html");
  }

  console.log("🏁 Agent dokončen.");
}

runAgent();