import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];

const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getBasicQuote(ticker) {
    try {
        const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
        const json = await res.json();
        const q = json["Global Quote"];
        if (!q || !q["05. price"]) return null;
        return {
            ticker: ticker.toUpperCase(),
            price: parseFloat(q["05. price"]),
            change: parseFloat(q["10. change percent"]?.replace('%', '') || 0)
        };
    } catch (e) { return null; }
}

async function getDetailedData(ticker) {
    try {
        const [iRes, nRes] = await Promise.all([
            fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://newsapi.org/v2/everything?q=${ticker}+stock&pageSize=5&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`)
        ]);
        const iJson = await iRes.json();
        const nJson = await nRes.json();
        return {
            target: parseFloat(iJson["AnalystTargetPrice"]) || null,
            pe: iJson["PERatio"] || "N/A",
            news: nJson.articles?.map(a => a.title).join(" | ").substring(0, 600) || "Žádné zprávy."
        };
    } catch (e) { return { target: null, pe: "N/A", news: "" }; }
}

async function runAgent() {
    const rawData = await fs.readFile("./portfolio.json", "utf-8");
    const portfolio = JSON.parse(rawData);
    
    let allData = [];
    console.log("📊 Stahuji kurzy pro celé portfolio...");

    for (const t of STOCKS) {
        const base = await getBasicQuote(t);
        if (base) allData.push(base);
        await new Promise(r => setTimeout(r, 12500)); // Delay pro Alpha Vantage
    }

    // Seřadíme podle absolutní změny a vezmeme TOP 5 pro hloubkovou analýzu
    const topPerformers = [...allData].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);

    console.log("🧠 Analyzuji TOP 5 hybatelů...");
    const analysisResults = [];
    for (const d of topPerformers) {
        const details = await getDetailedData(d.ticker);
        const analysis = await groq.chat.completions.create({
            messages: [{ role: "system", content: "Jsi stručný analytik. Piš česky. Formát: - DNES: (1 věta), - KATALYZÁTOR: (1 věta), - KRÁTKODOBĚ: (1 věta), - DLOUHODOBĚ: (1 věta)." },
                       { role: "user", content: `Ticker: ${d.ticker}, News: ${details.news}` }],
            model: "llama-3.3-70b-versatile"
        });
        analysisResults.push({ ...d, ...details, analysis: analysis.choices[0].message.content });
    }

    // DNEŠNÍ PŘÍLEŽITOSTI (Trending)
    const trendRes = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const trendJson = await trendRes.json();
    const headlines = trendJson.articles?.slice(0, 10).map(a => a.title).join(" | ") || "";
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Najdi 3 tickery s momentum. Ticker - důvod (1 věta)." }, { role: "user", content: headlines }],
        model: "llama-3.3-70b-versatile"
    });

    // SUMA PORTFOLIA
    const usdCzk = 24.1;
    let totalValUsd = 0, totalInvUsd = 0;
    for (const t in portfolio) {
        const p = portfolio[t];
        const current = allData.find(d => d.ticker === t.toUpperCase())?.price || (p.avgPrice || p.vgPrice);
        totalValUsd += (current * p.shares);
        totalInvUsd += ((p.avgPrice || p.vgPrice) * p.shares);
    }
    const pnlUsd = totalValUsd - totalInvUsd;
    const pnlPct = ((pnlUsd / totalInvUsd) * 100).toFixed(2);
    const color = pnlUsd >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial; padding: 20px; background: #f4f7f9;">
        <div style="background: white; padding: 20px; border-radius: 10px; border-top: 6px solid ${color}; text-align: center;">
            <h2 style="margin:0; font-size: 1em; color: #7f8c8d;">HODNOTA PORTFOLIA</h2>
            <b style="font-size: 2em;">${Math.round(totalValUsd * usdCzk).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}% (${Math.round(pnlUsd * usdCzk).toLocaleString('cs-CZ')} CZK)</b>
        </div>

        <div style="background: #fff9db; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #f1c40f;">
            <h4 style="margin:0 0 5px 0; color: #f39c12;">🎯 DNEŠNÍ PŘÍLEŽITOSTI</h4>
            <div style="font-size: 0.9em;">${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}</div>
        </div>
        
        <h3 style="color: #2c3e50;">🔥 Největší pohyby dne</h3>`;

    analysisResults.forEach(d => {
        html += `<div style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 8px; border-left: 5px solid #34495e;">
            <div style="display:flex; justify-content: space-between; font-weight:bold;">
                <span>${d.ticker}</span>
                <span style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price} USD (${d.change}%)</span>
            </div>
            <div style="font-size: 0.8em; color: #7f8c8d; margin: 5px 0;">Target: ${d.target || 'N/A'} | P/E: ${d.pe}</div>
            <div style="font-size: 0.85em; background: #f8f9fa; padding: 10px; border-radius: 4px; line-height: 1.4;">${d.analysis.replace(/\n/g, '<br>')}</div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"Wealth Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Portfolio Report | ${pnlPct}%`, html: html + "</div>" });
}

runAgent().catch(console.error);