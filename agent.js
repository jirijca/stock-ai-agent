import "dotenv/config";
import nodemailer from "nodemailer";
import Parser from "rss-parser";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const parser = new Parser();

const STOCKS = ["MSFT", "NVDA", "ASML", "RIOT", "O", "MDB", "V", "AVGO", "IREN", "GOOG", "TSLA"]; // Doplň si libovolně
const EMAIL_RECIPIENT = "jirijca@gmail.com";

async function getSentiment(ticker, news) {
    if (!news.length) return 0;
    try {
        const response = await groq.chat.completions.create({
            messages: [{
                role: "system",
                content: "Jsi finanční algoritmus. Analyzuj titulky a odpověz POUZE jedním číslem od -1.0 (velmi negativní) do 1.0 (velmi pozitivní). 0.0 je neutrální."
            }, {
                role: "user",
                content: `Ticker: ${ticker}. Zprávy: ${news.map(n => n.title).join(" | ")}`
            }],
            model: "llama-3.3-70b-versatile",
            temperature: 0, // Chceme konzistentní čísla
        });
        return parseFloat(response.choices[0]?.message?.content) || 0;
    } catch (e) { return 0; }
}

async function getStockData(ticker) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
        const data = await res.json();
        const quote = data.chart.result[0].meta;
        
        const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${ticker}+stock+news&hl=en-US`);
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        const recentNews = feed.items
            .filter(item => new Date(item.pubDate) > twoDaysAgo)
            .slice(0, 3)
            .map(n => ({ title: n.title }));

        const sentiment = await getSentiment(ticker, recentNews);

        return {
            ticker,
            price: quote.regularMarketPrice,
            change: ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100,
            news: recentNews,
            sentiment: sentiment
        };
    } catch (err) {
        return null;
    }
}

async function runAgent() {
    console.log("🚀 Analyzuji trh a sentiment...");
    const results = [];
    for (const ticker of STOCKS) {
        const data = await getStockData(ticker);
        if (data) {
            console.log(`✅ ${ticker}: ${data.sentiment > 0 ? '📈' : data.sentiment < 0 ? '📉' : '😐'} (${data.sentiment})`);
            results.push(data);
        }
    }

    const aiSummary = await groq.chat.completions.create({
        messages: [{
            role: "system",
            content: "Jsi analytik. Shrň 3 nejdůležitější události z dodaných dat v češtině. Buď stručný."
        }, {
            role: "user",
            content: JSON.stringify(results.filter(r => r.news.length > 0))
        }],
        model: "llama-3.3-70b-versatile",
    }).then(res => res.choices[0]?.message?.content).catch(() => "Shrnutí nedostupné.");

    const priceList = results.map(d => {
        let icon = d.sentiment > 0.2 ? "🟢" : d.sentiment < -0.2 ? "🔴" : "⚪";
        return `${icon} ${d.ticker.padEnd(5)} | ${d.price.toFixed(2).padStart(8)} | ${d.change.toFixed(2).padStart(6)}% | Senti: ${d.sentiment.toFixed(1)}`;
    }).join("\n");

    const emailBody = `
=== REPORT TRHU (Sentiment & Ceny) ===

Stav | Ticker|   Cena     | Změna   | Nálada
-------------------------------------------
${priceList}

(Legenda: 🟢 Pozitivní, 🔴 Negativní, ⚪ Neutrální)

---
🤖 HLAVNÍ POSTŘEHY:
${aiSummary}
    `;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.MAIL_USER, pass: process.env.GMAIL_PASS }
    });

    await transporter.sendMail({
        from: `"Stock AI Agent" <${process.env.MAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Market Sentiment Report: ${new Date().toLocaleDateString()}`,
        text: emailBody
    });

    console.log("✅ Email odeslán.");
}

runAgent().catch(console.error);