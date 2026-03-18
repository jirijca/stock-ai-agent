import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const STOCKS = ["NVDA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        const [pRes, iRes, nRes] = await Promise.all([
            fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://newsapi.org/v2/everything?q=${ticker}+stock&pageSize=5&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`)
        ]);
        
        const pJson = await pRes.json();
        const iJson = await iRes.json();
        const nJson = await nRes.json();
        
        const p = pJson["Global Quote"];
        if (!p || !p["05. price"]) return null;

        const price = parseFloat(p["05. price"]);
        const target = parseFloat(iJson["AnalystTargetPrice"]) || null;
        const news = nJson.articles?.map(a => a.title).join(" | ") || "Žádné čerstvé zprávy.";

        return {
            ticker: ticker.toUpperCase(),
            price,
            change: parseFloat(p["10. change percent"].replace('%', '')),
            targetPrice: target,
            upside: target ? ((target - price) / price * 100).toFixed(1) : "N/A",
            pe: iJson["PERatio"] && iJson["PERatio"] !== "None" ? parseFloat(iJson["PERatio"]).toFixed(1) : "N/A",
            news
        };
    } catch (e) { return null; }
}

async function runAgent() {
    let portfolioFile = {};
    try { portfolioFile = JSON.parse(await fs.readFile("./portfolio.json", "utf-8")); } catch (e) {}

    const portfolioResults = [];
    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi elitní hedge-fund analytik. Nepiš obecné definice firmy ani aktuální cenu. Soustřeď se na: 1. AKTUÁLNÍ DĚNÍ (z dodaných zpráv), 2. RIZIKA/PŘÍLEŽITOSTI, 3. VERDIKT (KOUPIT/DRŽET/REDUKOVAT). Piš česky, stručně, v odrážkách." },
                    { role: "user", content: `Ticker: ${data.ticker}, Upside: ${data.upside}%, PE: ${data.pe}, Zprávy: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });
            portfolioResults.push({ ...data, analysis: analysis.choices[0].message.content });
        }
    }

    // SEKCE: Dnešní příležitosti (Mimo portfolio)
    const trendingRes = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const trendingJson = await trendingRes.json();
    const headlines = trendingJson.articles?.slice(0, 15).map(a => a.title).join(" | ") || "";

    const marketOps = await groq.chat.completions.create({
        messages: [
            { role: "system", content: "Z titulků identifikuj 3 konkrétní tickery s největším aktuálním potenciálem. U každého napiš jeden pádný důvod. Piš česky." },
            { role: "user", content: headlines }
        ],
        model: "llama-3.3-70b-versatile"
    });

    // EMAIL SESTAVENÍ
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
        <div style="background: white; padding: 20px; border-radius: 12px; border-bottom: 6px solid ${color}; text-align: center;">
            <h1 style="margin:0; font-size: 1.4em;">Portfolio Update</h1>
            <b style="font-size: 1.8em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}%</b>
        </div>

        <div style="background: #fff9db; padding: 15px; border-radius: 10px; margin: 15px 0; border: 1px solid #f1c40f;">
            <h3 style="margin:0; color: #f39c12;">🎯 Dnešní příležitosti</h3>
            <div style="font-size: 0.9em;">${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}</div>
        </div>`;

    portfolioResults.forEach(d => {
        html += `<div style="background: white; padding: 15px; margin-top: 10px; border-radius: 8px; border-left: 5px solid #34495e;">
            <div style="display:flex; justify-content: space-between; font-weight:bold;">
                <span>${d.ticker}</span>
                <span style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price} USD (${d.change}%)</span>
            </div>
            <div style="font-size: 0.8em; color: #7f8c8d;">Target: ${d.targetPrice || 'N/A'} | Upside: ${d.upside}% | P/E: ${d.pe}</div>
            <div style="background: #2c3e50; color: white; padding: 12px; border-radius: 5px; font-size: 0.85em; margin-top: 8px; line-height: 1.5;">
                ${d.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: `"AI Agent" <${process.env.MAIL_USER}>`, to: EMAIL_RECIPIENT, subject: `Report: ${pnlPct}%`, html: html + "</div>" });
}

runAgent().catch(console.error);