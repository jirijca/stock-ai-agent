import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 2;
const delay = (ms) => new Promise(res => setTimeout(res, ms));

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
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        return { 
            ticker, 
            price: meta.regularMarketPrice, 
            change: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
            news: feed.items.slice(0, 3).map(n => ({ title: n.title, link: n.link }))
        };
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
                messages: [{ role: "system", content: "Jsi seniorní analytik. Piš česky, max 2 úderné věty. Verdikt: [KOUPIT/DRŽET/REDUKOVAT]." }, { role: "user", content: `Ticker: ${t}, Cena: ${data.price} USD` }],
                model: "llama-3.3-70b-versatile"
            });
            return { ...data, analysis: analysis.choices[0]?.message?.content };
        }));
        results.push(...res.filter(r => r !== null));
        await delay(2500);
    }

    // Makro analýza (Příležitosti)
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Jsi makro stratég. Analyzuj pohyby a najdi 3 největší příležitosti k nákupu (dipy) nebo ochraně kapitálu. Piš česky, odrážkově." }, { role: "user", content: results.map(r => `${r.ticker}: ${r.change.toFixed(2)}%`).join(", ") }],
        model: "llama-3.3-70b-versatile"
    });

    let totalValUsd = 0, totalInvUsd = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p?.shares) {
            totalValUsd += d.price * p.shares;
            totalInvUsd += (p.avgPrice || p.vgPrice) * p.shares;
        }
    });

    const pnlPct = (( (totalValUsd - totalInvUsd) / totalInvUsd) * 100).toFixed(2);
    const color = (totalValUsd - totalInvUsd) >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial; background: #f4f7f9; padding: 20px;">
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center; margin-bottom: 20px;">
            <h1 style="margin:0;">Portfolio Intelligence (CZK)</h1>
            <b style="font-size: 2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}% (${Math.round((totalValUsd - totalInvUsd) * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
        </div>

        <div style="background: #fff9db; border: 2px solid #f1c40f; padding: 20px; border-radius: 15px; margin-bottom: 25px;">
            <h3 style="margin-top:0; color:#f39c12;">🔥 Dnešní příležitosti</h3>
            <div style="font-size:0.95em;">${marketOps.choices[0]?.message?.content.replace(/\n/g, '<br>')}</div>
        </div>`;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!p?.shares;
        html += `<div style="background: white; padding: 20px; margin-top: 15px; border-radius: 12px; border-left: 6px solid ${isOwned ? '#3498db' : '#ccc'};">
            <div style="display: flex; justify-content: space-between;">
                <b style="font-size: 1.2em;">${d.ticker}</b>
                <b style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)</b>
            </div>`;
        if (isOwned) {
            const curValCzk = d.price * p.shares * usdCzkRate;
            const pnlCzk = (d.price - (p.avgPrice || p.vgPrice)) * p.shares * usdCzkRate;
            const pnlP = (((d.price - (p.avgPrice || p.vgPrice)) / (p.avgPrice || p.vgPrice)) * 100).toFixed(2);
            html += `<div style="background: #f8fafd; padding: 12px; margin: 10px 0; border-radius: 8px;">
                <b>Moje pozice: ${Math.round(curValCzk).toLocaleString('cs-CZ')} CZK</b>
                <span style="float:right; color: ${pnlCzk >= 0 ? '#27ae60' : '#c0392b'};"><b>${pnlP}% (${Math.round(pnlCzk).toLocaleString('cs-CZ')} CZK)</b></span>
            </div>`;
        }
        html += `<p style="background: #2c3e50; color: white; padding: 12px; border-radius: 6px;">${d.analysis}</p>
            <small>${d.news.map(n => `• <a href="${n.link}">${n.title}</a>`).join('<br>')}</small>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Report: ${pnlPct}% CZK`, html: html + "</div>" });
    await fs.writeFile("./history.json", JSON.stringify(results.map(r => ({t: r.ticker, p: r.price}))));
}
runAgent().catch(console.error);