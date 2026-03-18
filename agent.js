import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 3;

async function getUsdCzkRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X`);
        const json = await res.json();
        return json.chart?.result?.[0]?.meta?.regularMarketPrice || 23.5;
    } catch (e) { return 23.5; }
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
        const news = feed.items.slice(0, 3).map(n => ({ title: n.title, link: n.link }));
        return { ticker, price, change, news };
    } catch (err) { return null; }
}

async function runAgent() {
    const portfolio = JSON.parse(await fs.readFile("./portfolio.json", "utf-8"));
    const usdCzkRate = await getUsdCzkRate();
    const results = [];

    for (let i = 0; i < STOCKS.length; i += BATCH_SIZE) {
        const batch = STOCKS.slice(i, i + BATCH_SIZE);
        const res = await Promise.all(batch.map(async (t) => {
            const data = await getStockData(t);
            if (!data) return null;
            const analysis = await groq.chat.completions.create({
                messages: [{ role: "system", content: "Jsi analytik. Piš česky, max 2 úderné věty. Verdikt: [KOUPIT/DRŽET/REDUKOVAT]." }, { role: "user", content: `Ticker: ${t}, Cena: ${data.price} USD, News: ${data.news.map(n => n.title).join(" | ")}` }],
                model: "llama-3.3-70b-versatile"
            });
            data.analysis = analysis.choices[0]?.message?.content;
            return data;
        }));
        results.push(...res.filter(r => r !== null));
    }

    let totalValUsd = 0, totalInvUsd = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p?.shares) {
            totalValUsd += d.price * p.shares;
            totalInvUsd += (p.avgPrice || p.vgPrice) * p.shares;
        }
    });

    const pnlUsd = totalValUsd - totalInvUsd;
    const pnlPct = ((pnlUsd / totalInvUsd) * 100).toFixed(2);
    const color = pnlUsd >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial; background: #f4f7f9; padding: 20px;">
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center; margin-bottom: 20px;">
            <h1 style="margin:0; color:#2c3e50;">Portfolio Overview (CZK)</h1>
            <b style="font-size: 2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="font-size: 1.2em; color: ${color};">${pnlPct}% (${Math.round(pnlUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
        </div>`;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!p?.shares;
        const changeColor = d.change >= 0 ? "#27ae60" : "#c0392b";
        
        html += `<div style="background: white; padding: 20px; margin-top: 20px; border-radius: 12px; border-left: 6px solid ${isOwned ? '#3498db' : '#ccc'}; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <b style="font-size: 1.4em;">${d.ticker}</b>
                <div style="text-align: right;">
                    <b style="color: ${changeColor};">${(d.price * usdCzkRate).toFixed(2)} CZK</b><br>
                    <small style="color: #999;">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</small>
                </div>
            </div>`;

        if (isOwned) {
            const currentValCzk = d.price * p.shares * usdCzkRate;
            const avgPriceUsd = p.avgPrice || p.vgPrice;
            const profitCzk = (d.price - avgPriceUsd) * p.shares * usdCzkRate;
            const profitPct = (((d.price - avgPriceUsd) / avgPriceUsd) * 100).toFixed(2);
            const pnlColor = profitCzk >= 0 ? "#27ae60" : "#c0392b";

            html += `<div style="background: #f8fafd; border: 1px solid #3498db; padding: 12px; margin: 15px 0; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between;">
                    <span>Moje pozice: <b>${Math.round(currentValCzk).toLocaleString('cs-CZ')} CZK</b></span>
                    <b style="color: ${pnlColor};">${profitPct}% (${Math.round(profitCzk).toLocaleString('cs-CZ')} CZK)</b>
                </div>
                <small style="color: #7f8c8d;">Vlastním ${p.shares} ks | Průměrná nákupka: ${avgPriceUsd} USD</small>
            </div>`;
        }

        html += `<div style="background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 8px; margin-top: 15px; font-size: 0.95em;">
                ${d.analysis}
            </div>
            <div style="font-size: 0.85em; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
                ${d.news.map(n => `• <a href="${n.link}" style="color: #3498db; text-decoration: none;">${n.title}</a>`).join('<br>')}
            </div>
        </div>`;
    });

    html += `<p style="text-align: center; color: #bdc3c7; font-size: 0.8em; margin-top: 20px;">AGENT19 Enterprise Intelligence</p></div>`;

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Portfolio Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Portfolio Intelligence: ${pnlPct}% CZK`, html: html });
    await fs.writeFile("./history.json", JSON.stringify(results.map(r => ({ticker: r.ticker, price: r.price}))));
}

runAgent().catch(console.error);