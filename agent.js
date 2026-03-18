import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

// --- KONFIGURACE ---
const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 4; // Sníženo na 4 pro maximální stabilitu API

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

async function getStockAnalysis(ticker, data, portfolioInfo, lastHistory) {
    if (!data.news?.length) return "⚠️ Žádné čerstvé zprávy. Akcie bez výrazných impulsů.";
    
    let pnlInfo = portfolioInfo 
        ? `Máš v tom peníze! Držíš ${portfolioInfo.shares} ks, P/L: ${(((data.price - portfolioInfo.avgPrice) / portfolioInfo.avgPrice) * 100).toFixed(2)}%.` 
        : "Sledovaná pozice.";

    let histInfo = lastHistory 
        ? `Změna od minule: ${(((data.price - lastHistory.price) / lastHistory.price) * 100).toFixed(2)}%.` 
        : "";

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Jsi elitní seniorní analytik z Wall Street. Piš nekompromisně, česky, max 3 úderné věty. Žádná vata, jdi k jádru věci a vlivu na portfolio. Na konec dej verdikt: [KOUPIT / DRŽET / REDUKOVAT / SLEDOVAT]." },
                { role: "user", content: `Ticker: ${ticker} | Cena: ${data.price} USD (${data.change.toFixed(2)}%) | ${histInfo} | ${pnlInfo} | Rozsah 52W: ${data.metrics.range} | Zprávy: ${data.news.map(n => n.title).join(" | ")}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content || "Analýza nedostupná.";
    } catch (e) { return "AI analýza dočasně mimo provoz."; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;
        if (!meta) return null;

        const price = meta.regularMarketPrice;
        const change = ((price - meta.previousClose) / meta.previousClose) * 100;
        const metrics = { range: `${meta.fiftyTwoWeekLow?.toFixed(2) || '?'} - ${meta.fiftyTwoWeekHigh?.toFixed(2) || '?'}` };

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const limitDate = new Date();
        limitDate.setHours(limitDate.getHours() - 48);

        const news = feed.items
            .filter(item => new Date(item.pubDate) > limitDate)
            .slice(0, 3)
            .map(n => ({ ticker, title: n.title, link: n.link, dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }));

        return { ticker, price, change, metrics, news, allRecentNews: news };
    } catch (err) { return null; }
}

async function runAgent() {
    console.log("🚀 Startuji AGENT19...");
    const [portfolio, history] = await Promise.all([getPortfolio(), getHistory()]);
    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (data) data.analysis = await getStockAnalysis(t, data, portfolio[t], history[t]);
            return data;
        }));
        results.push(...batchResults.filter(r => r !== null));
    }

    if (!results.length) return console.error("❌ Žádná data.");

    let htmlBody = `<div style="font-family: Arial; max-width: 800px; margin: auto; background: #f9f9f9; padding: 20px;">
        <h1 style="color: #2c3e50; border-bottom: 2px solid #3498db;">AI Intelligence Report</h1>`;

    results.forEach(d => {
        const isOwned = !!portfolio[d.ticker];
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";
        htmlBody += `
            <div style="background: white; padding: 15px; margin-bottom: 20px; border-radius: 8px; border-left: 5px solid ${isOwned ? '#3498db' : '#ccc'}; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <b style="font-size: 1.2em;">${d.ticker} ${isOwned ? '🔵' : ''}</b>
                    <b style="color: ${color};">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</b>
                </div>
                <p style="background: #f1f3f5; padding: 10px; border-radius: 4px; font-size: 0.95em;">${d.analysis.replace(/\n/g, '<br>')}</p>
                <div style="font-size: 0.8em; color: #666;">
                    ${d.news.map(n => `• <a href="${n.link}" style="color: #3498db;">${n.title}</a> (${n.dateStr})`).join('<br>')}
                </div>
            </div>`;
    });

    htmlBody += `</div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Market Expert" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Market Report: ${results.length} aktiv`, html: htmlBody });

    await saveHistory(results);
    console.log("✅ Hotovo.");
}

runAgent().catch(console.error);