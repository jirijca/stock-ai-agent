import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"];
const EMAIL_RECIPIENT = "jirijca@gmail.com";
const BATCH_SIZE = 1; // Změněno na 1 pro maximální stabilitu u Yahoo
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function getMarketContext() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=^VIX,^GSPC`);
        const json = await res.json();
        const vix = json.quoteResponse?.result?.find(r => r.symbol === "^VIX")?.regularMarketPrice || 20;
        const sp500 = json.quoteResponse?.result?.find(r => r.symbol === "^GSPC")?.regularMarketChangePercent || 0;
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
        
        if (!d || d.regularMarketPrice === undefined) {
            console.log(`⚠️ Žádná data pro ${ticker}`);
            return null;
        }

        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`).catch(() => ({ items: [] }));
        const now = new Date();
        const freshNews = feed.items
            .filter(i => (now - new Date(i.isoDate)) < 24 * 60 * 60 * 1000)
            .slice(0, 3).map(n => n.title).join(" | ");

        return {
            ticker: ticker.toUpperCase(),
            name: d.shortName || ticker,
            price: d.regularMarketPrice,
            change: d.regularMarketChangePercent || 0,
            targetPrice: d.targetMedianPrice || null,
            rating: d.averageAnalystRating || "N/A",
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
        for (const [k, v] of Object.entries(raw)) {
            portfolio[k.toUpperCase()] = v;
        }
        console.log(`✅ Načteno ${Object.keys(portfolio).length} akcií z portfolia:`, Object.keys(portfolio));
    } catch (e) { console.log("❌ Chyba při čtení portfolio.json!"); }
    
    const { vix, sp500 } = await getMarketContext();
    const usdCzkRate = await getUsdCzkRate();

    const losersRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=5`);
    const losersJson = await losersRes.json();
    const marketLosers = losersJson.finance?.result?.[0]?.quotes?.map(q => q.symbol) || [];
    
    const allTickers = [...new Set([...STOCKS, ...marketLosers])];
    const results = [];

    console.log(`🚀 Start analýzy ${allTickers.length} tickerů...`);

    for (const t of allTickers) {
        const data = await getStockData(t);
        if (data) {
            const upside = data.targetPrice ? ((data.targetPrice - data.price) / data.price * 100).toFixed(1) : "N/A";
            
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi seniorní investor. Piš česky, stručně a věcně. Žádná omáčka. Formát: 1. DEBATA (2 věty) 2. SENTIMENT 3. VERDIKT." },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price}, Změna: ${data.change}%, Zprávy: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });

            const content = analysis.choices[0].message.content;
            const cleanVerdict = content.includes("KOUPIT") ? "KOUPIT" : content.includes("REDUKOVAT") ? "REDUKOVAT" : "DRŽET";
            results.push({ ...data, analysis: content, upside, cleanVerdict });
            process.stdout.write(`.`); // Indikátor progresu
        }
        await delay(1000); // Pauza pro Yahoo
    }

    console.log(`\n✅ Analýza hotova. Celkem ${results.length} výsledků.`);

    if (results.length === 0) {
        console.log("‼️ Žádná data nebyla stažena. Email nebude odeslán.");
        return;
    }

    // LOGOVÁNÍ
    const logEntries = results.map(r => ({ ticker: r.ticker, price: r.price, verdict: r.cleanVerdict, date: new Date().toISOString() }));
    await fs.appendFile("./history.json", JSON.stringify(logEntries) + "\n");

    // TOP PŘÍLEŽITOSTI
    const candidates = results.filter(r => !portfolio[r.ticker] && (r.change < -3 || (r.upside !== "N/A" && parseFloat(r.upside) > 15)));
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Vyber 3 tickery a napiš u každého jednu větu, proč ho koupit. Pokud je seznam prázdný, napiš 'Dnes nejsou na trhu zajímavé slevy'." },
                   { role: "user", content: candidates.map(c => `${c.ticker}: ${c.change}%, upside ${c.upside}%`).join("\n") || "Žádná data" }],
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
            <p>VIX: ${vix.toFixed(2)} | S&P 500: ${sp500.toFixed(2)}%</p>
        </div>
        <div style="background: #fff9db; padding: 20px; border-radius: 15px; margin-bottom: 25px; border: 1px solid #f1c40f;">
            <h3 style="margin-top:0;">🎯 TOP Příležitosti</h3>
            ${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}
        </div>`;

    results.sort((a,b) => (portfolio[b.ticker] ? 1 : 0) - (portfolio[a.ticker] ? 1 : 0)).forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!(p && p.shares);
        html += `<div style="background: white; padding: 15px; margin-top: 10px; border-radius: 10px; border-left: 5px solid ${isOwned ? '#3498db' : '#ccc'};">
            <b>${d.ticker} ${isOwned ? '💼' : ''}</b>: ${d.price.toFixed(2)} USD (${d.change.toFixed(2)}%)
            ${isOwned ? `<br><small>Profit: ${(((d.price - (p.avgPrice || p.vgPrice))/(p.avgPrice || p.vgPrice))*100).toFixed(2)}%</small>` : ''}
            <div style="background: #2c3e50; color: white; padding: 10px; border-radius: 5px; margin-top: 5px; font-size: 0.85em;">${d.analysis.replace(/\n/g, '<br>')}</div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Portfolio Report: ${pnlPct}%`, html: html + "</div>" });
}

runAgent().catch(console.error);