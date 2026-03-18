import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

// --- KONFIGURACE (Všechny tvé tickery) ---
const STOCKS = [
  "GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP", 
  "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", 
  "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", 
  "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", 
  "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", 
  "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"
];

const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 3;

// --- POMOCNÉ FUNKCE ---

async function getPortfolio() {
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        return JSON.parse(data);
    } catch (e) { return {}; }
}

async function getHistory() {
    try {
        const data = await fs.readFile("./history.json", "utf-8");
        return JSON.parse(data);
    } catch (e) { return {}; }
}

async function saveHistory(results) {
    try {
        const history = {};
        results.forEach(r => {
            history[r.ticker] = { price: r.price, date: new Date().toISOString() };
        });
        await fs.writeFile("./history.json", JSON.stringify(history, null, 2));
    } catch (e) { console.error("Chyba zápisu historie:", e.message); }
}

async function getUsdCzkRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X`);
        const json = await res.json();
        const rate = json.chart?.result?.[0]?.meta?.regularMarketPrice;
        return rate || 23.5;
    } catch (e) { return 23.5; }
}

// --- ANALÝZA ---

async function getStockAnalysis(ticker, data, portfolioInfo) {
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi seniorní analytik. Piš úderně, česky, max 2 věty. Verdikt: [KOUPIT / DRŽET / REDUKOVAT / SLEDOVAT]." },
                { role: "user", content: `Ticker: ${ticker} | Cena: ${data.price} USD | Zprávy: ${data.news.map(n => n.title).join(" | ")}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content || "Analýza nedostupná.";
    } catch (e) { return "AI analýza mimo provoz."; }
}

async function getMarketOpportunities(results) {
    const summary = results.map(r => `${r.ticker}: ${r.change.toFixed(2)}%`).join(", ");
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi makroekonomický stratég. Analyzuj seznam akcií a jejich denní pohyb. Zaměř se na geopolitiku, podhodnocené dipy a aktuální příležitosti. Piš česky, odrážkově, max 4 body. Buď konkrétní a dravý." },
                { role: "user", content: `Aktuální pohyby: ${summary}. Jaké jsou dnes příležitosti?` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.5,
        });
        return response.choices[0]?.message?.content || "Strategie pro dnešek není k dispozici.";
    } catch (e) { return "Chyba při generování makro analýzy."; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;
        if (!meta) return null;

        const price = meta.regularMarketPrice;
        const change = ((price - meta.previousClose) / meta.previousClose) * 100;

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const limitDate = new Date();
        limitDate.setHours(limitDate.getHours() - 72);

        const news = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .slice(0, 3)
            .map(n => ({ ticker, title: n.title, link: n.link }));

        return { ticker, price, change, news };
    } catch (err) { return null; }
}

// --- HLAVNÍ BĚH AGENTA ---

async function runAgent() {
    console.log(`🚀 Startuji AGENT19 (Fix logiky CZK)...`);
    const [portfolio, history, usdCzkRate] = await Promise.all([getPortfolio(), getHistory(), getUsdCzkRate()]);
    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (data) {
                data.analysis = await getStockAnalysis(t, data, portfolio[t]);
                return data;
            }
            return null;
        }));
        results.push(...batchResults.filter(r => r !== null));
    }

    const marketOps = await getMarketOpportunities(results);

    // Celkové výpočty
    let totalValueUsd = 0, totalInvestedUsd = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p && p.shares) {
            const avgP = p.avgPrice || p.vgPrice;
            totalValueUsd += d.price * p.shares;
            totalInvestedUsd += avgP * p.shares;
        }
    });

    const totalPnlCashUsd = totalValueUsd - totalInvestedUsd;
    const totalPnlPercent = totalInvestedUsd > 0 ? ((totalPnlCashUsd / totalInvestedUsd) * 100).toFixed(2) : 0;
    const headerColor = totalPnlCashUsd >= 0 ? "#27ae60" : "#c0392b";
    const headerBgColor = totalPnlCashUsd >= 0 ? "#ebfdf5" : "#fdf2f2";

    let htmlContent = `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto; padding: 20px; background: #f4f7f9;">
        
        <div style="background: ${headerBgColor}; padding: 30px; border-radius: 20px; border: 3px solid ${headerColor}; text-align: center; margin-bottom: 30px;">
            <h1 style="margin: 0; color: #2c3e50;">Portfolio Intelligence (CZK)</h1>
            <p style="color: #7f8c8d;">Kurz USD/CZK: ${usdCzkRate.toFixed(2)}</p>
            <div style="display: flex; justify-content: space-around; margin-top: 20px;">
                <div>
                    <small>Hodnota aktiv</small><br>
                    <b style="font-size: 1.5em;">${Math.round(totalValueUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b>
                </div>
                <div>
                    <small>Celkový P/L</small><br>
                    <b style="font-size: 1.5em; color: ${headerColor};">${totalPnlPercent}% (${Math.round(totalPnlCashUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
                </div>
            </div>
        </div>

        <div style="background: #fff9db; border: 2px solid #f1c40f; padding: 20px; border-radius: 15px; margin-bottom: 30px;">
            <h2 style="margin: 0 0 10px; color: #f39c12; font-size: 1.2em;">🔥 Macro & Dip Opportunities</h2>
            <div style="font-size: 0.95em; line-height: 1.5;">${marketOps.replace(/\n/g, '<br>')}</div>
        </div>`;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = p && p.shares;
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";
        
        htmlContent += `
            <div style="background: white; padding: 20px; margin-bottom: 20px; border-radius: 15px; border-left: 6px solid ${isOwned ? '#3498db' : '#ccc'};">
                <div style="display: flex; justify-content: space-between;">
                    <b>${d.ticker}</b>
                    <div style="text-align: right;">
                        <b style="color: ${color};">${(d.price * usdCzkRate).toFixed(2)} CZK</b><br>
                        <small style="color: #999;">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</small>
                    </div>
                </div>`;

        if (isOwned) {
            const avgP = p.avgPrice || p.vgPrice;
            const pPct = (((d.price - avgP) / avgP) * 100).toFixed(2);
            const pnlColor = pPct >= 0 ? "#27ae60" : "#c0392b";
            const posValueCzk = d.price * p.shares * usdCzkRate;

            htmlContent += `
                <div style="background: ${pPct >= 0 ? '#ebfdf5' : '#fdf2f2'}; border: 1px solid ${pnlColor}; padding: 10px; margin: 15px 0; border-radius: 8px;">
                    <b>Moje pozice: ${Math.round(posValueCzk).toLocaleString('cs-CZ')} CZK</b>
                    <b style="float: right; color: ${pnlColor};">${pPct}%</b>
                    <br><small>Držím ${p.shares} ks | Průměrka: ${(avgP * usdCzkRate).toFixed(2)} CZK</small>
                </div>`;
        }

        htmlContent += `
                <div style="background: #2c3e50; color: #ecf0f1; padding: 12px; border-radius: 8px; margin-top: 10px; font-size: 0.9em;">
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>
                <div style="font-size: 0.8em; margin-top: 10px; color: #7f8c8d;">
                    ${d.news.map(n => `• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a>`).join('<br>')}
                </div>
            </div>`;
    });

    htmlContent += `</div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Daily Report | ${totalPnlPercent}% CZK`, html: htmlContent });

    await saveHistory(results);
    console.log("✅ Report odeslán.");
}

runAgent().catch(console.error);