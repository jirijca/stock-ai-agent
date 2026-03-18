import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; 
const EMAIL_RECIPIENT = "jirijca@gmail.com";

// Funkce pro podrobný posudek ke každé akcii
async function getStockAnalysis(ticker, price, change, news) {
    if (!news.length) return "Žádné aktuální zprávy k analýze.";
    try {
        const response = await groq.chat.completions.create({
            messages: [{
                role: "system",
                content: "Jsi seniorní akciový analytik. Na základě aktuální ceny, změny a titulků zpráv napiš ke konkrétní akcii stručný posudek v češtině (max 2 věty). Zaměř se na to, co hýbe cenou."
            }, {
                role: "user",
                content: `Ticker: ${ticker}, Cena: ${price}, Změna: ${change.toFixed(2)}%. Zprávy: ${news.map(n => n.title).join(" | ")}`
            }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.5,
        });
        return response.choices[0]?.message?.content || "Analýza nedostupná.";
    } catch (e) { return "Chyba při generování analýzy."; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const data = await res.json();
        const quote = data.chart.result[0].meta;
        
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const fortyEightHoursAgo = new Date();
        fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

        const allRecentNews = feed.items
            .filter(item => new Date(item.pubDate) > fortyEightHoursAgo)
            .map(n => ({
                ticker,
                title: n.title,
                date: new Date(n.pubDate),
                dateStr: new Date(n.pubDate).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
            }));

        const newsForAnalysis = allRecentNews.slice(0, 3);
        const price = quote.regularMarketPrice;
        const change = ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100;

        // TADY SE DĚJE TA HLAVNÍ ZMĚNA - VOLÁME AI PRO KAŽDÝ TICKER
        const analysis = await getStockAnalysis(ticker, price, change, newsForAnalysis);

        return { ticker, price, change, news: newsForAnalysis, allRecentNews, analysis };
    } catch (err) { return null; }
}

async function runAgent() {
    console.log("🚀 Generuji hloubkový report s posudky...");
    const results = [];
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) {
            console.log(`✅ Analyzováno: ${ticker}`);
            results.push(data);
        }
    }

    const globalTopNews = results
        .flatMap(r => r.allRecentNews)
        .sort((a, b) => b.date - a.date)
        .slice(0, 8);

    // --- TVORBA HTML ---
    let htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: auto; color: #1a1a1a; background: #fdfdfd; padding: 20px;">
            <h1 style="text-align: center; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Stock AI Intelligence Report</h1>
    `;

    results.forEach(d => {
        const color = d.change >= 0 ? "#27ae60" : "#c0392b";
        htmlContent += `
            <div style="background: white; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f0f0f0; padding-bottom: 10px; margin-bottom: 15px;">
                    <span style="font-size: 1.5em; font-weight: bold; color: #2c3e50;">${d.ticker}</span>
                    <span style="font-size: 1.2em; font-weight: bold; color: ${color};">${d.price.toFixed(2)} USD (${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)}%)</span>
                </div>
                
                <div style="background: #f8f9fa; border-left: 4px solid #3498db; padding: 12px; margin-bottom: 15px; font-style: italic; color: #2c3e50;">
                    <strong>🤖 AI Posudek:</strong><br>
                    ${d.analysis}
                </div>

                <div style="font-size: 0.85em; color: #555;">
                    <strong>Aktuální zprávy k tickeru:</strong><br>
                    ${d.news.map(n => `<div style="margin-top: 5px;">• <span style="color: #999;">[${n.dateStr}]</span> ${n.title}</div>`).join('')}
                </div>
            </div>
        `;
    });

    htmlContent += `
            <div style="margin-top: 40px; padding: 20px; background: #f1f3f5; border-radius: 8px;">
                <h2 style="margin-top: 0; color: #495057; font-size: 1.1em; text-transform: uppercase;">🔥 Poslední zprávy napříč trhem (Top 8)</h2>
                <div style="font-size: 0.85em; color: #343a40;">
                    ${globalTopNews.map(n => `<div style="margin-bottom: 8px;"><b>${n.ticker}</b> <span style="color: #868e96;">[${n.dateStr}]</span>: ${n.title}</div>`).join('')}
                </div>
            </div>
            <p style="font-size: 0.7em; text-align: center; color: #adb5bd; margin-top: 30px;">
                Data filtrována (max 48h). Vygenerováno ${new Date().toLocaleString('cs-CZ')}
            </p>
        </div>
    `;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"AI Market Expert" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `AI Intelligence Report: ${new Date().toLocaleDateString()}`,
        html: htmlContent
    });

    console.log("✅ Report s posudky odeslán.");
}

runAgent().catch(console.error);