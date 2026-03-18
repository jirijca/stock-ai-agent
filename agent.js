import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// TESTOVACÍ REŽIM: Pouze jeden ticker pro ověření stability a API dat
const STOCKS = ["NVDA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        const [pRes, iRes] = await Promise.all([
            fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`)
        ]);
        
        const pJson = await pRes.json();
        const iJson = await iRes.json();
        const p = pJson["Global Quote"];
        
        if (!p || !p["05. price"]) return null;

        const price = parseFloat(p["05. price"]);
        const target = parseFloat(iJson["AnalystTargetPrice"]) || null;
        const pe = iJson["PERatio"] && iJson["PERatio"] !== "None" ? parseFloat(iJson["PERatio"]).toFixed(1) : "N/A";
        const upside = target ? ((target - price) / price * 100).toFixed(1) : "N/A";

        return {
            ticker: ticker.toUpperCase(),
            name: iJson["Name"] || ticker,
            price,
            change: parseFloat(p["10. change percent"].replace('%', '')),
            targetPrice: target,
            upside,
            pe
        };
    } catch (e) { return null; }
}

async function runAgent() {
    let portfolioFile = {};
    try {
        portfolioFile = JSON.parse(await fs.readFile("./portfolio.json", "utf-8"));
    } catch (e) {}

    const portfolioResults = [];
    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi seniorní analytik. Piš česky, stručně. 1. DEBATA (2 věty), 2. FUNDAMENTY, 3. VERDIKT." },
                    { role: "user", content: `Ticker: ${data.ticker}, Cena: ${data.price}, Upside: ${data.upside}%, PE: ${data.pe}` }
                ],
                model: "llama-3.3-70b-versatile"
            });
            portfolioResults.push({ ...data, analysis: analysis.choices[0].message.content });
        }
    }

    // TRENDING PŘÍLEŽITOSTI (Mimo tvé testovací portfolio)
    const trendingRes = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const trendingJson = await trendingRes.json();
    const headlines = trendingJson.articles?.slice(0, 10).map(a => a.title).join(" ") || "";

    const marketOps = await groq.chat.completions.create({
        messages: [
            { role: "system", content: "Z těchto zpráv identifikuj 3-5 zajímavých akciových tickerů (mimo tvé portfolio), které mají aktuálně momentum nebo pozitivní news. U každého napiš 1 větu: Proč je to dnes příležitost." },
            { role: "user", content: `Aktuální zprávy: ${headlines}` }
        ],
        model: "llama-3.3-70b-versatile"
    });

    const usdCzkRate = 24.1;
    let totalValUsd = 0, totalInvUsd = 0;
    
    portfolioResults.forEach(d => {
        const p = portfolioFile[d.ticker.toUpperCase()];
        if (p?.shares) {
            totalValUsd += d.price * p.shares;
            totalInvUsd += (p.avgPrice || p.vgPrice) * p.shares;
        }
    });

    const pnlPct = totalInvUsd > 0 ? (((totalValUsd - totalInvUsd) / totalInvUsd) * 100).toFixed(2) : 0;
    const color = (totalValUsd - totalInvUsd) >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: Arial; padding: 20px; background: #f4f7f9;">
        <div style="background: white; padding: 25px; border-radius: 15px; border-bottom: 8px solid ${color}; text-align: center; margin-bottom: 20px;">
            <h1 style="margin:0;">Portfolio Intelligence</h1>
            <b style="font-size: 2.2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color}; font-size: 1.2em;">${pnlPct}%</b>
        </div>

        <div style="background: #e1f5fe; padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #03a9f4;">
            <h3 style="margin-top:0; color: #0288d1;">🚀 Trending Příležitosti (Mimo Portfolio)</h3>
            <div style="font-size: 0.95em; line-height: 1.5;">${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}</div>
        </div>`;

    portfolioResults.forEach(d => {
        html += `<div style="background: white; padding: 15px; margin-top: 10px; border-radius: 10px; border-left: 6px solid #34495e;">
            <div style="display:flex; justify-content: space-between; font-weight:bold;">
                <span>${d.ticker}</span>
                <span style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price} USD (${d.change}%)</span>
            </div>
            <div style="font-size: 0.85em; color: #7f8c8d; margin-top: 5px;">Target: ${d.targetPrice || 'N/A'} | Upside: <b>${d.upside}%</b> | P/E: ${d.pe}</div>
            <div style="background: #2c3e50; color: #ecf0f1; padding: 12px; border-radius: 6px; font-size: 0.9em; margin-top: 10px;">${d.analysis.replace(/\n/g, '<br>')}</div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({
        from: `"AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Report: ${pnlPct}%`,
        html: html + "</div>"
    });
}

runAgent().catch(console.error);