import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Seznam tickerů (pro test teď necháváme NVDA, ale logika je připravena na všechny)
const STOCKS = ["NVDA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        // 1. Cena a změna
        const priceRes = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
        const priceJson = await priceRes.json();
        const p = priceJson["Global Quote"];
        
        // 2. Fundamenty (Cílovka, PE, Konsenzus) - funkce OVERVIEW
        const infoRes = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
        const info = await infoRes.json();

        // 3. Zprávy
        const newsRes = await fetch(`https://newsapi.org/v2/everything?q=${ticker}+stock&pageSize=3&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`);
        const newsJson = await newsRes.json();
        const news = newsJson.articles?.map(a => a.title).join(" | ") || "Bez zpráv.";

        if (!p || !p["05. price"]) return null;

        const price = parseFloat(p["05. price"]);
        const target = parseFloat(info["AnalystTargetPrice"]) || null;
        const upside = target ? ((target - price) / price * 100).toFixed(1) : "N/A";

        return {
            ticker: ticker.toUpperCase(),
            name: info["Name"] || ticker,
            price: price,
            change: parseFloat(p["10. change percent"].replace('%', '')),
            targetPrice: target,
            upside: upside,
            pe: info["PERatio"] || "N/A",
            news: news
        };
    } catch (e) {
        console.error(`Chyba u ${ticker}:`, e.message);
        return null;
    }
}

async function runAgent() {
    let portfolio = {};
    try {
        const portData = await fs.readFile("./portfolio.json", "utf-8");
        const raw = JSON.parse(portData);
        Object.keys(raw).forEach(k => portfolio[k.toUpperCase()] = raw[k]);
    } catch (e) { console.log("Portfolio.json nenalezen."); }

    const results = [];
    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi profi analytik. Piš česky. Rozděl text na: 1. DEBATA (střet názorů), 2. FUNDAMENTY (zhodnocení čísel), 3. VERDIKT (KOUPIT/DRŽET/REDUKOVAT + důvod)." },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price}, Upside: ${data.upside}%, News: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });
            results.push({ ...data, analysis: analysis.choices[0].message.content });
        }
        if (STOCKS.length > 1) await new Promise(r => setTimeout(r, 15000)); 
    }

    // Kurz CZK (statický pro test nebo z API)
    const usdCzkRate = 23.5; 

    // Výpočet portfolia
    let totalValUsd = 0, totalInvUsd = 0;
    results.forEach(d => {
        const p = portfolio[d.ticker];
        if (p?.shares) {
            totalValUsd += d.price * p.shares;
            totalInvUsd += (p.avgPrice || p.vgPrice) * p.shares;
        }
    });

    const pnlPct = totalInvUsd > 0 ? (((totalValUsd - totalInvUsd) / totalInvUsd) * 100).toFixed(2) : 0;
    const color = (totalValUsd - totalInvUsd) >= 0 ? "#27ae60" : "#c0392b";

    // Top příležitosti (Dipy mimo portfolio)
    const candidates = results.filter(r => !portfolio[r.ticker] && (r.change < -3 || (r.upside !== "N/A" && r.upside > 20)));
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Vyber nejzajímavější příležitost z dat. Buď stručný, uveď ticker a proč." },
                   { role: "user", content: candidates.map(c => `${c.ticker}: upside ${c.upside}%`).join("\n") || "Žádné velké dipy." }],
        model: "llama-3.3-70b-versatile"
    });

    let html = `<div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f7f9;">
        <div style="background: white; padding: 20px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center;">
            <h1 style="margin:0;">Portfolio Intelligence</h1>
            <b style="font-size: 2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}%</b>
        </div>

        <div style="background: #fff9db; padding: 15px; border-radius: 10px; margin: 20px 0; border: 1px solid #f1c40f;">
            <h3 style="margin:0;">🎯 Dnešní příležitost</h3>
            ${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}
        </div>`;

    results.forEach(d => {
        const p = portfolio[d.ticker];
        const isOwned = !!p?.shares;
        html += `<div style="background: white; padding: 20px; margin-top: 15px; border-radius: 10px; border-left: 5px solid ${isOwned ? '#3498db' : '#ccc'};">
            <div style="display:flex; justify-content: space-between;">
                <b>${d.ticker} - ${d.name}</b>
                <b>${d.price} USD (${d.change}%)</b>
            </div>
            <div style="font-size: 0.85em; color: #7f8c8d; margin: 5px 0;">
                Target: ${d.targetPrice || 'N/A'} | Upside: <b>${d.upside}%</b> | P/E: ${d.pe}
            </div>
            <div style="background: #2c3e50; color: white; padding: 15px; border-radius: 5px; margin-top: 10px; font-size: 0.9em;">
                ${d.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: process.env.MAIL_USER, to: EMAIL_RECIPIENT, subject: `Portfolio Update: ${pnlPct}%`, html: html + "</div>" });
    
    // Log do historie
    const logEntries = results.map(r => ({ ticker: r.ticker, price: r.price, verdict: r.analysis.includes("KOUPIT") ? "KOUPIT" : "DRŽET", date: new Date().toISOString() }));
    await fs.appendFile("./history.json", JSON.stringify(logEntries) + "\n");
}

runAgent().catch(console.error);