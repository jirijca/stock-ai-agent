import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 2; 
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function getMarketContext() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=^VIX,^GSPC`);
        const json = await res.json();
        const vix = json.quoteResponse.result.find(r => r.symbol === "^VIX")?.regularMarketPrice || 20;
        const sp500 = json.quoteResponse.result.find(r => r.symbol === "^GSPC")?.regularMarketChangePercent || 0;
        return { vix, sp500 };
    } catch (e) { return { vix: 20, sp500: 0 }; }
}

async function getUsdCzkRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X`);
        const json = await res.json();
        return json.chart?.result?.[0]?.meta?.regularMarketPrice || 23.5;
    } catch (e) { return 23.5; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
        const json = await res.json();
        const d = json.quoteResponse?.result?.[0];
        if (!d) return null;

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const now = new Date();
        const freshNews = feed.items
            .filter(i => (now - new Date(i.isoDate)) < 24 * 60 * 60 * 1000)
            .slice(0, 3).map(n => n.title).join(" | ");

        return {
            ticker: ticker.toUpperCase(),
            name: d.shortName,
            price: d.regularMarketPrice,
            change: d.regularMarketChangePercent,
            targetPrice: d.targetMedianPrice || null,
            rating: d.averageAnalystRating || "N/A",
            news: freshNews || "Žádné nové zprávy."
        };
    } catch (err) { return null; }
}

async function runAgent() {
    let portfolio = {};
    try { 
        const data = await fs.readFile("./portfolio.json", "utf-8");
        const rawPortfolio = JSON.parse(data);
        // Normalizace klíčů na velká písmena
        Object.keys(rawPortfolio).forEach(k => portfolio[k.toUpperCase()] = rawPortfolio[k]);
    } catch (e) { console.log("⚠️ Portfolio.json nenalezen nebo je prázdný."); }
    
    const { vix, sp500 } = await getMarketContext();
    const usdCzkRate = await getUsdCzkRate();

    const losersRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=5`);
    const losersJson = await losersRes.json();
    const marketLosers = losersJson.finance?.result?.[0]?.quotes?.map(q => q.symbol) || [];
    
    const allTickers = [...new Set([...STOCKS, ...marketLosers])];
    const results = [];

    for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
        const batch = allTickers.slice(i, i + BATCH_SIZE);
        const batchData = await Promise.all(batch.map(t => getStockData(t)));
        
        for (const data of batchData.filter(d => d !== null)) {
            const upside = data.targetPrice ? ((data.targetPrice - data.price) / data.price * 100).toFixed(1) : "N/A";
            
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: `Jsi brutálně upřímný hedge-fund analytik. ZAKÁZÁNY obecné řeči. 
                    Piš česky. Formát:
                    1. DEBATA: Střet Býka a Medvěda k Tickeru ${data.ticker} (max 2-3 věty).
                    2. SENTIMENT: Rating ${data.rating}, Cílovka ${data.targetPrice} USD (Upside ${upside}%).
                    3. VERDIKT: [KOUPIT/DRŽET/REDUKOVAT] + 1 konkrétní důvod.` },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price}, Změna: ${data.change}%, Zprávy: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });

            const content = analysis.choices[0].message.content;
            const cleanVerdict = content.includes("KOUPIT") ? "KOUPIT" : content.includes("REDUKOVAT") ? "REDUKOVAT" : "DRŽET";
            results.push({ ...data, analysis: content, upside, cleanVerdict });
        }
        await delay(1200);
    }

    const logEntries = results.map(r => ({ ticker: r.ticker, price: r.price, verdict: r.cleanVerdict, date: new Date().toISOString() }));
    await fs.appendFile("./history.json", JSON.stringify(logEntries) + "\n");

    // OPRAVA: Výběr top příležitostí - vynucení konkrétních tickerů
    const candidates = results.filter(r => !portfolio[r.ticker] && (r.change < -4 || parseFloat(r.upside) > 20));
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Vyber 3 nejlepší tickery z dodaného seznamu. Piš POUZE o těchto tickerech. Zakázány obecné řeči o nemovitostech nebo trendech. Chci: Ticker - důvod nákupu (1 věta)." },
                   { role: "user", content: candidates.length > 0 ? candidates.map(c => `${c.ticker}: změna ${c.change}%, upside ${c.upside}%, analýza: ${c.analysis}`).join("\n") : "Žádné zajímavé dipy dnes." }],
        model: "llama-3.3-70b-versatile"
    });

    let totalValUsd = 0, totalInvUsd = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p && p.shares) {
            totalValUsd += d.price * p.shares;
            totalInvUsd += (p.avgPrice || p.vgPrice) * p.shares;
        }
    });

    const pnlPct = totalInvUsd > 0 ? (((totalValUsd - totalInvUsd) / totalInvUsd) * 100).toFixed(2) : 0;
    const color = (totalValUsd - totalInvUsd) >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial, sans-serif; background: #f4f7f9; padding: 20px;">
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center; margin-bottom: 20px;">
            <h1 style="margin:0;">Portfolio Intelligence</h1>
            <b style="font-size: 2.2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color}; font-size: 1.2em;">${pnlPct}% (${Math.round((totalValUsd - totalInvUsd) * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
            <p style="color: #7f8c8d; font-size: 0.9em; margin-top: 10px;">VIX: ${vix.toFixed(2)} | S&P 500: ${sp500.toFixed(2)}%</p>
        </div>

        <div style="background: #fff9db; border: 2px solid #f1c40f; padding: 20px; border-radius: 15px; margin-bottom: 25px;">
            <h3 style="margin-top:0; color:#f39c12;">🎯 TOP Příležitosti (Mimo Portfolio)</h3>
            <div style="font-size:0.95em; line-height: 1.5;">${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}</div>
        </div>`;

    results.sort((a,b) => (portfolio[b.ticker] ? 1 : 0) - (portfolio[a.ticker] ? 1 : 0)).forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!(p && p.shares);
        html += `<div style="background: white; padding: 20px; margin-top: 15px; border-radius: 12px; border-left: 6px solid ${isOwned ? '#3498db' : '#dfe6e9'};">
            <div style="display: flex; justify-content: space-between;">
                <b>${d.ticker} - ${d.name} ${isOwned ? '💼' : ''}</b>
                <b style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</b>
            </div>`;
        
        if (isOwned) {
            const pnlCzk = (d.price - (p.avgPrice || p.vgPrice)) * p.shares * usdCzkRate;
            const pnlP = (((d.price - (p.avgPrice || p.vgPrice)) / (p.avgPrice || p.vgPrice)) * 100).toFixed(2);
            html += `<div style="background: #f8fafd; padding: 10px; margin: 10px 0; border-radius: 8px; font-size: 0.9em;">
                <span>Pozice: <b>${Math.round(d.price * p.shares * usdCzkRate).toLocaleString('cs-CZ')} CZK</b></span>
                <span style="float:right; color: ${pnlCzk >= 0 ? '#27ae60' : '#c0392b'};"><b>${pnlP}% (${Math.round(pnlCzk).toLocaleString('cs-CZ')} CZK)</b></span>
            </div>`;
        }

        html += `<div style="background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 8px; margin-top: 10px; font-size: 0.9em;">
                ${d.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Report: ${pnlPct}%`, html: html + "</div>" });
}

runAgent().catch(console.error);