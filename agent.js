import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

// --- KONFIGURACE ---
// Přidal jsem tvoje chybějící tickery z portfolia
const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA", "VKTX", "ONDS", "GOOGC"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 4; 

// --- POMOCNÉ FUNKCE ---

async function getPortfolio() {
    try {
        const data = await fs.readFile("./portfolio.json", "utf-8");
        const parsed = JSON.parse(data);
        console.log("📂 Portfolio úspěšně načteno.");
        return parsed;
    } catch (e) {
        console.error("❌ CHYBA FORMÁTU: Tvůj portfolio.json není validní! Zkontroluj závorky a čárky.");
        return {};
    }
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
        ? `Vlastníš ${portfolioInfo.shares} ks, P/L: ${(((data.price - portfolioInfo.avgPrice) / portfolioInfo.avgPrice) * 100).toFixed(2)}%.` 
        : "Sledovaná pozice.";

    let histInfo = lastHistory 
        ? `Změna od včerejška: ${(((data.price - lastHistory.price) / lastHistory.price) * 100).toFixed(2)}%.` 
        : "";

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi elitní seniorní analytik. Piš nekompromisně, česky, max 3 věty. Na konec dej JEDNO slovo jako verdikt: [KOUPIT / DRŽET / REDUKOVAT / SLEDOVAT]." },
                { role: "user", content: `Ticker: ${ticker} | Cena: ${data.price} USD | ${histInfo} | ${pnlInfo} | Zprávy: ${data.news.map(n => n.title).join(" | ")}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content || "Analýza nedostupná.";
    } catch (e) { return "AI analýza mimo provoz."; }
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
        limitDate.setHours(limitDate.getHours() - 48);

        const news = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .slice(0, 3)
            .map(n => ({ ticker, title: n.title, link: n.link, dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }));

        return { ticker, price, change, news };
    } catch (err) { return null; }
}

// --- HLAVNÍ BĚH AGENTA ---

async function runAgent() {
    console.log("🚀 AGENT19 startuje...");
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

    if (!results.length) return console.error("❌ Žádná data stažena.");

    // Výpočet portfolia
    let totalValue = 0, totalInvested = 0, ownedCount = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p && p.shares && p.avgPrice) {
            totalValue += d.price * p.shares;
            totalInvested += p.avgPrice * p.shares;
            ownedCount++;
        }
    });

    const totalPnlCash = (totalValue - totalInvested).toFixed(2);
    const totalPnlPercent = totalInvested > 0 ? (((totalValue - totalInvested) / totalInvested) * 100).toFixed(2) : 0;
    const headerColor = totalPnlCash >= 0 ? "#27ae60" : "#c0392b";

    // HTML Generování
    let html = `<div style="font-family: Arial; max-width: 700px; margin: auto; padding: 20px; background: #f4f7f9;">
        <div style="background: white; padding: 20px; border-radius: 10px; border-bottom: 6px solid ${headerColor}; text-align: center; margin-bottom: 25px;">
            <h2 style="margin:0; color:#2c3e50;">Market Intelligence Report</h2>
            ${ownedCount > 0 ? `<b style="color:${headerColor}; font-size: 1.2em;">Portfolio: ${totalPnlPercent}% (${totalPnlCash} USD)</b>` : ''}
        </div>`;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = p && p.shares && p.avgPrice;
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";

        html += `
            <div style="background: white; padding: 15px; margin-bottom: 20px; border-radius: 10px; border-left: 6px solid ${isOwned ? '#3498db' : '#ccc'}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <b style="font-size: 1.2em;">${d.ticker}</b>
                    <b style="color: ${color};">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</b>
                </div>`;

        if (isOwned) {
            const pPct = (((d.price - p.avgPrice) / p.avgPrice) * 100).toFixed(2);
            const pCsh = ((d.price - p.avgPrice) * p.shares).toFixed(2);
            html += `
                <div style="background: #e1f5fe; border: 1px solid #3498db; padding: 10px; margin: 10px 0; border-radius: 6px;">
                    <span style="color: #2980b9;"><b>Tvůj výsledek:</b></span>
                    <b style="float: right; color: ${pPct >= 0 ? '#27ae60' : '#c0392b'};">${pPct}% (${pCsh} USD)</b>
                    <div style="font-size: 0.8em; color: #7f8c8d; margin-top: 4px;">Pozice: ${p.shares} ks @ ${p.avgPrice} USD</div>
                </div>`;
        }

        html += `
                <div style="background: #2c3e50; color: #ecf0f1; padding: 12px; border-radius: 6px; margin-top: 10px; font-size: 0.95em;">
                    ${d.analysis.replace(/\n/g, '<br>')}
                </div>
                <div style="font-size: 0.8em; margin-top: 10px; color: #7f8c8d;">
                    ${d.news.map(n => `• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a>`).join('<br>')}
                </div>
            </div>`;
    });

    html += `</div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Report: ${totalPnlPercent}% | ${new Date().toLocaleDateString('cs-CZ')}`, html: html });

    await saveHistory(results);
    console.log("✅ Report odeslán.");
}

runAgent().catch(console.error);