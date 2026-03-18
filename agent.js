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

// --- ANALÝZA ---

async function getStockAnalysis(ticker, data, portfolioInfo, lastHistory) {
    if (!data.news?.length) return "⚠️ Žádné čerstvé zprávy k analýze.";
    
    let pnlInfo = (portfolioInfo && portfolioInfo.shares) 
        ? `POZOR: Máš v tom peníze! Držíš ${portfolioInfo.shares} ks, tvůj P/L je ${(((data.price - (portfolioInfo.avgPrice || portfolioInfo.vgPrice)) / (portfolioInfo.avgPrice || portfolioInfo.vgPrice)) * 100).toFixed(2)}%.` 
        : "Sledovaná pozice.";

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

// --- NOVÁ FUNKCE: GLOBÁLNÍ PŘÍLEŽITOSTI ---
async function getMarketOpportunities(results) {
    const summary = results.map(r => `${r.ticker}: ${r.change.toFixed(2)}%`).join(", ");
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi makroekonomický stratég. Analyzuj seznam akcií a jejich denní pohyb. Zaměř se na geopolitiku, podhodnocené dipy a aktuální příležitosti. Piš česky, odrážkově, max 4 body. Buď konkrétní a dravý." },
                { role: "user", content: `Aktuální pohyby na mém watchlistu: ${summary}. Jaké jsou dnes největší příležitosti k nákupu nebo ochraně kapitálu?` }
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
        const news = feed.items.slice(0, 2).map(n => ({ ticker, title: n.title, link: n.link }));

        return { ticker, price, change, news };
    } catch (err) { return null; }
}

// --- HLAVNÍ BĚH AGENTA ---

async function runAgent() {
    console.log(`🚀 Startuji AGENT19 s příležitostmi...`);
    const [portfolio, history] = await Promise.all([getPortfolio(), getHistory()]);
    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (data) {
                data.analysis = await getStockAnalysis(t, data, portfolio[t], history[t]);
                return data;
            }
            return null;
        }));
        results.push(...batchResults.filter(r => r !== null));
    }

    const marketOps = await getMarketOpportunities(results);

    // Výpočty portfolia
    let totalValue = 0, totalInvested = 0, ownedCount = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p && p.shares && (p.avgPrice || p.vgPrice)) {
            const avgP = p.avgPrice || p.vgPrice;
            totalValue += d.price * p.shares;
            totalInvested += avgP * p.shares;
            ownedCount++;
        }
    });

    const totalPnlCash = (totalValue - totalInvested).toFixed(2);
    const totalPnlPercent = totalInvested > 0 ? (((totalValue - totalInvested) / totalInvested) * 100).toFixed(2) : 0;
    const headerColor = totalPnlCash >= 0 ? "#27ae60" : "#c0392b";

    // HTML Generování
    let htmlContent = `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto; padding: 20px; background: #f4f7f9;">
        <div style="background: white; padding: 30px; border-radius: 15px; border-bottom: 8px solid ${headerColor}; text-align: center; margin-bottom: 25px;">
            <h1 style="margin: 0; color: #2c3e50;">Portfolio Intelligence</h1>
            <b style="font-size: 1.5em; color: ${headerColor};">P/L: ${totalPnlPercent}% (${totalPnlCash} USD)</b>
            <p style="color: #7f8c8d;">Aktiva: ${totalValue.toLocaleString('en-US')} USD</p>
        </div>`;

    // SEKCE: PŘÍLEŽITOSTI (Třešnička na dortu)
    htmlContent += `
        <div style="background: #fff9db; border: 2px solid #f1c40f; padding: 20px; border-radius: 15px; margin-bottom: 30px;">
            <h2 style="margin: 0 0 10px; color: #f39c12; font-size: 1.3em;">🔥 Macro & Dip Opportunities</h2>
            <div style="color: #444; font-size: 0.95em; line-height: 1.6;">
                ${marketOps.replace(/\n/g, '<br>')}
            </div>
        </div>
    `;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = p && p.shares && (p.avgPrice || p.vgPrice);
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";

        htmlContent += `
            <div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 12px; border-left: 5px solid ${isOwned ? '#3498db' : '#ccc'};">
                <div style="display: flex; justify-content: space-between;">
                    <b>${d.ticker}</b>
                    <b style="color: ${color};">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</b>
                </div>
                ${isOwned ? `<div style="font-size: 0.85em; color: #3498db; margin: 5px 0;">Pozice: ${(((d.price - (p.avgPrice || p.vgPrice)) / (p.avgPrice || p.vgPrice)) * 100).toFixed(2)}%</div>` : ''}
                <div style="background: #2c3e50; color: #ecf0f1; padding: 10px; border-radius: 8px; margin-top: 8px; font-size: 0.9em;">
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>
            </div>`;
    });

    htmlContent += `</div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Daily Report | ${totalPnlPercent}%`, html: htmlContent });

    await saveHistory(results);
    console.log("✅ Report s příležitostmi odeslán.");
}

runAgent().catch(console.error);