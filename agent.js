import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";

// --- KLÍČOVÁ OPRAVA: Yahoo vyžaduje User-Agent, jinak vrací 404/403 ---
const fetchWithHeader = (url) => fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
});

async function getStockData(ticker) {
    try {
        // Používáme v8 chart API, které je stabilnější než v7 quote
        const res = await fetchWithHeader(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;
        
        if (!meta || meta.regularMarketPrice === undefined) {
            console.log(`⚠️ Žádná data pro ${ticker}`);
            return null;
        }

        // Zprávy
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`).catch(() => ({ items: [] }));
        const now = new Date();
        const freshNews = feed.items
            .filter(i => (now - new Date(i.isoDate)) < 24 * 60 * 60 * 1000)
            .slice(0, 3).map(n => n.title).join(" | ");

        return {
            ticker: ticker.toUpperCase(),
            name: ticker, // v8 vrací méně metadat, použijeme ticker jako jméno
            price: meta.regularMarketPrice,
            change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100) || 0,
            targetPrice: null, // v8 chart neobsahuje cílovky analytiků
            rating: "N/A",
            news: freshNews || "Bez aktuálních zpráv."
        };
    } catch (err) { 
        console.log(`❌ Chyba u ${ticker}:`, err.message);
        return null; 
    }
}

async function runAgent() {
    console.log("🔍 Načítám portfolio...");
    let portfolio = {};
    try { 
        const data = await fs.readFile("./portfolio.json", "utf-8");
        const raw = JSON.parse(data);
        for (const [k, v] of Object.entries(raw)) { portfolio[k.toUpperCase()] = v; }
        console.log(`✅ Načteno ${Object.keys(portfolio).length} akcií.`);
    } catch (e) { console.log("❌ Chyba při čtení portfolio.json"); }
    
    // Pro kurz CZK použijeme stejnou metodu
    const czkRes = await fetchWithHeader(`https://query1.finance.yahoo.com/v8/finance/chart/CZK=X?interval=1d&range=1d`);
    const czkJson = await czkRes.json();
    const usdCzkRate = czkJson.chart?.result?.[0]?.meta?.regularMarketPrice || 23.5;

    const results = [];
    console.log(`🚀 Start analýzy ${STOCKS.length} tickerů...`);

    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi analytik. Piš česky a velmi stručně (2-3 věty). Verdikt: [KOUPIT/DRŽET/REDUKOVAT]." },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price}, Změna: ${data.change.toFixed(2)}%, Zprávy: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });

            const content = analysis.choices[0].message.content;
            const cleanVerdict = content.includes("KOUPIT") ? "KOUPIT" : content.includes("REDUKOVAT") ? "REDUKOVAT" : "DRŽET";
            results.push({ ...data, analysis: content, cleanVerdict });
            process.stdout.write(`.`); 
        }
        await new Promise(res => setTimeout(res, 500)); // Menší pauza
    }

    if (results.length === 0) {
        console.log("\n‼️ Žádná data nebyla stažena. Yahoo tě blokuje.");
        return;
    }

    console.log(`\n✅ Hotovo. Staženo ${results.length} akcií. Odesílám email...`);

    // Logování do historie
    const logEntries = results.map(r => ({ ticker: r.ticker, price: r.price, verdict: r.cleanVerdict, date: new Date().toISOString() }));
    await fs.appendFile("./history.json", JSON.stringify(logEntries) + "\n");

    // Výpočet portfolia
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
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center;">
            <h1 style="margin:0;">Portfolio Intelligence</h1>
            <b style="font-size: 2.2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color}; font-size: 1.2em;">${pnlPct}%</b>
        </div>`;

    results.sort((a,b) => (portfolio[b.ticker] ? 1 : 0) - (portfolio[a.ticker] ? 1 : 0)).forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!(p && p.shares);
        html += `<div style="background: white; padding: 15px; margin-top: 10px; border-radius: 10px; border-left: 5px solid ${isOwned ? '#3498db' : '#ccc'};">
            <b>${d.ticker}</b>: ${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)
            <div style="background: #2c3e50; color: white; padding: 10px; border-radius: 5px; margin-top: 5px; font-size: 0.85em;">${d.analysis.replace(/\n/g, '<br>')}</div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Portfolio Report: ${pnlPct}%`, html: html + "</div>" });
}

runAgent().catch(console.error);