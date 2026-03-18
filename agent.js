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

// --- NOVÁ FUNKCE: ZÍSKÁNÍ KURZU USD/CZK ---
async function getUsdCzkRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X`);
        const json = await res.json();
        const rate = json.chart?.result?.[0]?.meta?.regularMarketPrice;
        return rate || 23.5; // Fallback kurz, pokud Yahoo selže
    } catch (e) { return 23.5; }
}

// --- ANALÝZA ---

async function getStockAnalysis(ticker, data, portfolioInfo) {
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

// --- GLOBÁLNÍ PŘÍLEŽITOSTI ---
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

        // Opravené stahování zpráv: Google News RSS
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const limitDate = new Date();
        limitDate.setHours(limitDate.getHours() - 72); // Posledních 72 hodin

        const news = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .slice(0, 3) // Zobrazit 3 zprávy
            .map(n => ({ ticker, title: n.title, link: n.link }));

        return { ticker, price, change, news };
    } catch (err) { return null; }
}

// --- HLAVNÍ BĚH AGENTA ---

async function runAgent() {
    console.log(`🚀 Startuji AGENT19 v CZK...`);
    const [portfolio, history, usdCzkRate] = await Promise.all([getPortfolio(), getHistory(), getUsdCzkRate()]);
    const results = [];

    console.log(`Aktuální kurz USD/CZK: ${usdCzkRate.toFixed(2)}`);

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

    // Výpočty portfolia (převod do CZK)
    let totalValueUsd = 0, totalInvestedUsd = 0, ownedCount = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p && p.shares && (p.avgPrice || p.vgPrice)) {
            const avgPUsd = p.avgPrice || p.vgPrice;
            totalValueUsd += d.price * p.shares;
            totalInvestedUsd += avgPUsd * p.shares;
            ownedCount++;
        }
    });

    const totalPnlCashUsd = (totalValueUsd - totalInvestedUsd);
    const totalPnlPercent = totalInvestedUsd > 0 ? ((totalPnlCashUsd / totalInvestedUsd) * 100).toFixed(2) : 0;
    
    // Převedené hodnoty do CZK
    const totalValueCzk = totalValueUsd * usdCzkRate;
    const totalPnlCashCzk = totalPnlCashUsd * usdCzkRate;
    const headerColor = totalPnlCashUsd >= 0 ? "#27ae60" : "#c0392b";
    const headerBgColor = totalPnlCashUsd >= 0 ? "#ebfdf5" : "#fdf2f2";

    // HTML Generování
    let htmlContent = `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: auto; padding: 20px; background: #f4f7f9;">
        
        <div style="background: ${headerBgColor}; padding: 30px; border-radius: 20px; border: 3px solid ${headerColor}; text-align: center; margin-bottom: 30px;">
            <h1 style="margin: 0; color: #2c3e50; font-size: 2em;">Portfolio Intelligence (CZK)</h1>
            <p style="color: #7f8c8d; margin: 5px 0 20px;">Kurz USD/CZK: ${usdCzkRate.toFixed(2)}</p>
            
            <div style="display: flex; justify-content: space-around;">
                <div style="text-align: center;">
                    <small style="color: #7f8c8d; font-weight: bold;">Hodnota aktiv</small><br>
                    <b style="font-size: 1.8em; color: #2c3e50;">${Math.round(totalValueCzk).toLocaleString('cs-CZ')} CZK</b>
                </div>
                <div style="text-align: center;">
                    <small style="color: #7f8c8d; font-weight: bold;">Celkový zisk/ztráta</small><br>
                    <b style="font-size: 1.8em; color: ${headerColor};">
                        ${totalPnlPercent}%<br>
                        (${Math.round(totalPnlCashCzk).toLocaleString('cs-CZ')} CZK)
                    </b>
                </div>
            </div>
        </div>`;

    // SEKCE: PŘÍLEŽITOSTI
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
        const changeColor = d.change >= 0 ? "#27ae60" : "#c0392b";
        
        // Převedená cena akcie do CZK
        const priceCzk = d.price * usdCzkRate;

        htmlContent += `
            <div style="background: white; padding: 20px; margin-bottom: 20px; border-radius: 15px; border-left: 6px solid ${isOwned ? '#3498db' : '#ccc'}; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <b style="font-size: 1.3em; color: #2c3e50;">${d.ticker}</b>
                    <div style="text-align: right;">
                        <b style="color: ${changeColor}; font-size: 1.1em;">${priceCzk.toFixed(2)} CZK</b><br>
                        <small style="color: #7f8c8d;">(${d.price.toFixed(2)} USD | ${d.change.toFixed(2)}%)</small>
                    </div>
                </div>`;

        // GRAFICKÝ PNL U KONKRÉTNÍ AKCIE
        if (isOwned) {
            const avgPUsd = p.avgPrice || p.vgPrice;
            const pPct = (((d.price - avgPUsd) / avgPUsd) * 100).toFixed(2);
            const pCshUsd = ((d.price - avgPUsd) * p.shares);
            const pCshCzk = pCshUsd * usdCzkRate; // Převedeno do CZK
            const pnlColor = pPct >= 0 ? "#27ae60" : "#c0392b";
            const pnlBgColor = pPct >= 0 ? "#ebfdf5" : "#fdf2f2";

            htmlContent += `
                <div style="background: ${pnlBgColor}; border: 2px solid ${pnlColor}; padding: 12px; margin: 15px 0; border-radius: 10px; font-size: 0.95em;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #2c3e50;"><b>Moje pozice (CZK):</b></span>
                        <b style="color: ${pnlColor}; font-size: 1.1em;">${pPct}% (${Math.round(pCshCzk).toLocaleString('cs-CZ')} CZK)</b>
                    </div>
                    <small style="color: #7f8c8d;">Držím ${p.shares} ks @ ${(avgPUsd * usdCzkRate).toFixed(2)} CZK (${avgPUsd} USD)</small>
                </div>`;
        }

        htmlContent += `
                <div style="background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 10px; margin-top: 15px; font-size: 0.95em; line-height: 1.5; border-left: 4px solid #3498db;">
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>
                
                <div style="font-size: 0.85em; margin-top: 15px; color: #7f8c8d; padding-top: 10px; border-top: 1px solid #eee;">
                    <strong style="color: #2c3e50;">Čerstvé titulky z trhu:</strong><br>
                    ${d.news.length ? d.news.map(n => `• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a>`).join('<br>') : '⚠️ Bez čerstvých zpráv.'}
                </div>
            </div>`;
    });

    htmlContent += `<p style="text-align: center; color: #bdc3c7; font-size: 0.75em; margin-top: 30px;">AGENT19 Enterprise Intelligence (CZK)</p></div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Daily Report: ${totalPnlPercent}% CZK | ${new Date().toLocaleDateString('cs-CZ')}`, html: htmlContent });

    await saveHistory(results);
    console.log("✅ Kompletní report v CZK odeslán.");
}

runAgent().catch(console.error);