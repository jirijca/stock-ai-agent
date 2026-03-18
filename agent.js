import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// TEST: Pouze NVDA
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
        const news = nJson.articles?.map(a => a.title).join(" | ") || "Žádné zprávy.";

        return {
            ticker: ticker,
            price,
            change: parseFloat(p["10. change percent"]?.replace('%', '') || 0),
            targetPrice: target,
            upside: target ? ((target - price) / price * 100).toFixed(1) : "N/A",
            pe: iJson["PERatio"] && iJson["PERatio"] !== "None" ? parseFloat(iJson["PERatio"]).toFixed(1) : "N/A",
            news
        };
    } catch (e) { return null; }
}

async function runAgent() {
    // 1. NAČTENÍ PORTFOLIA
    let portfolio = {};
    const rawData = await fs.readFile("./portfolio.json", "utf-8");
    portfolio = JSON.parse(rawData);

    // 2. ANALÝZA TESTOVACÍHO TICKERU
    const analysisResults = [];
    for (const t of STOCKS) {
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: "Jsi seniorní analytik. Piš česky, v odrážkách. 1. AKTUÁLNĚ, 2. RIZIKA, 3. VERDIKT." },
                    { role: "user", content: `Ticker: ${data.ticker}, Upside: ${data.upside}%, PE: ${data.pe}, News: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });
            analysisResults.push({ ...data, analysis: analysis.choices[0].message.content });
        }
    }

    // 3. PŘÍLEŽITOSTI
    const trendingRes = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const trendingJson = await trendingRes.json();
    const headlines = trendingJson.articles?.slice(0, 15).map(a => a.title).join(" | ") || "";
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Identifikuj 3 tickery s potenciálem. Ticker - 1 věta důvod." }, { role: "user", content: headlines }],
        model: "llama-3.3-70b-versatile"
    });

    // 4. VÝPOČET CELKOVÉ HODNOTY (Procházíme celý soubor portfolio.json)
    const usdCzkRate = 24.1;
    let totalValUsd = 0;
    let totalInvUsd = 0;

    for (const t in portfolio) {
        const p = portfolio[t];
        const shares = parseFloat(p.shares) || 0;
        const buyPrice = parseFloat(p.avgPrice || p.vgPrice) || 0;
        
        // Pokud jsme ticker analyzovali, máme čerstvou cenu, jinak použijeme nákupku pro test sumy
        const analyzed = analysisResults.find(r => r.ticker === t);
        const currentPrice = analyzed ? analyzed.price : buyPrice;

        totalValUsd += (currentPrice * shares);
        totalInvUsd += (buyPrice * shares);
    }

    const pnlUsd = totalValUsd - totalInvUsd;
    const pnlPct = totalInvUsd > 0 ? ((pnlUsd / totalInvUsd) * 100).toFixed(2) : 0;
    const color = pnlUsd >= 0 ? "#27ae60" : "#c0392b";

    // 5. HTML REPORT
    let html = `<div style="font-family: Arial; padding: 20px;">
        <div style="background: white; padding: 20px; border-bottom: 6px solid ${color}; text-align: center;">
            <h1 style="margin:0;">Portfolio Intelligence</h1>
            <b style="font-size: 1.8em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color};">${pnlPct}% (${Math.round(pnlUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
        </div>
        <div style="background: #fff9db; padding: 15px; margin: 15px 0; border: 1px solid #f1c40f;">
            <h3 style="margin:0;">🎯 Dnešní příležitosti</h3>
            ${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}
        </div>`;

    analysisResults.forEach(d => {
        html += `<div style="background: white; padding: 15px; margin-top: 10px; border-left: 5px solid #34495e;">
            <div style="display:flex; justify-content: space-between; font-weight:bold;">
                <span>${d.ticker}</span>
                <span style="color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price} USD (${d.change}%)</span>
            </div>
            <div style="font-size: 0.8em; color: #7f8c8d;">Target: ${d.targetPrice || 'N/A'} | Upside: ${d.upside}% | P/E: ${d.pe}</div>
            <div style="background: #2c3e50; color: white; padding: 10px; margin-top: 10px; font-size: 0.85em;">
                ${d.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({
        from: `"AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Test Report: ${pnlPct}%`,
        html: html + "</div>"
    });
    console.log("Hotovo.");
}

runAgent().catch(console.error);