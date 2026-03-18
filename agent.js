import "dotenv/config";
import nodemailer from "nodemailer";
import { Groq } from "groq-sdk";
import fs from "fs/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Kompletní seznam tvého portfolia (54 tickerů)
const STOCKS = [
    "GOOG", "MDB", "VKTX", "NVDA", "ONDS", "VUZI", "IPWR", "CPRX", "TAOP", "3CP.DE", 
    "META", "ANGO", "ANNX", "MVIS", "AREC", "ASST", "NRDY", "ALAR", "TISC", "INDI", 
    "NU", "IREN", "SOFI", "SOL", "CPNG", "V", "MDWD", "MVST", "CBAT", "JTAI", 
    "SANA", "NVVE", "ATOS", "BTAI", "ARQ", "ENVX", "IRON", "GRYP", "NIO", "MRKR", 
    "CAN", "QTBS", "HRMY", "ASBP", "RZLV", "OKLO", "GRAB", "AVGO", "RHM", "CRDO", 
    "NUVB", "MSFT", "TTWO", "ASML", "RIOT", "O"
];

const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getStockData(ticker) {
    try {
        const [pRes, iRes, nRes] = await Promise.all([
            fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`),
            fetch(`https://newsapi.org/v2/everything?q=${ticker}+stock&pageSize=8&sortBy=publishedAt&apiKey=${process.env.NEWS_API_KEY}`)
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
            ticker: ticker.toUpperCase(),
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
    console.log(`🚀 Startuji analýzu ${STOCKS.length} tickerů...`);
    const rawData = await fs.readFile("./portfolio.json", "utf-8");
    const portfolio = JSON.parse(rawData);

    const analysisResults = [];
    for (const t of STOCKS) {
        process.stdout.write(`🔍 Zpracovávám ${t}... `);
        const data = await getStockData(t);
        if (data) {
            const analysis = await groq.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: `Jsi brutálně stručný analytik. Piš česky. Odpovídej VŽDY v tomto formátu (každý bod max 1 věta):
                        - DNES: (nejnovější klíčová zpráva z posledních 24-48h)
                        - KATALYZÁTOR: (nejbližší událost/earnings/produkty, co pohnou cenou)
                        - KRÁTKODOBĚ: (verdikt na dny/týdny)
                        - DLOUHODOBĚ: (verdikt na měsíce/roky)` 
                    },
                    { role: "user", content: `Ticker: ${data.ticker}, Upside: ${data.upside}%, News: ${data.news}` }
                ],
                model: "llama-3.3-70b-versatile"
            });
            analysisResults.push({ ...data, analysis: analysis.choices[0].message.content });
            console.log("OK");
        } else {
            console.log("SKIP (chyba dat)");
        }
        // Delay 15s pro Alpha Vantage free tier stabilitu
        await new Promise(resolve => setTimeout(resolve, 15000));
    }

    // PŘÍLEŽITOSTI (Mimo portfolio)
    const trendingRes = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${process.env.NEWS_API_KEY}`);
    const trendingJson = await trendingRes.json();
    const headlines = trendingJson.articles?.slice(0, 15).map(a => a.title).join(" | ") || "";
    const marketOps = await groq.chat.completions.create({
        messages: [{ role: "system", content: "Najdi 3 tickery s momentum. Napiš jen: TICKER - důvod (jedna věta). Nic víc." }, { role: "user", content: headlines }],
        model: "llama-3.3-70b-versatile"
    });

    // VÝPOČET SUMY
    const usdCzkRate = 24.1;
    let totalValUsd = 0, totalInvUsd = 0;

    for (const t in portfolio) {
        const p = portfolio[t];
        const analyzed = analysisResults.find(r => r.ticker === t.toUpperCase());
        const currentPrice = analyzed ? analyzed.price : (parseFloat(p.avgPrice || p.vgPrice) || 0);
        totalValUsd += (currentPrice * p.shares);
        totalInvUsd += ((parseFloat(p.avgPrice || p.vgPrice) || 0) * p.shares);
    }

    const pnlUsd = totalValUsd - totalInvUsd;
    const pnlPct = totalInvUsd > 0 ? ((pnlUsd / totalInvUsd) * 100).toFixed(2) : 0;
    const color = pnlUsd >= 0 ? "#27ae60" : "#c0392b";

    let html = `<div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; background: #f0f2f5;">
        <div style="background: white; padding: 20px; border-radius: 10px; border-top: 5px solid ${color}; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
            <h2 style="margin:0; color: #555; font-size: 1.1em;">HODNOTA PORTFOLIA</h2>
            <b style="font-size: 2.2em;">${Math.round(totalValUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK</b><br>
            <b style="color: ${color}; font-size: 1.2em;">${pnlPct}% (${Math.round(pnlUsd * usdCzkRate).toLocaleString('cs-CZ')} CZK)</b>
        </div>

        <div style="background: #fff9db; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #f1c40f;">
            <h4 style="margin:0 0 10px 0; color: #f39c12; text-transform: uppercase;">🎯 Dnešní příležitosti</h4>
            <div style="font-size: 0.9em; line-height: 1.6;">${marketOps.choices[0].message.content.replace(/\n/g, '<br>')}</div>
        </div>`;

    analysisResults.forEach(d => {
        html += `<div style="background: white; padding: 15px; margin-top: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="display:flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 10px;">
                <span style="font-size: 1.1em; font-weight: bold; color: #2c3e50;">${d.ticker}</span>
                <span style="font-weight: bold; color: ${d.change >= 0 ? '#27ae60' : '#c0392b'};">${d.price} USD (${d.change}%)</span>
            </div>
            <div style="font-size: 0.75em; color: #95a5a6; margin-bottom: 10px;">
                Target: ${d.targetPrice || 'N/A'} | Upside: <b>${d.upside}%</b> | P/E: ${d.pe}
            </div>
            <div style="color: #34495e; font-size: 0.88em; line-height: 1.5;">
                ${d.analysis.replace(/\n/g, '<br>')}
            </div>
        </div>`;
    });

    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({
        from: `"Wealth Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Invest Report | ${pnlPct}%`,
        html: html + "</div>"
    });
    console.log("🏁 Report odeslán.");
}

runAgent().catch(console.error);